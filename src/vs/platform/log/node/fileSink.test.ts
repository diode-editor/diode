import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import type { LogEntry } from "../common/iLogService.ts";
import { LogLevel } from "../common/logLevel.ts";

import { FileSink } from "./fileSink.ts";

// Controls whether the mocked createWriteStream throws. Off by default so every
// other test exercises the real filesystem.
const createWriteStreamControl = { throwOnCreate: false };

vi.mock("node:fs", async (importActual) => {
    const actual = await importActual<typeof fs>();
    return {
        ...actual,
        createWriteStream: (...args: Parameters<typeof actual.createWriteStream>) => {
            if (createWriteStreamControl.throwOnCreate) {
                throw new Error("EACCES");
            }
            return actual.createWriteStream(...args);
        },
    };
});

function entry(overrides: Partial<LogEntry> = {}): LogEntry {
    return {
        timestamp: Date.parse("2026-01-02T03:04:05.000Z"),
        channel: "ch",
        level: LogLevel.Info,
        message: "hello",
        args: [],
        ...overrides,
    };
}

async function flushAndDispose(sink: FileSink): Promise<void> {
    sink.dispose();
    // FileSink.dispose() вызывает stream.end() — небольшой tick для записи на диск.
    await new Promise((r) => setTimeout(r, 20));
}

describe("FileSink", () => {
    let ws: ITempWorkspace;
    let file: string;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "vexx-filesink-" });
        file = ws.path("diode.log");
    });

    afterEach(() => {
        ws.dispose();
    });

    it("writes formatted line per entry", async () => {
        const sink = new FileSink(file);
        sink.append(entry({ message: "hello world" }));
        await flushAndDispose(sink);

        const content = fs.readFileSync(file, "utf8");
        expect(content).toBe("[2026-01-02T03:04:05.000Z] [INFO ] [ch] hello world\n");
    });

    it("appends args separated by tabs (json for plain values)", async () => {
        const sink = new FileSink(file);
        sink.append(entry({ message: "x", args: [{ a: 1 }, "str", 42] }));
        await flushAndDispose(sink);

        const content = fs.readFileSync(file, "utf8");
        expect(content).toContain('x\t{"a":1}\tstr\t42\n');
    });

    it("serializes Error with stack", async () => {
        const err = new Error("boom");
        const sink = new FileSink(file);
        sink.append(entry({ level: LogLevel.Error, message: "fail", args: [err] }));
        await flushAndDispose(sink);

        const content = fs.readFileSync(file, "utf8");
        expect(content).toContain("[ERROR]");
        expect(content).toContain("fail\t");
        expect(content).toMatch(/Error: boom/);
    });

    it("serializes Error without stack via name and message fallback", async () => {
        const err = new Error("boom");
        err.stack = undefined; // форсируем ветку `?? `${name}: ${message}``
        const sink = new FileSink(file);
        sink.append(entry({ level: LogLevel.Error, message: "fail", args: [err] }));
        await flushAndDispose(sink);

        const content = fs.readFileSync(file, "utf8");
        expect(content).toContain("fail\tError: boom\n");
    });

    it("truncates file on construction with flags=w (default)", async () => {
        fs.writeFileSync(file, "old content\n");
        const sink = new FileSink(file);
        sink.append(entry({ message: "new" }));
        await flushAndDispose(sink);

        const content = fs.readFileSync(file, "utf8");
        expect(content).not.toContain("old content");
        expect(content).toContain("new");
    });

    it("appends with flags=a", async () => {
        fs.writeFileSync(file, "old line\n");
        const sink = new FileSink(file, { flags: "a" });
        sink.append(entry({ message: "new" }));
        await flushAndDispose(sink);

        const content = fs.readFileSync(file, "utf8");
        expect(content.startsWith("old line\n")).toBe(true);
        expect(content).toContain("new");
    });

    it("append after dispose is no-op (does not throw)", async () => {
        const sink = new FileSink(file);
        await flushAndDispose(sink);
        expect(() => {
            sink.append(entry());
        }).not.toThrow();
    });

    it("does not throw if file path is invalid", () => {
        // На invalid path конструктор может не бросить (createWriteStream ленив),
        // но и не должен падать на append.
        const sink = new FileSink(ws.path("nonexistent-subdir/x.log"));
        expect(() => {
            sink.append(entry());
        }).not.toThrow();
        expect(() => {
            sink.dispose();
        }).not.toThrow();
    });

    it("multiple dispose calls are safe", () => {
        const sink = new FileSink(file);
        sink.dispose();
        expect(() => {
            sink.dispose();
        }).not.toThrow();
    });

    it("falls back to String() for non-serializable (circular) args", async () => {
        const circular: Record<string, unknown> = {};
        circular.self = circular; // JSON.stringify throws on this
        const sink = new FileSink(file);
        sink.append(entry({ message: "circ", args: [circular] }));
        await flushAndDispose(sink);

        const content = fs.readFileSync(file, "utf8");
        // String({}) → "[object Object]", proving the JSON.stringify fallback ran.
        expect(content).toContain("circ\t[object Object]\n");
    });

    it("silently sets stream=null when createWriteStream throws", () => {
        createWriteStreamControl.throwOnCreate = true;
        try {
            const sink = new FileSink(file);
            // With stream === null, append is a no-op and must not throw.
            expect(() => {
                sink.append(entry({ message: "ignored" }));
            }).not.toThrow();
            expect(() => {
                sink.dispose();
            }).not.toThrow();
            // File never created because createWriteStream threw.
            expect(fs.existsSync(file)).toBe(false);
        } finally {
            createWriteStreamControl.throwOnCreate = false;
        }
    });
});
