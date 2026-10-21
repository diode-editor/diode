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
    it("находит индекс последнего true", () => {
        expect(findLastIdxMonotonous(arr, upTo(3))).toBe(2);
    });

    it("возвращает -1, когда true нет ни одного", () => {
        expect(findLastIdxMonotonous(arr, upTo(0))).toBe(-1);
    });

    it("возвращает последний индекс, когда true все", () => {
        expect(findLastIdxMonotonous(arr, upTo(99))).toBe(4);
    });

    it("уважает границы startIdx/endIdxEx", () => {
        expect(findLastIdxMonotonous(arr, upTo(99), 1, 3)).toBe(2);
    });
});

describe("findLastMonotonous", () => {
    it("отдаёт сам элемент", () => {
        expect(findLastMonotonous(arr, upTo(3))).toBe(3);
    });

    it("отдаёт undefined, когда подходящего нет", () => {
        expect(findLastMonotonous(arr, upTo(0))).toBeUndefined();
    });
});

describe("findFirstIdxMonotonousOrArrLen", () => {
    // Monotonic the other way here: [false, ..., false, true, ..., true].
    const atLeast = (n: number) => (x: number) => x >= n;

    it("находит индекс первого true", () => {
        expect(findFirstIdxMonotonousOrArrLen(arr, atLeast(3))).toBe(2);
    });

    it("возвращает длину массива, когда true нет", () => {
        expect(findFirstIdxMonotonousOrArrLen(arr, atLeast(99))).toBe(arr.length);
    });

    it("уважает границы startIdx/endIdxEx", () => {
        expect(findFirstIdxMonotonousOrArrLen(arr, atLeast(1), 2, 4)).toBe(2);
    });

    it("findFirstMonotonous отдаёт элемент либо undefined", () => {
        expect(findFirstMonotonous(arr, atLeast(3))).toBe(3);
        expect(findFirstMonotonous(arr, atLeast(99))).toBeUndefined();
    });
});

describe("MonotonousArray", () => {
    it("последовательные запросы с ослабевающим предикатом идут вперёд по массиву", () => {
        const m = new MonotonousArray(arr);
        expect(m.findLastMonotonous(upTo(2))).toBe(2);
        expect(m.findLastMonotonous(upTo(4))).toBe(4);
    });

    it("отдаёт undefined, когда ни один элемент не подходит", () => {
        expect(new MonotonousArray(arr).findLastMonotonous(upTo(0))).toBeUndefined();
    });

    it("под assertInvariants ловит усиление предиката", () => {
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

    it("под assertInvariants пропускает корректную последовательность", () => {
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
