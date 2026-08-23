import { describe, expect, it } from "vitest";

import type { ISelection } from "./iSelection.ts";
import { createCursorSelection, createSelection } from "./iSelection.ts";
import { sortAndMergeSelections } from "./sortAndMergeSelections.ts";

/** Компактный вид выделения для ассертов: [anchorLine, anchorCh, activeLine, activeCh]. */
function shape(selection: ISelection): number[] {
    return [selection.anchor.line, selection.anchor.character, selection.active.line, selection.active.character];
}

describe("sortAndMergeSelections — вырожденные входы", () => {
    it("пустой массив остаётся пустым", () => {
        expect(sortAndMergeSelections([])).toEqual([]);
    });

    it("одно выделение возвращается копией массива, а не тем же массивом", () => {
        const input = [createCursorSelection(0, 3)];
        const result = sortAndMergeSelections(input);
        expect(result).toHaveLength(1);
        expect(result[0]).toBe(input[0]);
        expect(result).not.toBe(input);
    });
});

describe("sortAndMergeSelections — сортировка", () => {
    it("расставляет каретки в документном порядке", () => {
        const result = sortAndMergeSelections([
            createCursorSelection(2, 0),
            createCursorSelection(0, 5),
            createCursorSelection(1, 1),
        ]);
        expect(result.map((sel) => sel.active.line)).toEqual([0, 1, 2]);
    });

    it("сортирует по началу диапазона, а не по active (обратное выделение)", () => {
        // Обратное выделение (2,0)→(0,0): его начало — строка 0, значит оно первое.
        const backwards = createSelection(2, 0, 0, 0);
        const later = createCursorSelection(3, 0);
        expect(sortAndMergeSelections([later, backwards])[0]).toBe(backwards);
    });

    it("при общем начале порядок задаёт конец диапазона, а не стабильность sort", () => {
        const longer = createSelection(0, 0, 0, 6);
        const shorter = createSelection(0, 0, 0, 2);
        // Оба порядка на входе дают один и тот же результат — это и есть детерминизм.
        expect(sortAndMergeSelections([longer, shorter])).toHaveLength(1);
        expect(shape(sortAndMergeSelections([longer, shorter])[0])).toEqual([0, 0, 0, 6]);
        expect(shape(sortAndMergeSelections([shorter, longer])[0])).toEqual([0, 0, 0, 6]);
    });
});

describe("sortAndMergeSelections — слияние с участием каретки", () => {
    it("две каретки в одной точке сливаются в одну", () => {
        const result = sortAndMergeSelections([createCursorSelection(1, 4), createCursorSelection(1, 4)]);
        expect(result).toHaveLength(1);
        expect(shape(result[0])).toEqual([1, 4, 1, 4]);
    });

    it("каретка внутри выделения растворяется в нём", () => {
        const result = sortAndMergeSelections([createSelection(0, 0, 0, 5), createCursorSelection(0, 3)]);
        expect(result).toHaveLength(1);
        expect(shape(result[0])).toEqual([0, 0, 0, 5]);
    });

    it("каретка ровно на конце выделения считается касанием и сливается", () => {
        const result = sortAndMergeSelections([createSelection(0, 0, 0, 5), createCursorSelection(0, 5)]);
        expect(result).toHaveLength(1);
        expect(shape(result[0])).toEqual([0, 0, 0, 5]);
    });

    it("каретка ровно на начале выделения тоже сливается", () => {
        const result = sortAndMergeSelections([createSelection(0, 2, 0, 5), createCursorSelection(0, 2)]);
        expect(result).toHaveLength(1);
        expect(shape(result[0])).toEqual([0, 2, 0, 5]);
    });

    it("каретка за концом выделения остаётся отдельным курсором", () => {
        const result = sortAndMergeSelections([createSelection(0, 0, 0, 5), createCursorSelection(0, 6)]);
        expect(result).toHaveLength(2);
    });
});

