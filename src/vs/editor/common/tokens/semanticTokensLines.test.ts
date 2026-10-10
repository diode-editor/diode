import { describe, expect, it } from "vitest";

import { createRange } from "../core/iRange.ts";
import type { ISemanticTokensLegend } from "../languages/iSemanticTokensSource.ts";

import { countEOL, decodeSemanticTokens, SemanticTokensLines } from "./semanticTokensLines.ts";

const LEGEND: ISemanticTokensLegend = { tokenTypes: ["a", "b"], tokenModifiers: ["m"] };
const OTHER: ISemanticTokensLegend = { tokenTypes: ["x"], tokenModifiers: [] };

/** Строки с токенами `[start, end]` (тип 1, модификаторы 2) по номерам строк. */
function linesOf(spec: Record<number, readonly (readonly [number, number])[]>, legend = LEGEND): SemanticTokensLines {
    const lines = new SemanticTokensLines();
    for (const [line, tokens] of Object.entries(spec)) {
        const entry = lines.ensureLine(Number(line), legend);
        for (const [start, end] of tokens) entry.tokens.push(start, end, 1, 2);
    }
    return lines;
}

/** Снимок: номер строки → пары `[start, end]`. */
function dump(lines: SemanticTokensLines): Record<number, number[][]> {
    const result: Record<number, number[][]> = {};
    for (const line of lines.lineNumbers) {
        const tokens = lines.getLine(line)?.tokens ?? [];
        const pairs: number[][] = [];
        for (let i = 0; i < tokens.length; i += 4) pairs.push([tokens[i], tokens[i + 1]]);
        result[line] = pairs;
    }
    return result;
}

function edit(
    lines: SemanticTokensLines,
    startLine: number,
    startChar: number,
    endLine: number,
    endChar: number,
    text: string,
): Record<number, number[][]> {
    lines.applyEdit(createRange(startLine, startChar, endLine, endChar), text);
    return dump(lines);
}

describe("countEOL", () => {
    it("переводы строки — только \\n; \\r остаётся символом строки", () => {
        expect(countEOL("")).toEqual([0, 0, 0]);
        expect(countEOL("abc")).toEqual([0, 3, 3]);
        expect(countEOL("ab\ncd\nefg")).toEqual([2, 2, 3]);
        expect(countEOL("a\r\nb")).toEqual([1, 2, 1]);
        expect(countEOL("a\rb")).toEqual([0, 3, 3]);
        expect(countEOL("\n")).toEqual([1, 0, 0]);
    });
});

describe("decodeSemanticTokens", () => {
    it("дельты строк и символов → абсолютные токены по строкам с типом и модификаторами", () => {
        const lines = decodeSemanticTokens(new Uint32Array([0, 1, 2, 3, 4, 0, 3, 1, 5, 6, 2, 4, 3, 7, 8]), LEGEND);
        expect(lines.lineNumbers).toEqual([0, 2]);
        expect(lines.getLine(0)).toEqual({ legend: LEGEND, tokens: [1, 3, 3, 4, 4, 5, 5, 6] });
        expect(lines.getLine(2)?.tokens).toEqual([4, 7, 7, 8]);
        expect(lines.getLine(0)?.legend).toBe(LEGEND);
        expect(lines.getLine(1)).toBeUndefined();
    });

    it("нулевая длина и налезающий на предыдущий токен отбрасываются; встык — нет", () => {
        const lines = decodeSemanticTokens(
            new Uint32Array([0, 0, 4, 1, 0, 0, 2, 3, 1, 0, 0, 2, 0, 1, 0, 0, 2, 1, 1, 0]),
            LEGEND,
        );
        // [0,4]; [2,5] налезает; [4,4] нулевой; [6,7] после [4,4] (дельта от отброшенного) — встык с концом нет.
        expect(lines.getLine(0)?.tokens).toEqual([0, 4, 1, 0, 6, 7, 1, 0]);
    });

    it("отброшенный токен, открывший строку, не уводит следующие токены в прошлую строку", () => {
        const lines = decodeSemanticTokens(new Uint32Array([0, 0, 2, 1, 0, 1, 0, 0, 1, 0, 0, 3, 2, 1, 0]), LEGEND);
        expect(dump(lines)).toEqual({ 0: [[0, 2]], 1: [[3, 5]] });
    });

    it("неполная последняя пятёрка игнорируется", () => {
        const lines = decodeSemanticTokens(new Uint32Array([0, 0, 2, 1, 0, 0, 3, 1, 1]), LEGEND);
        expect(lines.getLine(0)?.tokens).toEqual([0, 2, 1, 0]);
        expect(decodeSemanticTokens(new Uint32Array([]), LEGEND).lineNumbers).toEqual([]);
    });
});

