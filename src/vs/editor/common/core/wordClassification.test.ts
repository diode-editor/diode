import { describe, expect, it } from "vitest";

import { charClass, findWordRangeAt, isWordChar } from "./wordClassification.ts";

describe("charClass / isWordChar", () => {
    it("distinguishes whitespace, punctuation and word characters", () => {
        expect(charClass(" ")).toBe(0);
        expect(charClass("\t")).toBe(0);
        expect(charClass(".")).toBe(1);
        expect(charClass("a")).toBe(2);
    });

    it("exactly one character counts as a word: the empty string is a line boundary", () => {
        expect(isWordChar("a")).toBe(true);
        expect(isWordChar("")).toBe(false);
        expect(isWordChar("ab")).toBe(false);
        expect(isWordChar(".")).toBe(false);
    });
});

describe("findWordRangeAt", () => {
    it("finds the word under the cursor and right after its end", () => {
        expect(findWordRangeAt("foo bar", 1)).toEqual({ start: 0, end: 3 });
        expect(findWordRangeAt("foo bar", 3)).toEqual({ start: 0, end: 3 });
        expect(findWordRangeAt("foo bar", 4)).toEqual({ start: 4, end: 7 });
    });

    it("no word on whitespace or punctuation", () => {
        expect(findWordRangeAt(" foo", 0)).toBeNull();
        expect(findWordRangeAt("a..b", 2)).toBeNull();
        expect(findWordRangeAt("", 0)).toBeNull();
    });

    describe("position outside the line", () => {
        it("past the line end — the word at the end, no crash", () => {
            expect(findWordRangeAt("foo", 4)).toEqual({ start: 0, end: 3 });
            expect(findWordRangeAt("foo", 999)).toEqual({ start: 0, end: 3 });
        });

        it("past the line end with no word at the end — null, no crash", () => {
            expect(findWordRangeAt("foo ", 42)).toBeNull();
            expect(findWordRangeAt("", 7)).toBeNull();
        });

        it("a negative position reads as the line start", () => {
            expect(findWordRangeAt("foo bar", -1)).toEqual({ start: 0, end: 3 });
            expect(findWordRangeAt(" foo", -5)).toBeNull();
        });

        it("a fractional position truncates to an integer column", () => {
            expect(findWordRangeAt("foo bar", 3.9)).toEqual({ start: 0, end: 3 });
        });

        it("NaN finds no word and does not crash", () => {
            expect(findWordRangeAt("foo", Number.NaN)).toBeNull();
        });
    });
});
