import { describe, expect, it } from "vitest";

import {
    computeCodePoint,
    containsRTL,
    containsUnusualLineTerminators,
    firstNonWhitespaceIndex,
    getNextCodePoint,
    isBasicASCII,
    isHighSurrogate,
    isLowSurrogate,
    lastNonWhitespaceIndex,
    startsWithUTF8BOM,
    UTF8_BOM_CHARACTER,
} from "./strings.ts";

/** Потребители — перенесённые `model/pieceTreeTextBuffer/*` и `model/textModelSearch.ts`. */

describe("firstNonWhitespaceIndex", () => {
    it("пропускает пробелы и табы", () => {
        expect(firstNonWhitespaceIndex(" \t x")).toBe(3);
    });

    it("непробельный первый символ — 0", () => {
        expect(firstNonWhitespaceIndex("x ")).toBe(0);
    });

    it("пустая или пробельная строка — -1", () => {
        expect(firstNonWhitespaceIndex("")).toBe(-1);
        expect(firstNonWhitespaceIndex(" \t")).toBe(-1);
    });

    it("перевод строки — не пробел (только Space и Tab)", () => {
        expect(firstNonWhitespaceIndex(" \n")).toBe(1);
    });
});

describe("lastNonWhitespaceIndex", () => {
    it("ищет с конца строки по умолчанию", () => {
        expect(lastNonWhitespaceIndex("x y \t")).toBe(2);
    });

    it("непробельный последний символ — его индекс", () => {
        expect(lastNonWhitespaceIndex("ab")).toBe(1);
    });

    it("ищет назад от startIndex", () => {
        expect(lastNonWhitespaceIndex("ab  cd", 3)).toBe(1);
    });

    it("пустая или пробельная строка — -1", () => {
        expect(lastNonWhitespaceIndex("")).toBe(-1);
        expect(lastNonWhitespaceIndex("\t ")).toBe(-1);
    });

    it("перевод строки — не пробел (только Space и Tab)", () => {
        expect(lastNonWhitespaceIndex("\n ")).toBe(0);
    });
});

describe("суррогатные пары", () => {
    it("границы старшего суррогата включены", () => {
        expect(isHighSurrogate(0xd7ff)).toBe(false);
        expect(isHighSurrogate(0xd800)).toBe(true);
        expect(isHighSurrogate(0xdbff)).toBe(true);
        expect(isHighSurrogate(0xdc00)).toBe(false);
    });

    it("границы младшего суррогата включены", () => {
        expect(isLowSurrogate(0xdbff)).toBe(false);
        expect(isLowSurrogate(0xdc00)).toBe(true);
        expect(isLowSurrogate(0xdfff)).toBe(true);
        expect(isLowSurrogate(0xe000)).toBe(false);
    });

    it("computeCodePoint собирает кодовую точку из пары", () => {
        expect(computeCodePoint(0xd83d, 0xde00)).toBe(0x1f600);
        expect(computeCodePoint(0xd800, 0xdc00)).toBe(0x10000);
    });

    it("getNextCodePoint читает пару целиком", () => {
        const s = "a😀";
        expect(getNextCodePoint(s, s.length, 1)).toBe(0x1f600);
    });

    it("getNextCodePoint на обычном символе — его код", () => {
        expect(getNextCodePoint("ab", 2, 1)).toBe(0x62);
    });

    it("getNextCodePoint: старший суррогат в конце строки — его код", () => {
        const s = "a\ud83d";
        expect(getNextCodePoint(s, s.length, 1)).toBe(0xd83d);
    });

    it("getNextCodePoint: за старшим суррогатом не младший — код старшего", () => {
        const s = "\ud83dx";
        expect(getNextCodePoint(s, s.length, 0)).toBe(0xd83d);
    });

    it("getNextCodePoint учитывает переданную длину, а не длину строки", () => {
        expect(getNextCodePoint("😀", 1, 0)).toBe(0xd83d);
    });
});

describe("классы содержимого", () => {
    it("containsRTL видит иврит и арабский, не видит латиницу", () => {
        expect(containsRTL("abc שלום")).toBe(true);
        expect(containsRTL("مرحبا")).toBe(true);
        expect(containsRTL("hello")).toBe(false);
    });

    it("containsRTL видит RTL за пределами BMP (суррогатная пара)", () => {
        expect(containsRTL("x\u{10800}")).toBe(true);
    });

    it("isBasicASCII: печатный ASCII и \\t\\n\\r", () => {
        expect(isBasicASCII("a ~\t\r\n")).toBe(true);
        expect(isBasicASCII("")).toBe(true);
        expect(isBasicASCII("é")).toBe(false);
        expect(isBasicASCII("\x7f")).toBe(false);
        expect(isBasicASCII("a\x00")).toBe(false);
    });

    it("containsUnusualLineTerminators: LS и PS", () => {
        expect(containsUnusualLineTerminators("a b")).toBe(true);
        expect(containsUnusualLineTerminators("a b")).toBe(true);
        expect(containsUnusualLineTerminators("a\r\nb")).toBe(false);
    });
});

describe("UTF-8 BOM", () => {
    it("UTF8_BOM_CHARACTER — U+FEFF", () => {
        expect(UTF8_BOM_CHARACTER).toBe("﻿");
    });

    it("startsWithUTF8BOM смотрит только на первый символ", () => {
        expect(startsWithUTF8BOM("﻿abc")).toBe(true);
        expect(startsWithUTF8BOM("a﻿")).toBe(false);
        expect(startsWithUTF8BOM("")).toBe(false);
    });
});
