import { describe, expect, it } from "vitest";

import { commonPrefixLength, commonSuffixLength, splitLines } from "./strings.ts";

describe("commonPrefixLength", () => {
    it("counts the length of the common prefix", () => {
        expect(commonPrefixLength("hello", "help")).toBe(3);
    });

    it("no common prefix gives 0", () => {
        expect(commonPrefixLength("abc", "xyz")).toBe(0);
    });

    it("one string is a prefix of the other", () => {
        expect(commonPrefixLength("ab", "abcd")).toBe(2);
    });

    it("an empty string gives 0", () => {
        expect(commonPrefixLength("", "abc")).toBe(0);
    });

    it("equal strings give the whole length", () => {
        expect(commonPrefixLength("abc", "abc")).toBe(3);
    });
});

describe("commonSuffixLength", () => {
    it("counts the length of the common suffix", () => {
        expect(commonSuffixLength("running", "walking")).toBe(3);
    });

    it("no common suffix gives 0", () => {
        expect(commonSuffixLength("abc", "xyz")).toBe(0);
    });

    it("one string is a suffix of the other", () => {
        expect(commonSuffixLength("cd", "abcd")).toBe(2);
    });

    it("an empty string gives 0", () => {
        expect(commonSuffixLength("", "abc")).toBe(0);
    });

    it("equal strings give the whole length", () => {
        expect(commonSuffixLength("abc", "abc")).toBe(3);
    });
});

describe("splitLines", () => {
    it("splits on all three kinds of line break", () => {
        expect(splitLines("a\nb\r\nc\rd")).toEqual(["a", "b", "c", "d"]);
    });

    it("a string without line breaks gives one element", () => {
        expect(splitLines("abc")).toEqual(["abc"]);
    });

    it("a trailing line break gives an empty last element", () => {
        expect(splitLines("a\n")).toEqual(["a", ""]);
    });

    it("an empty string gives one empty element", () => {
        expect(splitLines("")).toEqual([""]);
    });
});
