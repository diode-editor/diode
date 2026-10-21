import { describe, expect, it } from "vitest";

import { DEFAULT_WORD_REGEXP, getWordAtText, regExpMatchesEmptyString } from "./wordHelper.ts";

function wordAt(text: string, character: number, regex: RegExp = DEFAULT_WORD_REGEXP): string | null {
    const word = getWordAtText(character, regex, text);
    return word === null ? null : text.slice(word.start, word.end);
}

describe("getWordAtText — default word definition", () => {
    it("a word covers a position at its start, middle and right after its end", () => {
        expect(getWordAtText(4, DEFAULT_WORD_REGEXP, "foo bar baz")).toEqual({ start: 4, end: 7 });
        expect(getWordAtText(5, DEFAULT_WORD_REGEXP, "foo bar baz")).toEqual({ start: 4, end: 7 });
        expect(getWordAtText(7, DEFAULT_WORD_REGEXP, "foo bar baz")).toEqual({ start: 4, end: 7 });
    });

    it("no word in the gap between words", () => {
        expect(getWordAtText(4, DEFAULT_WORD_REGEXP, "foo  bar")).toBeNull();
        expect(getWordAtText(0, DEFAULT_WORD_REGEXP, "")).toBeNull();
    });

    it("at the junction of two words the left one wins", () => {
        expect(getWordAtText(3, DEFAULT_WORD_REGEXP, "foo(bar")).toEqual({ start: 0, end: 3 });
    });

    it("separators and whitespace split words", () => {
        const cases: [string, number, string | null][] = [
            ["a.b", 0, "a"],
            ["a-b", 2, "b"],
            ["a\tbc", 3, "bc"],
            ["x yz", 3, "yz"],
            ["snake_case", 4, "snake_case"],
            ["\u043f\u0440\u0438\u0432\u0435\u0442 \u043c\u0438\u0440", 2, "\u043f\u0440\u0438\u0432\u0435\u0442"], // "privet mir", "privet"
            ["(", 0, null],
        ];
        for (const [text, character, expected] of cases) {
            expect(wordAt(text, character), `${text}@${String(character)}`).toBe(expected);
        }
    });

    it("numbers, including signed decimals, are one word", () => {
        const cases: [string, number, string | null][] = [
            ["x = -1.5e3;", 6, "-1.5e3"],
            ["x = .5;", 5, ".5"],
            ["12.34", 1, "12.34"],
            ["v1.5", 3, ".5"],
            ["1.", 0, "1"],
        ];
        for (const [text, character, expected] of cases) {
            expect(wordAt(text, character), `${text}@${String(character)}`).toBe(expected);
        }
    });

    it("scanning starts at the line start, not at the position", () => {
        expect(getWordAtText(3, DEFAULT_WORD_REGEXP, "x-1.5")).toEqual({ start: 1, end: 5 });
    });
});

describe("getWordAtText — extension regex", () => {
    it("a regex without the g flag gets it added, other flags are kept", () => {
        expect(wordAt("ab CD", 4, /[a-z]+/)).toBeNull();
        expect(wordAt("ab CD", 4, /[a-z]+/i)).toBe("CD");
    });

    it("a global regex works as is and keeps its lastIndex", () => {
        const regex = /[a-z]+/g;
        regex.lastIndex = 2;
        expect(wordAt("ab cd", 1, regex)).toBe("ab");
        expect(regex.lastIndex).toBe(2);
    });

    it("adjacent matches without a gap are not skipped", () => {
        expect(getWordAtText(3, /\d+|[a-z]+/, "ab12")).toEqual({ start: 2, end: 4 });
    });

    it("empty matches inside the line do not loop the search", () => {
        expect(getWordAtText(3, /\b/, "ab cd")).toEqual({ start: 3, end: 3 });
        expect(getWordAtText(1, /(?=z)/, "ab")).toBeNull();
    });
});

describe("regExpMatchesEmptyString", () => {
    it("detects a regex that matches the empty string", () => {
        const cases: [RegExp, boolean][] = [
            [/a*/, true],
            [/a*/g, true],
            [/^/, true],
            [/^$/, true],
            [/\w+/, false],
            [/\b/, false],
        ];
        for (const [regex, expected] of cases) {
            expect(regExpMatchesEmptyString(regex), regex.source).toBe(expected);
        }
    });

    it("does not touch the lastIndex of the checked regex", () => {
        const regex = /a*/g;
        regex.lastIndex = 3;
        regExpMatchesEmptyString(regex);
        expect(regex.lastIndex).toBe(3);
    });
});
