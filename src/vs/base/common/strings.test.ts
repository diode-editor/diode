import { describe, expect, it } from "vitest";

import {
    commonPrefixLength,
    commonSuffixLength,
    removeAnsiEscapeCodes,
    splitLines,
    truncateMiddle,
} from "./strings.ts";

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

describe("truncateMiddle", () => {
    it("keeps a value that fits", () => {
        expect(truncateMiddle("abcdef", 6)).toBe("abcdef");
    });

    it("keeps the start and the end of a longer one around the ellipsis, within the length", () => {
        expect(truncateMiddle("abcdefghij", 7)).toBe("abc…hij");
        expect(truncateMiddle("abcdefghij", 6)).toBe("ab…hij");
    });
});

describe("removeAnsiEscapeCodes", () => {
    it("drops colors, a link's OSC and a charset switch, keeps the text", () => {
        expect(removeAnsiEscapeCodes("\x1b[31mred\x1b[0m \x1b[1;32mbold\x1b[39m")).toBe("red bold");
        expect(removeAnsiEscapeCodes("\x1b]8;;http://x\x07link\x1b]8;;\x07")).toBe("link");
        expect(removeAnsiEscapeCodes("\x1b(Bplain\x9b2Kend")).toBe("plainend");
    });

    it("leaves a text without sequences alone", () => {
        expect(removeAnsiEscapeCodes("expected 2 to be 3")).toBe("expected 2 to be 3");
    });
});