describe("SemanticTokensLines — чтение и замена строк", () => {
    it("строка без токенов — undefined", () => {
        const lines = new SemanticTokensLines();
        lines.ensureLine(3, LEGEND);
        expect(lines.getLine(3)).toBeUndefined();
        expect(lines.lineNumbers).toEqual([]);
    });

    it("ensureLine возвращает существующую строку, не заменяя легенду", () => {
        const lines = new SemanticTokensLines();
        const first = lines.ensureLine(0, LEGEND);
        expect(lines.ensureLine(0, OTHER)).toBe(first);
        expect(first.legend).toBe(LEGEND);
    });

    it("replaceLines: строки диапазона — копией из источника, без токенов в источнике — очищаются", () => {
        const target = linesOf({ 0: [[0, 1]], 1: [[0, 1]], 2: [[0, 1]], 3: [[0, 1]] });
        const source = linesOf({ 1: [[5, 6]], 3: [[7, 8]] }, OTHER);
        target.replaceLines(1, 2, source);
        expect(dump(target)).toEqual({ 0: [[0, 1]], 1: [[5, 6]], 3: [[0, 1]] });
        expect(target.getLine(1)?.legend).toBe(OTHER);
        // Копия: правка источника цель не трогает.
        source.applyEdit(createRange(1, 0, 1, 0), "zz");
        expect(dump(target)[1]).toEqual([[5, 6]]);
    });

    it("replaceLines за концом известных строк кладёт строки источника", () => {
        const target = linesOf({ 0: [[0, 1]] });
        target.replaceLines(4, 6, linesOf({ 5: [[1, 2]] }));
        expect(dump(target)).toEqual({ 0: [[0, 1]], 5: [[1, 2]] });
    });
});

describe("SemanticTokensLines — удаление в одной строке (случаи эталона)", () => {
    const token = (): SemanticTokensLines => linesOf({ 0: [[5, 10]] });

    it("пустой диапазон ничего не удаляет", () => {
        expect(edit(token(), 0, 7, 0, 7, "")).toEqual({ 0: [[5, 10]] });
    });
    it("1a. токен целиком до удаления", () => {
        expect(edit(token(), 0, 10, 0, 12, "")).toEqual({ 0: [[5, 10]] });
    });
    it("1b. начинается раньше, удаление кончается после токена — обрезка до начала удаления", () => {
        expect(edit(token(), 0, 8, 0, 12, "")).toEqual({ 0: [[5, 8]] });
    });
    it("1c. удаление кончается ровно на конце токена", () => {
        expect(edit(token(), 0, 8, 0, 10, "")).toEqual({ 0: [[5, 8]] });
    });
    it("1d. удаление внутри токена — токен короче на удалённое", () => {
        expect(edit(token(), 0, 6, 0, 8, "")).toEqual({ 0: [[5, 8]] });
    });
    it("2a/2b. тот же старт, конец внутри или ровно на конце удаления — токен удалён", () => {
        expect(edit(token(), 0, 5, 0, 12, "")).toEqual({});
        expect(edit(token(), 0, 5, 0, 10, "")).toEqual({});
    });
    it("2c. тот же старт, токен длиннее удаления — укорачивается", () => {
        expect(edit(token(), 0, 5, 0, 7, "")).toEqual({ 0: [[5, 8]] });
    });
    it("3a/3b. токен внутри удаления — удалён", () => {
        expect(edit(token(), 0, 3, 0, 12, "")).toEqual({});
        expect(edit(token(), 0, 3, 0, 10, "")).toEqual({});
    });
    it("3c. начинается внутри удаления, кончается после — продолжается от его начала", () => {
        expect(edit(token(), 0, 3, 0, 7, "")).toEqual({ 0: [[3, 6]] });
    });
    it("4. токен после удаления — сдвиг влево", () => {
        expect(edit(token(), 0, 1, 0, 3, "")).toEqual({ 0: [[3, 8]] });
    });
    it("строки других номеров не трогает", () => {
        expect(edit(linesOf({ 0: [[5, 10]], 1: [[1, 2]] }), 0, 1, 0, 3, "")).toEqual({ 0: [[3, 8]], 1: [[1, 2]] });
    });
    it("тип и модификаторы токена переживают правку", () => {
        const lines = token();
        lines.applyEdit(createRange(0, 1, 0, 3), "");
        expect(lines.getLine(0)?.tokens).toEqual([3, 8, 1, 2]);
    });
    it("тип и модификаторы — у каждого токена свои во всех ветках удаления", () => {
        const single = new SemanticTokensLines();
        single.ensureLine(0, LEGEND).tokens.push(0, 2, 3, 4, 5, 10, 1, 6);
        single.applyEdit(createRange(0, 5, 0, 7), ""); // 2c
        expect(single.getLine(0)?.tokens).toEqual([0, 2, 3, 4, 5, 8, 1, 6]);

        const multi = new SemanticTokensLines();
        multi.ensureLine(0, LEGEND).tokens.push(0, 1, 3, 4);
        multi.ensureLine(1, LEGEND).tokens.push(0, 1, 5, 6, 2, 4, 7, 8, 5, 7, 9, 10);
        multi.applyEdit(createRange(0, 2, 1, 3), ""); // 1a, 3b, 3c, 4 на последней строке
        expect(multi.getLine(0)?.tokens).toEqual([0, 1, 3, 4, 2, 3, 7, 8, 4, 6, 9, 10]);
    });
});

