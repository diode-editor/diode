import { describe, expect, it } from "vitest";

import { DefaultLinesDiffComputer } from "../../../../editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.ts";

import type { IQuickDiffColors } from "./quickDiffDecorations.ts";
import { toGutterDecorations } from "./quickDiffDecorations.ts";

/**
 * Ожидания сняты с прогонов настоящего движка, а не из чтения кода: тест ловит и ошибку
 * конверсии, и смену поведения движка при перекате пина.
 */

const COLORS: IQuickDiffColors = { added: 0x00ff00, modified: 0x0000ff, deleted: 0xff0000 };

function gutter(original: string[], modified: string[]) {
    const diff = new DefaultLinesDiffComputer().computeDiff(original, modified, {
        ignoreTrimWhitespace: false,
        maxComputationTimeMs: Number.MAX_SAFE_INTEGER,
        computeMoves: false,
    });
    return toGutterDecorations(diff.changes, COLORS).map((d) => ({
        lines: [d.range.start.line, d.range.end.line],
        color: d.color,
        dashed: d.dashed === true,
    }));
}

describe("toGutterDecorations", () => {
    it("одинаковые тексты — баров нет", () => {
        expect(gutter(["a", "b"], ["a", "b"])).toEqual([]);
    });

    it("вставка в середину красит вставленную строку сплошным added", () => {
        expect(gutter(["a", "c"], ["a", "b", "c"])).toEqual([{ lines: [1, 1], color: COLORS.added, dashed: false }]);
    });

    it("вставка в начало красит первую строку", () => {
        expect(gutter(["b"], ["a", "b"])).toEqual([{ lines: [0, 0], color: COLORS.added, dashed: false }]);
    });

    it("вставка в конец красит последнюю строку", () => {
        expect(gutter(["a"], ["a", "b"])).toEqual([{ lines: [1, 1], color: COLORS.added, dashed: false }]);
    });

    it("правка красит изменённые строки пунктиром", () => {
        expect(gutter(["a", "b", "c"], ["a", "B2", "C2"])).toEqual([
            { lines: [1, 2], color: COLORS.modified, dashed: true },
        ]);
    });

    it("удаление в середине — одна граничная строка НАД местом удаления", () => {
        // Строки "b" в новом файле нет; бар садится на "a".
        expect(gutter(["a", "b", "c"], ["a", "c"])).toEqual([{ lines: [0, 0], color: COLORS.deleted, dashed: false }]);
    });

    it("удаление в начале прижимается к первой строке, а не уезжает за границу", () => {
        // Границы сверху нет — без клампа получили бы отрицательный номер строки.
        expect(gutter(["a", "b", "c"], ["b", "c"])).toEqual([{ lines: [0, 0], color: COLORS.deleted, dashed: false }]);
    });

    it("удаление в конце садится на последнюю оставшуюся строку", () => {
        expect(gutter(["a", "b", "c"], ["a", "b"])).toEqual([{ lines: [1, 1], color: COLORS.deleted, dashed: false }]);
    });

    it("несколько ханков дают несколько баров", () => {
        expect(gutter(["a", "b", "c", "d", "e"], ["A", "b", "c", "E"])).toEqual([
            { lines: [0, 0], color: COLORS.modified, dashed: true },
            { lines: [3, 3], color: COLORS.modified, dashed: true },
        ]);
    });

    it("пустой файл → контент: бар на весь новый файл", () => {
        expect(gutter([""], ["x", "y"])).toEqual([{ lines: [0, 1], color: COLORS.modified, dashed: true }]);
    });

    it("многострочная вставка красит весь блок одним баром", () => {
        expect(gutter(["a", "z"], ["a", "b", "c", "d", "z"])).toEqual([
            { lines: [1, 3], color: COLORS.added, dashed: false },
        ]);
    });
});