describe("sortAndMergeSelections — слияние непустых выделений", () => {
    it("выделения встык НЕ сливаются (паритет с VS Code)", () => {
        const result = sortAndMergeSelections([createSelection(0, 0, 0, 2), createSelection(0, 2, 0, 4)]);
        expect(result).toHaveLength(2);
        expect(result.map(shape)).toEqual([
            [0, 0, 0, 2],
            [0, 2, 0, 4],
        ]);
    });

    it("настоящее пересечение даёт диапазон-объединение", () => {
        const result = sortAndMergeSelections([createSelection(0, 0, 0, 4), createSelection(0, 2, 0, 7)]);
        expect(result).toHaveLength(1);
        expect(shape(result[0])).toEqual([0, 0, 0, 7]);
    });

    it("вложенное выделение поглощается объемлющим", () => {
        const result = sortAndMergeSelections([createSelection(0, 0, 0, 9), createSelection(0, 3, 0, 5)]);
        expect(result).toHaveLength(1);
        expect(shape(result[0])).toEqual([0, 0, 0, 9]);
    });

    it("пересечение через границу строк", () => {
        const result = sortAndMergeSelections([createSelection(0, 2, 1, 3), createSelection(1, 1, 2, 4)]);
        expect(result).toHaveLength(1);
        expect(shape(result[0])).toEqual([0, 2, 2, 4]);
    });

    it("каскад: слияние первых двух открывает слияние с третьим", () => {
        const result = sortAndMergeSelections([
            createSelection(0, 0, 0, 3),
            createSelection(0, 2, 0, 6),
            createSelection(0, 5, 0, 9),
        ]);
        expect(result).toHaveLength(1);
        expect(shape(result[0])).toEqual([0, 0, 0, 9]);
    });

    it("несливаемые соседи остаются в документном порядке", () => {
        const result = sortAndMergeSelections([
            createSelection(2, 0, 2, 1),
            createSelection(0, 0, 0, 4),
            createSelection(0, 2, 0, 6),
        ]);
        expect(result.map(shape)).toEqual([
            [0, 0, 0, 6],
            [2, 0, 2, 1],
        ]);
    });
});

describe("sortAndMergeSelections — направление и idealColumn", () => {
    it("направление наследуется от позже добавленного (он идёт вторым, LTR)", () => {
        // Первое — обратное, второе (позже добавленное) — прямое: побеждает прямое.
        const result = sortAndMergeSelections([createSelection(0, 4, 0, 0), createSelection(0, 2, 0, 7)]);
        expect(shape(result[0])).toEqual([0, 0, 0, 7]);
    });

    it("направление наследуется от позже добавленного и когда он обратный", () => {
        const result = sortAndMergeSelections([createSelection(0, 0, 0, 4), createSelection(0, 7, 0, 2)]);
        expect(shape(result[0])).toEqual([0, 7, 0, 0]);
    });

    it("позже добавленный побеждает независимо от места в документе", () => {
        // Победитель (index 1) начинается РАНЬШЕ, то есть после сортировки идёт первым.
        const result = sortAndMergeSelections([createSelection(0, 3, 0, 7), createSelection(0, 5, 0, 1)]);
        expect(shape(result[0])).toEqual([0, 7, 0, 1]);
    });

    it("idealColumn переносится, когда active победителя не сдвинулся", () => {
        const winner = createSelection(0, 2, 0, 7, 42);
        const result = sortAndMergeSelections([createSelection(0, 0, 0, 4), winner]);
        expect(result[0].idealColumn).toBe(42);
    });

    it("idealColumn сбрасывается, когда active победителя переехал", () => {
        // Победитель обратный: его active в 2, а объединение начинается в 0 — колонка врала бы.
        const winner = createSelection(0, 5, 0, 2, 42);
        const result = sortAndMergeSelections([createSelection(0, 0, 0, 4), winner]);
        expect(shape(result[0])).toEqual([0, 5, 0, 0]);
        expect(result[0].idealColumn).toBeUndefined();
    });

    it("каскад держит возраст победителя: третье выделение сравнивается с ним", () => {
        const result = sortAndMergeSelections([
            createSelection(0, 0, 0, 3),
            createSelection(0, 6, 0, 2, 11),
            createSelection(0, 4, 0, 5),
        ]);
        expect(result).toHaveLength(1);
        // Возраст объединения — от победителя первой пары (index 1); index 2 моложе,
        // значит направление берётся у него (прямое), а idealColumn победителя не переносится.
        expect(shape(result[0])).toEqual([0, 0, 0, 6]);
        expect(result[0].idealColumn).toBeUndefined();
    });
});
