import { describe, expect, it } from "vitest";

import { STOP_RENDERING_LINE_AFTER } from "./longLineRendering.ts";

import { computeLineBreakOffsets, MIN_WRAP_WIDTH } from "./lineBreaksComputer.ts";

describe("computeLineBreakOffsets — базовые случаи", () => {
    it("строка, влезающая в ширину, не переносится (null)", () => {
        expect(computeLineBreakOffsets("hello", 4, 10)).toBeNull();
        expect(computeLineBreakOffsets("", 4, 10)).toBeNull();
        expect(computeLineBreakOffsets("абвгдеежзи", 4, 10)).toBeNull();
    });

    it("переносит по границе слова: пробел остаётся в хвосте предыдущего фрагмента", () => {
        // "aaaa bbbb " (10 колонок) + "cccc": первый не влезший — c.
        expect(computeLineBreakOffsets("aaaa bbbb cccc", 4, 10)).toEqual([10]);
    });

    it("перенос после пробельного ПРОГОНА: все пробелы висят на первом фрагменте", () => {
        // "aa" + 6 пробелов = 8 колонок, слово b начинается ровно за шириной.
        expect(computeLineBreakOffsets("aa      bbbbbbbb", 4, 8)).toEqual([8]);
    });

    it("слово длиннее ширины режется жёстко по границе графемы", () => {
        expect(computeLineBreakOffsets("abcdefghijklmnop", 4, 8)).toEqual([8]);
    });

    it("несколько переносов: и по словам, и жёсткая резка длинного слова", () => {
        // "aaaa " + 20×b, width 8: перенос по слову на 5, дальше b режется по 8.
        expect(computeLineBreakOffsets(`aaaa ${"b".repeat(20)}`, 4, 8)).toEqual([5, 13, 21]);
    });

    it("хвостовые пробелы не создают переносов и пустых фрагментов", () => {
        expect(computeLineBreakOffsets("aaaaaaaa    ", 4, 8)).toBeNull();
    });

    it("табы считаются по колонкам (tab stops), перенос — после таба", () => {
        // tab(4 колонки) + "aaaa" = 8 колонок; "bbb" не влезает → перенос после ws-прогона.
        expect(computeLineBreakOffsets("\taaaa bbb", 4, 8)).toEqual([6]);
    });
});

describe("computeLineBreakOffsets — широкие символы и CJK", () => {
    it("CJK без пробелов режется по графемам, wide-пара не рвётся", () => {
        // 5 иероглифов по 2 колонки = 10 > 8; влезают 4 (8 колонок).
        expect(computeLineBreakOffsets("字字字字字", 4, 8)).toEqual([4]);
    });

    it("широкий символ на границе не рвётся — фрагмент короче на колонку", () => {
        // Ширина 9: четыре 字 занимают 8, пятый (10) не влезает целиком.
        expect(computeLineBreakOffsets("字字字字字", 4, 9)).toEqual([4]);
    });

    it("перенос по кандидату, за которым слово всё равно не влезло — двойная резка", () => {
        // " a字字字字": ws(0) a(1) 字×4 (кол. 2..10). Последний 字 (кол. 8-10)
        // рвёт ширину 8 дважды: перенос по кандидату (после ws) и жёсткая резка.
        expect(computeLineBreakOffsets(" a字字字字", 4, 8)).toEqual([1, 5]);
    });
});

describe("computeLineBreakOffsets — клампы и пороги", () => {
    it("ширина клампится снизу к MIN_WRAP_WIDTH", () => {
        // При честной ширине 1 слово резалось бы посимвольно; кламп даёт резку по 8.
        expect(computeLineBreakOffsets("abcdefghijklmnop", 4, 1)).toEqual([MIN_WRAP_WIDTH]);
    });

    it("одиночный слот шире ширины (гигантский таб) не режется и не зацикливает", () => {
        // Таб при tabSize=16 шире клампа 8, но таб — whitespace: перенос не создаётся.
        expect(computeLineBreakOffsets("\t\t", 16, 8)).toBeNull();
    });

    it("хвост за STOP_RENDERING_LINE_AFTER не сканируется", () => {
        const breaks = computeLineBreakOffsets("x".repeat(STOP_RENDERING_LINE_AFTER + 5000), 4, 50);
        expect(breaks).not.toBeNull();
        // Разобранный префикс (10 000) даёт ровно 199 резок по 50 колонок…
        expect(breaks).toHaveLength(STOP_RENDERING_LINE_AFTER / 50 - 1);
        // …и ни одной за порогом.
        expect(breaks?.at(-1)).toBe(STOP_RENDERING_LINE_AFTER - 50);
    });
});