describe("SemanticTokensLines — многострочное удаление", () => {
    it("первая строка: до — остаются, на краю — обрезаются, после — удаляются; средние уходят; последняя — подтягивается", () => {
        const lines = linesOf({
            0: [
                [0, 2],
                [3, 6],
                [7, 9],
            ],
            1: [[0, 3]],
            2: [
                [1, 3],
                [2, 6],
                [7, 9],
            ],
            3: [[1, 2]],
        });
        // (0,5)..(2,4): [2,6] на последней — 3c → [5,7]; [7,9] — 4 → [8,10]; [1,3] — 3a.
        expect(edit(lines, 0, 5, 2, 4, "")).toEqual({
            0: [
                [0, 2],
                [3, 5],
                [5, 7],
                [8, 10],
            ],
            1: [[1, 2]],
        });
    });

    it("на первой строке токен ровно с начала удаления — удаляется (2a/2b)", () => {
        // Строка 1 сливается с нулевой: её токен уезжает за точку склейки.
        expect(edit(linesOf({ 0: [[5, 9]], 1: [[0, 1]] }), 0, 5, 1, 0, "")).toEqual({ 0: [[5, 6]] });
    });

    it("на последней строке токен, кончающийся ровно на конце удаления, — удаляется (3b)", () => {
        expect(edit(linesOf({ 0: [[0, 1]], 1: [[0, 4]] }), 0, 2, 1, 4, "")).toEqual({ 0: [[0, 1]] });
    });

    it("первая строка без токенов берёт легенду последней", () => {
        const lines = linesOf({ 1: [[6, 8]] }, OTHER);
        expect(edit(lines, 0, 2, 1, 4, "")).toEqual({ 0: [[4, 6]] });
        expect(lines.getLine(0)?.legend).toBe(OTHER);
    });

    it("первая строка без токенов: 3c последней строки переезжает к началу удаления", () => {
        const lines = linesOf({ 1: [[0, 4]] });
        expect(edit(lines, 0, 2, 1, 1, "")).toEqual({ 0: [[2, 5]] });
        expect(lines.getLine(0)?.legend).toBe(LEGEND);
    });

    it("удаление со строки ниже первой: уходят ровно строки диапазона", () => {
        const lines = linesOf({ 0: [[0, 1]], 3: [[0, 2]], 4: [[1, 2]], 5: [[2, 3]] });
        expect(edit(lines, 2, 0, 3, 1, "")).toEqual({ 0: [[0, 1]], 2: [[0, 1]], 3: [[1, 2]], 4: [[2, 3]] });
    });

    it("удаление по строкам без токенов не оставляет строку без легенды", () => {
        const lines = linesOf({ 3: [[0, 1]] });
        lines.applyEdit(createRange(0, 1, 1, 0), "");
        expect(lines.ensureLine(0, OTHER).legend).toBe(OTHER);
    });

    it("токены последней строки с другой легендой отбрасываются", () => {
        const lines = linesOf({ 0: [[0, 1]] });
        lines.ensureLine(1, OTHER).tokens.push(0, 6, 0, 0, 7, 9, 0, 0);
        expect(edit(lines, 0, 2, 1, 4, "")).toEqual({ 0: [[0, 1]] });
    });

    it("удалено всё — строка пуста, строки ниже подтянуты", () => {
        const lines = linesOf({ 0: [[2, 3]], 1: [[0, 1]], 3: [[4, 5]] });
        expect(edit(lines, 0, 1, 1, 9, "")).toEqual({ 2: [[4, 5]] });
    });

    it("удаление за концом известных строк ничего не создаёт", () => {
        const lines = linesOf({ 0: [[2, 3]] });
        expect(edit(lines, 5, 0, 7, 1, "")).toEqual({ 0: [[2, 3]] });
        lines.applyEdit(createRange(9, 0, 9, 1), "");
        expect(dump(lines)).toEqual({ 0: [[2, 3]] });
    });
});

