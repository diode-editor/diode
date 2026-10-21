import { describe, expect, it } from "vitest";

import { DefaultLinesDiffComputer } from "./defaultLinesDiffComputer/defaultLinesDiffComputer.ts";
import type { ILinesDiffComputerOptions } from "./linesDiffComputer.ts";

/**
 * Не пересказ upstream (корпус — `diffFixtures.test.ts`), а свойства, на которые
 * мы закладываемся. Ожидания сняты с реальных прогонов, а не выведены из кода.
 */

const BASE: ILinesDiffComputerOptions = {
    ignoreTrimWhitespace: false,
    maxComputationTimeMs: Number.MAX_SAFE_INTEGER,
    computeMoves: false,
};

function diff(original: string[], modified: string[], patch: Partial<ILinesDiffComputerOptions> = {}) {
    return new DefaultLinesDiffComputer().computeDiff(original, modified, { ...BASE, ...patch });
}

describe("DefaultLinesDiffComputer — контракт", () => {
    it("одинаковые тексты дают пустой набор изменений", () => {
        const result = diff(["a", "b"], ["a", "b"]);
        expect(result.changes).toHaveLength(0);
        expect(result.moves).toHaveLength(0);
        expect(result.hitTimeout).toBe(false);
    });

    it("пустой → контент: одна вставка на весь файл", () => {
        const result = diff([""], ["x", "y"]);
        expect(result.changes.map((c) => c.toString())).toEqual(["{[1,2)->[1,3)}"]);
    });

    it("контент → пустой: одно удаление на весь файл", () => {
        const result = diff(["x", "y"], [""]);
        expect(result.changes.map((c) => c.toString())).toEqual(["{[1,3)->[1,2)}"]);
    });

    it("вставка строки в середину не трогает соседей", () => {
        // Оригинальный диапазон пустой ([2,2)) — вставка между строк, а не замена.
        const result = diff(["a", "c"], ["a", "b", "c"]);
        expect(result.changes.map((c) => c.toString())).toEqual(["{[2,2)->[2,3)}"]);
    });

    it("удаление строки из середины не трогает соседей", () => {
        const result = diff(["a", "b", "c"], ["a", "c"]);
        expect(result.changes.map((c) => c.toString())).toEqual(["{[2,3)->[2,2)}"]);
    });

    it("innerChanges сужают правку до изменившихся символов", () => {
        const result = diff(["const a = 1;"], ["const a = 2;"]);
        expect(result.changes).toHaveLength(1);
        expect(result.changes[0].innerChanges?.map((i) => i.toString())).toEqual(["{[1,11 -> 1,12]->[1,11 -> 1,12]}"]);
    });

    it("ignoreTrimWhitespace убирает различие только в хвостовых пробелах", () => {
        expect(diff(["a"], ["a  "], { ignoreTrimWhitespace: false }).changes).toHaveLength(1);
        expect(diff(["a"], ["a  "], { ignoreTrimWhitespace: true }).changes).toHaveLength(0);
    });

    it("computeMoves находит перемещённый блок и выключается опцией", () => {
        const block = ["function moved() {", "    const a = 1;", "    const b = 2;", "    return a + b;", "}"];
        const tail = ["function stays() {", "    return 42;", "}"];
        const original = [...block, "", ...tail];
        const modified = [...tail, "", ...block];

        const withMoves = diff(original, modified, { computeMoves: true });
        expect(withMoves.moves.map((m) => m.lineRangeMapping.toString())).toEqual(["{[6,10)->[1,5)}"]);

        expect(diff(original, modified, { computeMoves: false }).moves).toHaveLength(0);
    });

    it("maxComputationTimeMs поднимает hitTimeout вместо зависания", () => {
        const original = Array.from({ length: 4000 }, (_, i) => `line ${i}`);
        const modified = Array.from({ length: 4000 }, (_, i) => `LINE ${(i * 7) % 4000}`);

        const result = diff(original, modified, { maxComputationTimeMs: 1 });

        expect(result.hitTimeout).toBe(true);
        expect(result.changes.length).toBeGreaterThan(0);
    });
});
