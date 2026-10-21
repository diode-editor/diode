import { describe, expect, it } from "vitest";

import {
    findFirstIdxMonotonousOrArrLen,
    findFirstMonotonous,
    findLastIdxMonotonous,
    findLastMonotonous,
    MonotonousArray,
} from "./arraysFind.ts";

/** Monotonic predicate: `[true, ..., true, false, ..., false]`. */

const arr = [1, 2, 3, 4, 5];
const upTo = (n: number) => (x: number) => x <= n;

describe("findLastIdxMonotonous", () => {
    it("finds the index of the last true", () => {
        expect(findLastIdxMonotonous(arr, upTo(3))).toBe(2);
    });

    it("returns -1 when there is no true", () => {
        expect(findLastIdxMonotonous(arr, upTo(0))).toBe(-1);
    });

    it("returns the last index when all are true", () => {
        expect(findLastIdxMonotonous(arr, upTo(99))).toBe(4);
    });

    it("respects the startIdx/endIdxEx bounds", () => {
        expect(findLastIdxMonotonous(arr, upTo(99), 1, 3)).toBe(2);
    });
});

describe("findLastMonotonous", () => {
    it("returns the element itself", () => {
        expect(findLastMonotonous(arr, upTo(3))).toBe(3);
    });

    it("returns undefined when nothing matches", () => {
        expect(findLastMonotonous(arr, upTo(0))).toBeUndefined();
    });
});

describe("findFirstIdxMonotonousOrArrLen", () => {
    // Monotonic the other way here: [false, ..., false, true, ..., true].
    const atLeast = (n: number) => (x: number) => x >= n;

    it("finds the index of the first true", () => {
        expect(findFirstIdxMonotonousOrArrLen(arr, atLeast(3))).toBe(2);
    });

    it("returns the array length when there is no true", () => {
        expect(findFirstIdxMonotonousOrArrLen(arr, atLeast(99))).toBe(arr.length);
    });

    it("respects the startIdx/endIdxEx bounds", () => {
        expect(findFirstIdxMonotonousOrArrLen(arr, atLeast(1), 2, 4)).toBe(2);
    });

    it("findFirstMonotonous returns the element or undefined", () => {
        expect(findFirstMonotonous(arr, atLeast(3))).toBe(3);
        expect(findFirstMonotonous(arr, atLeast(99))).toBeUndefined();
    });
});

describe("MonotonousArray", () => {
    it("successive queries with a weakening predicate move forward through the array", () => {
        const m = new MonotonousArray(arr);
        expect(m.findLastMonotonous(upTo(2))).toBe(2);
        expect(m.findLastMonotonous(upTo(4))).toBe(4);
    });

    it("returns undefined when no element matches", () => {
        expect(new MonotonousArray(arr).findLastMonotonous(upTo(0))).toBeUndefined();
    });

    it("with assertInvariants catches a strengthening predicate", () => {
        MonotonousArray.assertInvariants = true;
        try {
            const m = new MonotonousArray(arr);
            expect(m.findLastMonotonous(upTo(4))).toBe(4);
            // The predicate got stricter: a contract violation that must be caught.
            expect(() => m.findLastMonotonous(upTo(1))).toThrow(/weaker/);
        } finally {
            MonotonousArray.assertInvariants = false;
        }
    });

    it("with assertInvariants accepts a valid sequence", () => {
        MonotonousArray.assertInvariants = true;
        try {
            const m = new MonotonousArray(arr);
            expect(m.findLastMonotonous(upTo(2))).toBe(2);
            expect(m.findLastMonotonous(upTo(5))).toBe(5);
        } finally {
            MonotonousArray.assertInvariants = false;
        }
    });
});
