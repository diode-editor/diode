import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ILogger } from "../../../platform/log/common/iLogger.ts";

import { openApiTrace } from "./apiTraceFile.ts";

describe("openApiTrace", () => {
    let dir: string;
    let warn: ReturnType<typeof vi.fn>;
    let logger: ILogger;
    let listenersBefore: ReturnType<typeof process.listeners<"exit">>;

    beforeEach(() => {
        listenersBefore = process.listeners("exit");
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-api-trace-file-"));
        warn = vi.fn();
        logger = { warn } as unknown as ILogger;
    });

    // In `afterEach`: a failed assertion must not leave the worker with a replaced `setTimeout` or `cwd`.
    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
        for (const listener of process.listeners("exit")) {
            if (!listenersBefore.includes(listener)) process.removeListener("exit", listener);
        }
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("opening creates no file: the first record does, and it appends", () => {
        const file = path.join(dir, "journal.jsonl");
        fs.writeFileSync(file, "earlier\n");
        const trace = openApiTrace(file, logger);
        expect(fs.readFileSync(file, "utf8")).toBe("earlier\n");
        trace.record("pub.a", "window.a", "call");
        expect(fs.readFileSync(file, "utf8")).toBe(
            'earlier\n{"extension":"pub.a","member":"window.a","kind":"call","count":1}\n',
        );

        const untouched = path.join(dir, "untouched.jsonl");
        openApiTrace(untouched, logger);
        expect(fs.existsSync(untouched)).toBe(false);
    });

    it("a relative path is fixed at open: a later chdir does not move the journal", () => {
        const spy = vi.spyOn(process, "cwd").mockReturnValue(dir);
        const trace = openApiTrace("relative.jsonl", logger);
        spy.mockReturnValue(os.tmpdir());
        trace.record("pub.a", "window.a", "call");
        expect(fs.existsSync(path.join(dir, "relative.jsonl"))).toBe(true);
    });

    it("a repeat is written after the delay, on a timer that does not hold the process", () => {
        vi.useFakeTimers();
        const file = path.join(dir, "journal.jsonl");
        const unref = vi.fn();
        const realSetTimeout = globalThis.setTimeout;
        const timer = vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms: number) => {
            const handle = realSetTimeout(fn, ms);
            const original = handle.unref.bind(handle);
            handle.unref = (): NodeJS.Timeout => {
                unref();
                return original();
            };
            return handle;
        }) as typeof setTimeout);
        const trace = openApiTrace(file, logger);
        trace.record("pub.a", "window.a", "call");
        trace.record("pub.a", "window.a", "call");
        expect(timer).toHaveBeenCalledWith(expect.any(Function), 250);
        expect(unref).toHaveBeenCalledTimes(1);
        expect(fs.readFileSync(file, "utf8").trim().split("\n")).toHaveLength(1);

        vi.advanceTimersByTime(250);
        expect(fs.readFileSync(file, "utf8").trim().split("\n")).toHaveLength(2);
    });

    it("the pending rows are written on process exit", () => {
        const file = path.join(dir, "journal.jsonl");
        const trace = openApiTrace(file, logger);
        trace.record("pub.a", "window.a", "call");
        trace.record("pub.a", "window.a", "call");
        const added = process.listeners("exit").filter((l) => !listenersBefore.includes(l));
        expect(added).toHaveLength(1);
        (added[0] as () => void)();
        expect(fs.readFileSync(file, "utf8").trim().split("\n")).toHaveLength(2);
    });

    it("a write failure is logged with the path and the cause", () => {
        // A directory in place of the file: the append fails.
        const trace = openApiTrace(dir, logger);
        trace.record("pub.a", "window.a", "call");
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[0]).toContain(`DIODE_API_TRACE: journal ${dir} stopped: `);
        expect(warn.mock.calls[0]?.[0]).toContain("EISDIR");
    });
});
