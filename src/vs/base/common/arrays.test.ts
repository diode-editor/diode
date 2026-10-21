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
    sumBy,
} from "./arrays.ts";

/** The diff engine fixture corpus runs the shim end to end but misses the edge branches; they are here. */

describe("CompareResult", () => {
    it("классифицирует результат сравнения", () => {
        expect(CompareResult.isLessThan(-1)).toBe(true);
        expect(CompareResult.isLessThan(0)).toBe(false);
        expect(CompareResult.isLessThanOrEqual(0)).toBe(true);
        expect(CompareResult.isLessThanOrEqual(1)).toBe(false);
        expect(CompareResult.isGreaterThan(1)).toBe(true);
        expect(CompareResult.isGreaterThan(0)).toBe(false);
        expect(CompareResult.isNeitherLessOrGreaterThan(0)).toBe(true);
        expect(CompareResult.isNeitherLessOrGreaterThan(1)).toBe(false);
    });

    it("несёт канонические константы", () => {
        expect([CompareResult.lessThan, CompareResult.neitherLessOrGreaterThan, CompareResult.greaterThan]).toEqual([
            -1, 0, 1,
        ]);
    });
});

describe("компараторы", () => {
    it("numberComparator задаёт естественный порядок", () => {
        expect([3, 1, 2].sort(numberComparator)).toEqual([1, 2, 3]);
    });

    it("reverseOrder переворачивает порядок", () => {
        expect([3, 1, 2].sort(reverseOrder(numberComparator))).toEqual([3, 2, 1]);
    });

    it("compareBy сравнивает по проекции", () => {
        const byLength = compareBy((s: string) => s.length, numberComparator);
        expect(["aaa", "a", "aa"].sort(byLength)).toEqual(["a", "aa", "aaa"]);
    });
});

describe("equals", () => {
    it("одна и та же ссылка равна себе", () => {
        const arr = [1, 2];
        expect(equals(arr, arr)).toBe(true);
    });

    it("undefined с любой стороны даёт неравенство", () => {
        expect(equals(undefined, [1])).toBe(false);
        expect(equals([1], undefined)).toBe(false);
    });

    it("оба undefined равны — через ветку идентичности ссылок", () => {
        expect(equals(undefined, undefined)).toBe(true);
    });

    it("разная длина — неравенство, одинаковая с разными элементами — тоже", () => {
        expect(equals([1, 2], [1])).toBe(false);
        expect(equals([1, 2], [1, 3])).toBe(false);
        expect(equals([1, 2], [1, 2])).toBe(true);
    });

    it("учитывает переданный предикат равенства", () => {
        expect(equals([{ v: 1 }], [{ v: 1 }])).toBe(false);
        expect(equals([{ v: 1 }], [{ v: 1 }], (a, b) => a.v === b.v)).toBe(true);
    });
});

describe("groupAdjacentBy", () => {
    it("пустой вход даёт пустой выход", () => {
        expect([...groupAdjacentBy([], () => true)]).toEqual([]);
    });

    it("группирует только соседей, а не все одинаковые значения", () => {
        expect([...groupAdjacentBy([1, 1, 2, 1], (a, b) => a === b)]).toEqual([[1, 1], [2], [1]]);
    });

    it("не группирует, когда предикат всегда ложен", () => {
        expect([...groupAdjacentBy([1, 2], () => false)]).toEqual([[1], [2]]);
    });
});

describe("обход соседей", () => {
    it("forEachAdjacent проходит и границы с undefined", () => {
        const seen: [number | undefined, number | undefined][] = [];
        forEachAdjacent([1, 2], (a, b) => seen.push([a, b]));
        expect(seen).toEqual([
            [undefined, 1],
            [1, 2],
            [2, undefined],
        ]);
    });

    it("forEachWithNeighbors даёт предыдущий и следующий элемент", () => {
        const seen: [number | undefined, number, number | undefined][] = [];
        forEachWithNeighbors([1, 2, 3], (before, el, after) => seen.push([before, el, after]));
        expect(seen).toEqual([
            [undefined, 1, 2],
            [1, 2, 3],
            [2, 3, undefined],
        ]);
    });

    it("на пустом массиве обходы ничего не делают", () => {
        const seen: unknown[] = [];
        forEachWithNeighbors([], (...args) => seen.push(args));
        expect(seen).toEqual([]);
    });
});

describe("pushMany / sumBy", () => {
    it("pushMany дописывает в существующий массив, а не создаёт новый", () => {
        const target = [1];
        pushMany(target, [2, 3]);
        expect(target).toEqual([1, 2, 3]);
    });

    it("sumBy складывает проекции, на пустом даёт 0", () => {
        expect(sumBy([{ n: 2 }, { n: 3 }], (x) => x.n)).toBe(5);
        expect(sumBy([], (x: { n: number }) => x.n)).toBe(0);
    });
});

describe("arrayInsert", () => {
    it("вставляет массив по индексу, исходный не трогает", () => {
        const target = [1, 2, 3];
        expect(arrayInsert(target, 1, [8, 9])).toEqual([1, 8, 9, 2, 3]);
        expect(arrayInsert(target, 0, [0])).toEqual([0, 1, 2, 3]);
        expect(arrayInsert(target, 3, [4])).toEqual([1, 2, 3, 4]);
        expect(target).toEqual([1, 2, 3]);
    });
});
