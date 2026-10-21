import { describe, expect, it } from "vitest";

import { createPosition } from "./iPosition.ts";
import { createRange, rangeContainsPosition, rangesEqual } from "./iRange.ts";

describe("rangesEqual", () => {
    it("equal ranges", () => {
        expect(rangesEqual(createRange(0, 1, 2, 3), createRange(0, 1, 2, 3))).toBe(true);
    });

    it("different start", () => {
        expect(rangesEqual(createRange(0, 1, 2, 3), createRange(0, 2, 2, 3))).toBe(false);
    });

    it("different end", () => {
        expect(rangesEqual(createRange(0, 1, 2, 3), createRange(0, 1, 2, 4))).toBe(false);
    });
});

describe("rangeContainsPosition", () => {
    const range = createRange(1, 2, 3, 4);

    it("position inside", () => {
        expect(rangeContainsPosition(range, createPosition(2, 0))).toBe(true);
    });

    it("bounds are inclusive", () => {
        expect(rangeContainsPosition(range, createPosition(1, 2))).toBe(true);
        expect(rangeContainsPosition(range, createPosition(3, 4))).toBe(true);
    });

    it("position before start", () => {
        expect(rangeContainsPosition(range, createPosition(1, 1))).toBe(false);
    });

    it("position past end", () => {
        expect(rangeContainsPosition(range, createPosition(3, 5))).toBe(false);
    });

    it("a collapsed range contains only its own point", () => {
        const collapsed = createRange(1, 2, 1, 2);
        expect(rangeContainsPosition(collapsed, createPosition(1, 2))).toBe(true);
        expect(rangeContainsPosition(collapsed, createPosition(1, 3))).toBe(false);
    });
});