describe("SemanticTokensLines — вставка (случаи эталона)", () => {
    const token = (): SemanticTokensLines => linesOf({ 0: [[5, 10]] });

    it("1. токен целиком до точки вставки", () => {
        expect(edit(token(), 0, 12, 0, 12, "ab")).toEqual({ 0: [[5, 10]] });
    });

    it("2. токен кончается в точке вставки: растёт только на один словесный символ", () => {
        for (const ch of ["a", "z", "A", "Z", "0", "9", "m"]) {
            expect(edit(token(), 0, 10, 0, 10, ch), ch).toEqual({ 0: [[5, 11]] });
        }
        for (const ch of ["/", ":", "@", "[", "`", "{", "-", " ", "ab"]) {
            expect(edit(token(), 0, 10, 0, 10, ch), ch).toEqual({ 0: [[5, 10]] });
        }
    });

    it("3. точка вставки внутри токена: растёт на вставку, перевод строки — обрезает", () => {
        expect(edit(token(), 0, 7, 0, 7, "abc")).toEqual({ 0: [[5, 13]] });
        expect(edit(token(), 0, 7, 0, 7, "x\nyz")).toEqual({ 0: [[5, 7]] });
    });

    it("4. токен начинается в точке вставки: один словесный символ — токен стоит, иначе — сдвиг", () => {
        expect(edit(token(), 0, 5, 0, 5, "a")).toEqual({ 0: [[5, 10]] });
        expect(edit(token(), 0, 5, 0, 5, "-")).toEqual({ 0: [[6, 11]] });
        expect(edit(token(), 0, 5, 0, 5, "ab")).toEqual({ 0: [[7, 12]] });
    });

    it("5. токен после точки вставки — сдвиг вправо", () => {
        expect(edit(token(), 0, 2, 0, 2, "ab")).toEqual({ 0: [[7, 12]] });
    });

    it("многострочная вставка переносит токены правее на последнюю новую строку с её длиной", () => {
        const lines = linesOf({
            0: [
                [0, 1],
                [5, 10],
            ],
            1: [[3, 4]],
        });
        expect(edit(lines, 0, 2, 0, 2, "x\nyz")).toEqual({ 0: [[0, 1]], 1: [[5, 10]], 2: [[3, 4]] });
        const deep = linesOf({ 0: [[5, 10]], 2: [[1, 2]] });
        expect(edit(deep, 0, 2, 0, 2, "a\nb\nccc")).toEqual({ 2: [[6, 11]], 4: [[1, 2]] });
        expect(deep.getLine(2)?.legend).toBe(LEGEND);
    });

    it("перевод строки над токенами сдвигает строки ниже; на строке без токенов — тоже", () => {
        expect(edit(linesOf({ 1: [[0, 2]], 3: [[1, 2]] }), 0, 0, 0, 0, "\n\n")).toEqual({
            3: [[0, 2]],
            5: [[1, 2]],
        });
    });

    it("вставка за концом известных строк ничего не создаёт", () => {
        expect(edit(linesOf({ 0: [[0, 2]] }), 4, 0, 4, 0, "a\nb")).toEqual({ 0: [[0, 2]] });
    });

    it("замена: удаление и вставка одной правкой", () => {
        // [5,10] с заменой (1..3) → "abcd": сдвиг -2, затем +4.
        expect(edit(token(), 0, 1, 0, 3, "abcd")).toEqual({ 0: [[7, 12]] });
    });

    it("вставка в строку без токенов и без переводов строк ничего не меняет", () => {
        expect(edit(linesOf({ 1: [[0, 2]] }), 0, 0, 0, 0, "abc")).toEqual({ 1: [[0, 2]] });
    });
});
