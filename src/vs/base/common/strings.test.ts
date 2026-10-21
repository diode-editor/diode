import { describe, expect, it } from "vitest";

import { commonPrefixLength, commonSuffixLength, splitLines } from "./strings.ts";

describe("commonPrefixLength", () => {
    it("считает длину общего начала", () => {
        expect(commonPrefixLength("hello", "help")).toBe(3);
    });

    it("нет общего начала — 0", () => {
        expect(commonPrefixLength("abc", "xyz")).toBe(0);
    });

    it("одна строка — префикс другой", () => {
        expect(commonPrefixLength("ab", "abcd")).toBe(2);
    });

    it("пустая строка даёт 0", () => {
        expect(commonPrefixLength("", "abc")).toBe(0);
    });

    it("одинаковые строки — вся длина", () => {
        expect(commonPrefixLength("abc", "abc")).toBe(3);
    });
});

describe("commonSuffixLength", () => {
    it("считает длину общего хвоста", () => {
        expect(commonSuffixLength("running", "walking")).toBe(3);
    });

    it("нет общего хвоста — 0", () => {
        expect(commonSuffixLength("abc", "xyz")).toBe(0);
    });

    it("одна строка — суффикс другой", () => {
        expect(commonSuffixLength("cd", "abcd")).toBe(2);
    });

    it("пустая строка даёт 0", () => {
        expect(commonSuffixLength("", "abc")).toBe(0);
    });

    it("одинаковые строки — вся длина", () => {
        expect(commonSuffixLength("abc", "abc")).toBe(3);
    });
});

describe("splitLines", () => {
    it("режет по всем трём видам перевода строки", () => {
        expect(splitLines("a\nb\r\nc\rd")).toEqual(["a", "b", "c", "d"]);
    });

    it("строка без переводов — один элемент", () => {
        expect(splitLines("abc")).toEqual(["abc"]);
    });

    it("хвостовой перевод строки даёт пустой последний элемент", () => {
        expect(splitLines("a\n")).toEqual(["a", ""]);
    });

    it("пустая строка даёт один пустой элемент", () => {
        expect(splitLines("")).toEqual([""]);
    });
});
