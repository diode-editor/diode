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

/** Consumers: the vendored `model/pieceTreeTextBuffer/*` and `model/textModelSearch.ts`. */

describe("firstNonWhitespaceIndex", () => {
    it("skips spaces and tabs", () => {
        expect(firstNonWhitespaceIndex(" \t x")).toBe(3);
    });

    it("a non-whitespace first character gives 0", () => {
        expect(firstNonWhitespaceIndex("x ")).toBe(0);
    });

    it("an empty or whitespace-only string gives -1", () => {
        expect(firstNonWhitespaceIndex("")).toBe(-1);
        expect(firstNonWhitespaceIndex(" \t")).toBe(-1);
    });

    it("a line break is not whitespace (only Space and Tab)", () => {
        expect(firstNonWhitespaceIndex(" \n")).toBe(1);
    });
});

describe("lastNonWhitespaceIndex", () => {
    it("searches from the end of the string by default", () => {
        expect(lastNonWhitespaceIndex("x y \t")).toBe(2);
    });

    it("a non-whitespace last character gives its index", () => {
        expect(lastNonWhitespaceIndex("ab")).toBe(1);
    });

    it("searches backwards from startIndex", () => {
        expect(lastNonWhitespaceIndex("ab  cd", 3)).toBe(1);
    });

    it("an empty or whitespace-only string gives -1", () => {
        expect(lastNonWhitespaceIndex("")).toBe(-1);
        expect(lastNonWhitespaceIndex("\t ")).toBe(-1);
    });

    it("a line break is not whitespace (only Space and Tab)", () => {
        expect(lastNonWhitespaceIndex("\n ")).toBe(0);
    });
});

describe("surrogate pairs", () => {
    it("high surrogate bounds are inclusive", () => {
        expect(isHighSurrogate(0xd7ff)).toBe(false);
        expect(isHighSurrogate(0xd800)).toBe(true);
        expect(isHighSurrogate(0xdbff)).toBe(true);
        expect(isHighSurrogate(0xdc00)).toBe(false);
    });

    it("low surrogate bounds are inclusive", () => {
        expect(isLowSurrogate(0xdbff)).toBe(false);
        expect(isLowSurrogate(0xdc00)).toBe(true);
        expect(isLowSurrogate(0xdfff)).toBe(true);
        expect(isLowSurrogate(0xe000)).toBe(false);
    });

    it("computeCodePoint builds the code point from a pair", () => {
        expect(computeCodePoint(0xd83d, 0xde00)).toBe(0x1f600);
        expect(computeCodePoint(0xd800, 0xdc00)).toBe(0x10000);
    });

    it("getNextCodePoint reads the whole pair", () => {
        const s = "a😀";
        expect(getNextCodePoint(s, s.length, 1)).toBe(0x1f600);
    });

    it("getNextCodePoint on a plain character gives its code", () => {
        expect(getNextCodePoint("ab", 2, 1)).toBe(0x62);
    });

    it("getNextCodePoint: a high surrogate at the end of the string gives its code", () => {
        const s = "a\ud83d";
        expect(getNextCodePoint(s, s.length, 1)).toBe(0xd83d);
    });

    it("getNextCodePoint: a high surrogate not followed by a low one gives the high code", () => {
        const s = "\ud83dx";
        expect(getNextCodePoint(s, s.length, 0)).toBe(0xd83d);
    });

    it("getNextCodePoint respects the passed length, not the string length", () => {
        expect(getNextCodePoint("😀", 1, 0)).toBe(0xd83d);
    });
});

describe("content classes", () => {
    it("containsRTL detects Hebrew and Arabic, not Latin", () => {
        expect(containsRTL("abc שלום")).toBe(true);
        expect(containsRTL("مرحبا")).toBe(true);
        expect(containsRTL("hello")).toBe(false);
    });

    it("containsRTL detects RTL beyond the BMP (surrogate pair)", () => {
        expect(containsRTL("x\u{10800}")).toBe(true);
    });

    it("isBasicASCII: printable ASCII and \\t\\n\\r", () => {
        expect(isBasicASCII("a ~\t\r\n")).toBe(true);
        expect(isBasicASCII("")).toBe(true);
        expect(isBasicASCII("é")).toBe(false);
        expect(isBasicASCII("\x7f")).toBe(false);
        expect(isBasicASCII("a\x00")).toBe(false);
    });

    it("containsUnusualLineTerminators: LS and PS", () => {
        expect(containsUnusualLineTerminators("a b")).toBe(true);
        expect(containsUnusualLineTerminators("a b")).toBe(true);
        expect(containsUnusualLineTerminators("a\r\nb")).toBe(false);
    });
});

describe("UTF-8 BOM", () => {
    it("UTF8_BOM_CHARACTER — U+FEFF", () => {
        expect(UTF8_BOM_CHARACTER).toBe("﻿");
    });

    it("startsWithUTF8BOM looks only at the first character", () => {
        expect(startsWithUTF8BOM("﻿abc")).toBe(true);
        expect(startsWithUTF8BOM("a﻿")).toBe(false);
        expect(startsWithUTF8BOM("")).toBe(false);
    });
});
