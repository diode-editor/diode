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

import {
    buildStartupTrace,
    type IStartupTrace,
    setupStartupTrace,
    STARTUP_TRACE_ENV,
    startupTracePath,
    TracingNodeTerminalBackend,
    writeStartupTrace,
} from "./startupTrace.ts";

describe("startupTracePath / setupStartupTrace", () => {
    afterEach(() => {
        resetPerformanceMarks();
    });

    it("без env трасса выключена, метки не включаются", () => {
        expect(startupTracePath({})).toBeNull();
        expect(startupTracePath({ [STARTUP_TRACE_ENV]: "" })).toBeNull();
        expect(setupStartupTrace({})).toBeNull();
        expect(isPerformanceMarksEnabled()).toBe(false);
    });

    it("env с путём включает метки и отдаёт путь", () => {
        expect(startupTracePath({ [STARTUP_TRACE_ENV]: "/tmp/trace.json" })).toBe("/tmp/trace.json");
        expect(setupStartupTrace({ [STARTUP_TRACE_ENV]: "/tmp/trace.json" })).toBe("/tmp/trace.json");
        expect(isPerformanceMarksEnabled()).toBe(true);
    });

    it("имя переменной — контракт с бенчем", () => {
        expect(STARTUP_TRACE_ENV).toBe("DIODE_STARTUP_TRACE");
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

    it("ставит веху frame с порядковым номером после каждого кадра, ушедшего в терминал", async () => {
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

    it("веха стоит ПОСЛЕ записи кадра: время метки не раньше момента, когда байты ушли", async () => {
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

    it("без включённых меток кадры рисуются, вех нет", () => {
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
        rmSync(dir, { recursive: true, force: true });
    });

    it("снимок содержит pid, timeOrigin, nodeTiming и наши метки", () => {
        dir = mkdtempSync(join(tmpdir(), "diode-trace-"));
        enablePerformanceMarks();
        mark("main:start");
        mark("frame", { frame: 1 });
        const trace = buildStartupTrace(false);
        expect(trace.pid).toBe(process.pid);
        expect(trace.timeOrigin).toBe(performance.timeOrigin);
        expect(trace.nodeTiming.bootstrapComplete).toBeGreaterThan(0);
        // Только числовые вехи: `name`/`entryType` из nodeTiming.toJSON() отсеяны.
        expect(Object.values(trace.nodeTiming).every((v) => typeof v === "number")).toBe(true);
        expect("name" in trace.nodeTiming).toBe(false);
        expect(trace.complete).toBe(false);
        expect(trace.marks.map((m) => m.name)).toEqual(["main:start", "frame"]);
    });

    it("пишет JSON в файл, complete как передан", () => {
        dir = mkdtempSync(join(tmpdir(), "diode-trace-"));
        enablePerformanceMarks();
        mark("workbench:mounted");
        const path = join(dir, "trace.json");
        writeStartupTrace(path, true);
        const text = readFileSync(path, "utf8");
        // Одна JSON-строка с переводом строки в конце — как пишут все наши файлы.
        expect(text.endsWith("}\n")).toBe(true);
        const parsed = JSON.parse(text) as IStartupTrace;
        expect(parsed.complete).toBe(true);
        expect(parsed.marks.map((m) => m.name)).toEqual(["workbench:mounted"]);
        expect(typeof parsed.marks[0].startTime).toBe("number");
        expect(parsed.pid).toBe(process.pid);
    });

    it("сбой записи (каталога нет) глотается — редактор не падает", () => {
        dir = mkdtempSync(join(tmpdir(), "diode-trace-"));
        expect(() => {
            writeStartupTrace(join(dir, "missing", "trace.json"), true);
        }).not.toThrow();
    });
});
