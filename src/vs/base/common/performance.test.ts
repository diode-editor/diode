import { afterEach, describe, expect, it } from "vitest";

import {
    enablePerformanceMarks,
    getMarks,
    isPerformanceMarksEnabled,
    mark,
    resetPerformanceMarks,
} from "./performance.ts";

describe("performance marks", () => {
    afterEach(() => {
        resetPerformanceMarks();
        performance.clearMarks();
    });

    it("без включения ничего не пишет (no-op по умолчанию)", () => {
        expect(isPerformanceMarksEnabled()).toBe(false);
        mark("main:start");
        expect(getMarks()).toEqual([]);
        expect(performance.getEntriesByType("mark")).toEqual([]);
    });

    it("после включения метки записываются в порядке постановки с временем от старта процесса", () => {
        enablePerformanceMarks();
        expect(isPerformanceMarksEnabled()).toBe(true);
        const before = performance.now();
        mark("main:start");
        mark("main:config-loaded");
        const after = performance.now();

        const marks = getMarks();
        expect(marks.map((m) => m.name)).toEqual(["main:start", "main:config-loaded"]);
        expect(marks[0].startTime).toBeGreaterThanOrEqual(before);
        expect(marks[1].startTime).toBeLessThanOrEqual(after);
        expect(marks[0].startTime).toBeLessThanOrEqual(marks[1].startTime);
        expect("detail" in marks[0]).toBe(false);
    });

    it("detail вехи уезжает в выгрузку как есть", () => {
        enablePerformanceMarks();
        mark("frame", { frame: 3 });
        const marks = getMarks();
        expect(marks).toHaveLength(1);
        expect(marks[0].name).toBe("frame");
        expect(marks[0].detail).toEqual({ frame: 3 });
        expect(typeof marks[0].startTime).toBe("number");
    });

    it("чужие performance.mark не попадают в выгрузку, а имена отдаются без префикса", () => {
        enablePerformanceMarks();
        performance.mark("someone-else");
        mark("workbench:mounted");
        expect(getMarks().map((m) => m.name)).toEqual(["workbench:mounted"]);
        // Сырое имя в performance — с префиксом, чтобы не пересекаться с чужими.
        expect(performance.getEntriesByName("diode/workbench:mounted")).toHaveLength(1);
    });

    it("reset снимает наши метки, чужие не трогает, и выключает запись", () => {
        enablePerformanceMarks();
        performance.mark("someone-else");
        mark("main:start");
        resetPerformanceMarks();
        expect(getMarks()).toEqual([]);
        expect(performance.getEntriesByName("someone-else")).toHaveLength(1);
        expect(isPerformanceMarksEnabled()).toBe(false);
        mark("main:start");
        expect(getMarks()).toEqual([]);
    });
});
