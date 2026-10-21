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

    it("records nothing until enabled (no-op by default)", () => {
        expect(isPerformanceMarksEnabled()).toBe(false);
        mark("main:start");
        expect(getMarks()).toEqual([]);
        expect(performance.getEntriesByType("mark")).toEqual([]);
    });

    it("once enabled, marks are recorded in order with time since process start", () => {
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

    it("the mark detail goes into the dump as is", () => {
        enablePerformanceMarks();
        mark("frame", { frame: 3 });
        const marks = getMarks();
        expect(marks).toHaveLength(1);
        expect(marks[0].name).toBe("frame");
        expect(marks[0].detail).toEqual({ frame: 3 });
        expect(typeof marks[0].startTime).toBe("number");
    });

    it("foreign performance.mark calls stay out of the dump, and names come without the prefix", () => {
        enablePerformanceMarks();
        performance.mark("someone-else");
        mark("workbench:mounted");
        expect(getMarks().map((m) => m.name)).toEqual(["workbench:mounted"]);
        // The raw name in performance is prefixed so it doesn't clash with others.
        expect(performance.getEntriesByName("diode/workbench:mounted")).toHaveLength(1);
    });

    it("reset clears our marks, leaves foreign ones alone, and disables recording", () => {
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
