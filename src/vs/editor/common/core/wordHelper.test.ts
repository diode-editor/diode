import { describe, expect, it } from "vitest";

import { DEFAULT_WORD_REGEXP, getWordAtText, regExpMatchesEmptyString } from "./wordHelper.ts";

/** Слово под `character` строкой — для компактных ожиданий. */
function wordAt(text: string, character: number, regex: RegExp = DEFAULT_WORD_REGEXP): string | null {
    const word = getWordAtText(character, regex, text);
    return word === null ? null : text.slice(word.start, word.end);
}

describe("getWordAtText — дефолтное определение слова", () => {
    it("слово накрывает позицию в начале, середине и сразу за концом", () => {
        expect(getWordAtText(4, DEFAULT_WORD_REGEXP, "foo bar baz")).toEqual({ start: 4, end: 7 });
        expect(getWordAtText(5, DEFAULT_WORD_REGEXP, "foo bar baz")).toEqual({ start: 4, end: 7 });
        expect(getWordAtText(7, DEFAULT_WORD_REGEXP, "foo bar baz")).toEqual({ start: 4, end: 7 });
    });

    it("в промежутке между словами слова нет", () => {
        expect(getWordAtText(4, DEFAULT_WORD_REGEXP, "foo  bar")).toBeNull();
        expect(getWordAtText(0, DEFAULT_WORD_REGEXP, "")).toBeNull();
    });

    it("на стыке двух слов побеждает левое", () => {
        expect(getWordAtText(3, DEFAULT_WORD_REGEXP, "foo(bar")).toEqual({ start: 0, end: 3 });
    });

    it("разделители и пробельные символы режут слова", () => {
        const cases: [string, number, string | null][] = [
            ["a.b", 0, "a"],
            ["a-b", 2, "b"],
            ["a\tbc", 3, "bc"],
            ["x yz", 3, "yz"],
            ["snake_case", 4, "snake_case"],
            ["привет мир", 2, "привет"],
            ["(", 0, null],
        ];
        for (const [text, character, expected] of cases) {
            expect(wordAt(text, character), `${text}@${String(character)}`).toBe(expected);
        }
    });

    it("числа, включая дробные со знаком, — одно слово", () => {
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

    it("сканирование идёт от начала строки, а не от позиции", () => {
        // Слово, начатое раньше позиции, остаётся целым: `x`, затем `-1.5`.
        expect(getWordAtText(3, DEFAULT_WORD_REGEXP, "x-1.5")).toEqual({ start: 1, end: 5 });
    });
});

describe("getWordAtText — регекс расширения", () => {
    it("регекс без флага g дополняется им, флаги сохраняются", () => {
        expect(wordAt("ab CD", 4, /[a-z]+/)).toBeNull();
        expect(wordAt("ab CD", 4, /[a-z]+/i)).toBe("CD");
    });

    it("глобальный регекс работает как есть и не теряет своего lastIndex", () => {
        const regex = /[a-z]+/g;
        regex.lastIndex = 2;
        expect(wordAt("ab cd", 1, regex)).toBe("ab");
        expect(regex.lastIndex).toBe(2);
    });

    it("соседние совпадения без зазора не перескакиваются", () => {
        expect(getWordAtText(3, /\d+|[a-z]+/, "ab12")).toEqual({ start: 2, end: 4 });
    });

    it("пустые совпадения внутри строки не зацикливают поиск", () => {
        expect(getWordAtText(3, /\b/, "ab cd")).toEqual({ start: 3, end: 3 });
        expect(getWordAtText(1, /(?=z)/, "ab")).toBeNull();
    });
});

describe("regExpMatchesEmptyString", () => {
    it("отличает регекс, матчащий пустую строку", () => {
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

    it("не трогает lastIndex проверяемого регекса", () => {
        const regex = /a*/g;
        regex.lastIndex = 3;
        regExpMatchesEmptyString(regex);
        expect(regex.lastIndex).toBe(3);
    });
});
