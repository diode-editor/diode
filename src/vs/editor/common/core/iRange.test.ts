import { describe, expect, it } from "vitest";

import { createPosition } from "./iPosition.ts";
import { createRange, rangeContainsPosition, rangesEqual } from "./iRange.ts";

describe("rangesEqual", () => {
    it("равные диапазоны", () => {
        expect(rangesEqual(createRange(0, 1, 2, 3), createRange(0, 1, 2, 3))).toBe(true);
    });

    it("разное начало", () => {
        expect(rangesEqual(createRange(0, 1, 2, 3), createRange(0, 2, 2, 3))).toBe(false);
    });

    it("разный конец", () => {
        expect(rangesEqual(createRange(0, 1, 2, 3), createRange(0, 1, 2, 4))).toBe(false);
    });
});

describe("rangeContainsPosition", () => {
    const range = createRange(1, 2, 3, 4);

    it("позиция внутри", () => {
        expect(rangeContainsPosition(range, createPosition(2, 0))).toBe(true);
    });

    it("границы включительно", () => {
        expect(rangeContainsPosition(range, createPosition(1, 2))).toBe(true);
        expect(rangeContainsPosition(range, createPosition(3, 4))).toBe(true);
    });

    it("позиция до начала", () => {
        expect(rangeContainsPosition(range, createPosition(1, 1))).toBe(false);
    });

    it("позиция за концом", () => {
        expect(rangeContainsPosition(range, createPosition(3, 5))).toBe(false);
    });

    it("схлопнутый диапазон содержит только собственную точку", () => {
        const collapsed = createRange(1, 2, 1, 2);
        expect(rangeContainsPosition(collapsed, createPosition(1, 2))).toBe(true);
        expect(rangeContainsPosition(collapsed, createPosition(1, 3))).toBe(false);
    });
});
