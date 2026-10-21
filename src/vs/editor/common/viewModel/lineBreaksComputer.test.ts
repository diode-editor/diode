import { describe, expect, it } from "vitest";

import { computeLineBreakOffsets, MIN_WRAP_WIDTH } from "./lineBreaksComputer.ts";
import { STOP_RENDERING_LINE_AFTER } from "./longLineRendering.ts";

describe("computeLineBreakOffsets — базовые случаи", () => {
    it("строка, влезающая в ширину, не переносится (null)", () => {
        expect(computeLineBreakOffsets("hello", 4, 10)).toBeNull();
        expect(computeLineBreakOffsets("", 4, 10)).toBeNull();
        expect(computeLineBreakOffsets("абвгдеежзи", 4, 10)).toBeNull();
    });

    it("переносит по границе слова: пробел остаётся в хвосте предыдущего фрагмента", () => {
        // "aaaa bbbb " (10 columns) + "cccc": the first one that doesn't fit is c.
        expect(computeLineBreakOffsets("aaaa bbbb cccc", 4, 10)).toEqual([10]);
    });

    it("перенос после пробельного ПРОГОНА: все пробелы висят на первом фрагменте", () => {
        // "aa" + 6 spaces = 8 columns, word b starts right past the width.
        expect(computeLineBreakOffsets("aa      bbbbbbbb", 4, 8)).toEqual([8]);
    });

    it("слово длиннее ширины режется жёстко по границе графемы", () => {
        expect(computeLineBreakOffsets("abcdefghijklmnop", 4, 8)).toEqual([8]);
    });

    it("несколько переносов: и по словам, и жёсткая резка длинного слова", () => {
        // "aaaa " + 20×b, width 8: word wrap at 5, then b is cut every 8.
        expect(computeLineBreakOffsets(`aaaa ${"b".repeat(20)}`, 4, 8)).toEqual([5, 13, 21]);
    });

    it("хвостовые пробелы не создают переносов и пустых фрагментов", () => {
        expect(computeLineBreakOffsets("aaaaaaaa    ", 4, 8)).toBeNull();
    });

    it("табы считаются по колонкам (tab stops), перенос — после таба", () => {
        // tab (4 columns) + "aaaa" = 8 columns; "bbb" doesn't fit → wrap after the whitespace run.
        expect(computeLineBreakOffsets("\taaaa bbb", 4, 8)).toEqual([6]);
    });
});

describe("computeLineBreakOffsets — широкие символы и CJK", () => {
    it("CJK без пробелов режется по графемам, wide-пара не рвётся", () => {
        // 5 ideographs of 2 columns each = 10 > 8; 4 fit (8 columns).
        expect(computeLineBreakOffsets("字字字字字", 4, 8)).toEqual([4]);
    });

    it("широкий символ на границе не рвётся — фрагмент короче на колонку", () => {
        // Width 9: four 字 take 8, the fifth (10) doesn't fit whole.
        expect(computeLineBreakOffsets("字字字字字", 4, 9)).toEqual([4]);
    });

    it("перенос по кандидату, за которым слово всё равно не влезло — двойная резка", () => {
        // " a字字字字": ws(0) a(1) 字×4 (cols 2..10). The last 字 (cols 8-10)
        // overflows width 8 twice: a wrap at the candidate (after ws) and a hard cut.
        expect(computeLineBreakOffsets(" a字字字字", 4, 8)).toEqual([1, 5]);
    });
});

describe("computeLineBreakOffsets — клампы и пороги", () => {
    it("ширина клампится снизу к MIN_WRAP_WIDTH", () => {
        // With the honest width 1 a word would be cut per character; the clamp cuts every 8.
        expect(computeLineBreakOffsets("abcdefghijklmnop", 4, 1)).toEqual([MIN_WRAP_WIDTH]);
    });

    it("одиночный слот шире ширины (гигантский таб) не режется и не зацикливает", () => {
        // A tab at tabSize=16 is wider than the clamp of 8, but a tab is whitespace: no wrap is created.
        expect(computeLineBreakOffsets("\t\t", 16, 8)).toBeNull();
    });

    it("хвост за STOP_RENDERING_LINE_AFTER не сканируется", () => {
        const breaks = computeLineBreakOffsets("x".repeat(STOP_RENDERING_LINE_AFTER + 5000), 4, 50);
        expect(breaks).not.toBeNull();
        // The parsed prefix (10,000) yields exactly 199 cuts of 50 columns…
        expect(breaks).toHaveLength(STOP_RENDERING_LINE_AFTER / 50 - 1);
        // …and none past the threshold.
        expect(breaks?.at(-1)).toBe(STOP_RENDERING_LINE_AFTER - 50);
    });
});
