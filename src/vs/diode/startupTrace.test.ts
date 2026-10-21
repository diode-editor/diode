import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { Grid } from "@tuidom/core/rendering/grid";
import { afterEach, describe, expect, it } from "vitest";

import {
    enablePerformanceMarks,
    getMarks,
    isPerformanceMarksEnabled,
    mark,
    resetPerformanceMarks,
} from "../base/common/performance.ts";
import { Container, token } from "../platform/instantiation/common/diContainer.ts";
import {
    getInstantiationTracer,
    resetInstantiationTrace,
} from "../platform/instantiation/common/instantiationTrace.ts";

import {
    buildStartupTrace,
    type IStartupTrace,
    setupStartupTrace,
    STARTUP_TRACE_ENV,
    STARTUP_TRACE_INSTANTIATIONS_ENV,
    startupTracePath,
    TracingNodeTerminalBackend,
    writeStartupTrace,
} from "./startupTrace.ts";

describe("startupTracePath / setupStartupTrace", () => {
    afterEach(() => {
        resetPerformanceMarks();
        resetInstantiationTrace();
    });

    it("without env the trace is off, marks and the creation trace stay off", () => {
        expect(startupTracePath({})).toBeNull();
        expect(startupTracePath({ [STARTUP_TRACE_ENV]: "" })).toBeNull();
        expect(setupStartupTrace({})).toBeNull();
        expect(isPerformanceMarksEnabled()).toBe(false);
        expect(getInstantiationTracer()).toBeUndefined();
    });

    it("env with a path enables marks and returns the path; the creation trace needs its own flag", () => {
        expect(startupTracePath({ [STARTUP_TRACE_ENV]: "/tmp/trace.json" })).toBe("/tmp/trace.json");
        expect(setupStartupTrace({ [STARTUP_TRACE_ENV]: "/tmp/trace.json" })).toBe("/tmp/trace.json");
        expect(isPerformanceMarksEnabled()).toBe(true);
        expect(getInstantiationTracer()).toBeUndefined();
    });

    it("the creation trace flag enables nothing without a trace path, and enables it with one", () => {
        expect(setupStartupTrace({ [STARTUP_TRACE_INSTANTIATIONS_ENV]: "1" })).toBeNull();
        expect(getInstantiationTracer()).toBeUndefined();
        setupStartupTrace({ [STARTUP_TRACE_ENV]: "/tmp/trace.json", [STARTUP_TRACE_INSTANTIATIONS_ENV]: "0" });
        expect(getInstantiationTracer()).toBeUndefined();
        setupStartupTrace({ [STARTUP_TRACE_ENV]: "/tmp/trace.json", [STARTUP_TRACE_INSTANTIATIONS_ENV]: "1" });
        expect(getInstantiationTracer()).toBeDefined();
    });

    it("variable names are a contract with the bench", () => {
        expect(STARTUP_TRACE_ENV).toBe("DIODE_STARTUP_TRACE");
        expect(STARTUP_TRACE_INSTANTIATIONS_ENV).toBe("DIODE_STARTUP_TRACE_INSTANTIATIONS");
    });
});

