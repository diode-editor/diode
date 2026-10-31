import { describe, expect, it } from "vitest";

import {
    arrayInsert,
    compareBy,
    CompareResult,
    equals,
    forEachAdjacent,
    forEachWithNeighbors,
    groupAdjacentBy,
    numberComparator,
    pushMany,
    reverseOrder,
    SPLICE_CHUNK,
    spliceInChunks,
    sumBy,
} from "./arrays.ts";

/** The diff engine fixture corpus runs the shim end to end but misses the edge branches; they are here. */

describe("CompareResult", () => {
    it("classifies the comparison result", () => {
        expect(CompareResult.isLessThan(-1)).toBe(true);
        expect(CompareResult.isLessThan(0)).toBe(false);
        expect(CompareResult.isLessThanOrEqual(0)).toBe(true);
        expect(CompareResult.isLessThanOrEqual(1)).toBe(false);
        expect(CompareResult.isGreaterThan(1)).toBe(true);
        expect(CompareResult.isGreaterThan(0)).toBe(false);
        expect(CompareResult.isNeitherLessOrGreaterThan(0)).toBe(true);
        expect(CompareResult.isNeitherLessOrGreaterThan(1)).toBe(false);
    });

    it("carries the canonical constants", () => {
        expect([CompareResult.lessThan, CompareResult.neitherLessOrGreaterThan, CompareResult.greaterThan]).toEqual([
            -1, 0, 1,
        ]);
    });
});

describe("comparators", () => {
    it("numberComparator gives the natural order", () => {
        expect([3, 1, 2].sort(numberComparator)).toEqual([1, 2, 3]);
    });

    it("reverseOrder reverses the order", () => {
        expect([3, 1, 2].sort(reverseOrder(numberComparator))).toEqual([3, 2, 1]);
    });

    it("compareBy compares by projection", () => {
        const byLength = compareBy((s: string) => s.length, numberComparator);
        expect(["aaa", "a", "aa"].sort(byLength)).toEqual(["a", "aa", "aaa"]);
    });
});

describe("equals", () => {
    it("the same reference equals itself", () => {
        const arr = [1, 2];
        expect(equals(arr, arr)).toBe(true);
    });

    it("undefined on either side gives inequality", () => {
        expect(equals(undefined, [1])).toBe(false);
        expect(equals([1], undefined)).toBe(false);
    });

    it("two undefined are equal — through the reference identity branch", () => {
        expect(equals(undefined, undefined)).toBe(true);
    });

    it("different lengths are unequal, and so are equal lengths with different elements", () => {
        expect(equals([1, 2], [1])).toBe(false);
        expect(equals([1, 2], [1, 3])).toBe(false);
        expect(equals([1, 2], [1, 2])).toBe(true);
    });

    it("respects the passed equality predicate", () => {
        expect(equals([{ v: 1 }], [{ v: 1 }])).toBe(false);
        expect(equals([{ v: 1 }], [{ v: 1 }], (a, b) => a.v === b.v)).toBe(true);
    });
});

describe("groupAdjacentBy", () => {
    it("empty input gives empty output", () => {
        expect([...groupAdjacentBy([], () => true)]).toEqual([]);
    });

    it("groups only neighbors, not all equal values", () => {
        expect([...groupAdjacentBy([1, 1, 2, 1], (a, b) => a === b)]).toEqual([[1, 1], [2], [1]]);
    });

    it("does not group when the predicate is always false", () => {
        expect([...groupAdjacentBy([1, 2], () => false)]).toEqual([[1], [2]]);
    });
});

describe("neighbor iteration", () => {
    it("forEachAdjacent also visits the boundaries with undefined", () => {
        const seen: [number | undefined, number | undefined][] = [];
        forEachAdjacent([1, 2], (a, b) => seen.push([a, b]));
        expect(seen).toEqual([
            [undefined, 1],
            [1, 2],
            [2, undefined],
        ]);
    });

    it("forEachWithNeighbors gives the previous and next element", () => {
        const seen: [number | undefined, number, number | undefined][] = [];
        forEachWithNeighbors([1, 2, 3], (before, el, after) => seen.push([before, el, after]));
        expect(seen).toEqual([
            [undefined, 1, 2],
            [1, 2, 3],
            [2, 3, undefined],
        ]);
    });

    it("iteration over an empty array does nothing", () => {
        const seen: unknown[] = [];
        forEachWithNeighbors([], (...args) => seen.push(args));
        expect(seen).toEqual([]);
    });
});

describe("pushMany / sumBy", () => {
    it("pushMany appends to the existing array instead of creating a new one", () => {
        const target = [1];
        pushMany(target, [2, 3]);
        expect(target).toEqual([1, 2, 3]);
    });

    it("sumBy adds up projections, gives 0 for an empty array", () => {
        expect(sumBy([{ n: 2 }, { n: 3 }], (x) => x.n)).toBe(5);
        expect(sumBy([], (x: { n: number }) => x.n)).toBe(0);
    });
});

describe("arrayInsert", () => {
    it("inserts an array at an index, leaving the original alone", () => {
        const target = [1, 2, 3];
        expect(arrayInsert(target, 1, [8, 9])).toEqual([1, 8, 9, 2, 3]);
        expect(arrayInsert(target, 0, [0])).toEqual([0, 1, 2, 3]);
        expect(arrayInsert(target, 3, [4])).toEqual([1, 2, 3, 4]);
        expect(target).toEqual([1, 2, 3]);
    });
});

describe("spliceInChunks", () => {
    it("inserts more items than one spread argument list takes, in order, after the deleted ones", () => {
        const target = [1, 2, 3, 4];
        const items = Array.from({ length: SPLICE_CHUNK * 2 + 5 }, (_, i) => i + 100);

        spliceInChunks(target, 1, 2, items);

        expect(target).toEqual([1, ...items, 4]);
    });
});