describe("TracingNodeTerminalBackend", () => {
    afterEach(() => {
        resetPerformanceMarks();
    });

    function makeBackend(): { backend: TracingNodeTerminalBackend; written: () => string } {
        const stdin = new PassThrough();
        const stdout = new PassThrough();
        let out = "";
        stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
        const backend = new TracingNodeTerminalBackend(
            stdin as unknown as NodeJS.ReadStream,
            stdout as unknown as NodeJS.WriteStream,
        );
        return { backend, written: () => out };
    }

    it("sets a numbered frame mark after each frame written to the terminal", async () => {
        enablePerformanceMarks();
        const { backend, written } = makeBackend();
        const grid = new Grid(new Size(4, 2));
        grid.setCell(new Point(0, 0), "a");
        backend.renderFrame(grid, null);
        grid.setCell(new Point(1, 0), "b");
        backend.renderFrame(grid, null);
        await new Promise((resolve) => setImmediate(resolve));

        expect(written()).toContain("a");
        expect(written()).toContain("b");
        const marks = getMarks();
        expect(marks.map((m) => m.name)).toEqual(["frame", "frame"]);
        expect(marks.map((m) => m.detail)).toEqual([{ frame: 1 }, { frame: 2 }]);
        expect(marks[0].startTime).toBeLessThanOrEqual(marks[1].startTime);
    });

    it("the mark comes AFTER the frame write: its time is no earlier than when the bytes went out", async () => {
        enablePerformanceMarks();
        const stdin = new PassThrough();
        const stdout = new PassThrough();
        let writtenAt = -1;
        const originalWrite = stdout.write.bind(stdout);
        stdout.write = ((chunk: string | Uint8Array) => {
            writtenAt = performance.now();
            return originalWrite(chunk);
        }) as typeof stdout.write;
        const backend = new TracingNodeTerminalBackend(
            stdin as unknown as NodeJS.ReadStream,
            stdout as unknown as NodeJS.WriteStream,
        );
        const grid = new Grid(new Size(2, 1));
        grid.setCell(new Point(0, 0), "x");
        backend.renderFrame(grid, null);
        await new Promise((resolve) => setImmediate(resolve));
        expect(writtenAt).toBeGreaterThan(-1);
        expect(getMarks()[0].startTime).toBeGreaterThanOrEqual(writtenAt);
    });

    it("with marks off frames render, no marks", () => {
        const { backend, written } = makeBackend();
        const grid = new Grid(new Size(2, 1));
        grid.setCell(new Point(0, 0), "x");
        backend.renderFrame(grid, null);
        expect(written().length).toBeGreaterThan(0);
        expect(getMarks()).toEqual([]);
    });
});

describe("buildStartupTrace / writeStartupTrace", () => {
    let dir: string;
    afterEach(() => {
        resetPerformanceMarks();
        resetInstantiationTrace();
        rmSync(dir, { recursive: true, force: true });
    });

    it("snapshot holds pid, timeOrigin, nodeTiming and our marks", () => {
        dir = mkdtempSync(join(tmpdir(), "diode-trace-"));
        enablePerformanceMarks();
        mark("main:start");
        mark("frame", { frame: 1 });
        const trace = buildStartupTrace(false);
        expect(trace.pid).toBe(process.pid);
        expect(trace.timeOrigin).toBe(performance.timeOrigin);
        expect(trace.nodeTiming.bootstrapComplete).toBeGreaterThan(0);
        // Only numeric marks: `name`/`entryType` from nodeTiming.toJSON() are filtered out.
        expect(Object.values(trace.nodeTiming).every((v) => typeof v === "number")).toBe(true);
        expect("name" in trace.nodeTiming).toBe(false);
        expect(trace.complete).toBe(false);
        expect(trace.marks.map((m) => m.name)).toEqual(["main:start", "frame"]);
        expect(trace.instantiations).toEqual([]);
    });

    it("under the trace the snapshot includes services the container created", () => {
        dir = mkdtempSync(join(tmpdir(), "diode-trace-"));
        setupStartupTrace({ [STARTUP_TRACE_ENV]: join(dir, "trace.json"), [STARTUP_TRACE_INSTANTIATIONS_ENV]: "1" });
        const ValueDIToken = token<number>("Value");
        new Container().bind(ValueDIToken, () => 42).get(ValueDIToken);
        expect(buildStartupTrace(true).instantiations.map((e) => e.id)).toEqual(["Value"]);
    });

    it("writes JSON to the file, complete as passed", () => {
        dir = mkdtempSync(join(tmpdir(), "diode-trace-"));
        enablePerformanceMarks();
        mark("workbench:mounted");
        const path = join(dir, "trace.json");
        writeStartupTrace(path, true);
        const text = readFileSync(path, "utf8");
        expect(text.endsWith("}\n")).toBe(true);
        const parsed = JSON.parse(text) as IStartupTrace;
        expect(parsed.complete).toBe(true);
        expect(parsed.marks.map((m) => m.name)).toEqual(["workbench:mounted"]);
        expect(typeof parsed.marks[0].startTime).toBe("number");
        expect(parsed.pid).toBe(process.pid);
    });

    it("write failure (missing directory) is swallowed — the editor does not crash", () => {
        dir = mkdtempSync(join(tmpdir(), "diode-trace-"));
        expect(() => {
            writeStartupTrace(join(dir, "missing", "trace.json"), true);
        }).not.toThrow();
    });
});
