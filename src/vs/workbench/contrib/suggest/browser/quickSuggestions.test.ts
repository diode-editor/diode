import { describe, expect, it } from "vitest";

import { createLineTokens, createToken } from "../../../../editor/common/languages/iLineTokens.ts";

import {
    QUICK_SUGGESTIONS_DEFAULT,
    readQuickSuggestions,
    shouldAutoTrigger,
    standardTokenTypeAt,
    valueFor,
} from "./quickSuggestions.ts";

describe("readQuickSuggestions — validate эталона", () => {
    it("дефолт эталона: код — offWhenInlineCompletions, комментарии и строки — off", () => {
        expect(QUICK_SUGGESTIONS_DEFAULT).toEqual({
            other: "offWhenInlineCompletions",
            comments: "off",
            strings: "off",
        });
    });

    it("boolean включает/выключает все виды", () => {
        expect(readQuickSuggestions(true)).toEqual({ other: "on", comments: "on", strings: "on" });
        expect(readQuickSuggestions(false)).toEqual({ other: "off", comments: "off", strings: "off" });
    });

    it("строка — один режим на все виды; незнакомая строка — дефолт `other`", () => {
        expect(readQuickSuggestions("inline")).toEqual({ other: "inline", comments: "inline", strings: "inline" });
        expect(readQuickSuggestions("bogus")).toEqual({
            other: "offWhenInlineCompletions",
            comments: "offWhenInlineCompletions",
            strings: "offWhenInlineCompletions",
        });
    });

    it("объект — по полям: boolean и режимы, недостающее и мусор — дефолт поля", () => {
        expect(readQuickSuggestions({ strings: true })).toEqual({
            other: "offWhenInlineCompletions",
            comments: "off",
            strings: "on",
        });
        expect(readQuickSuggestions({ other: false, comments: "on", strings: 42 })).toEqual({
            other: "off",
            comments: "on",
            strings: "off",
        });
    });

    it("не объект и null — дефолт", () => {
        expect(readQuickSuggestions(null)).toBe(QUICK_SUGGESTIONS_DEFAULT);
        expect(readQuickSuggestions(7)).toBe(QUICK_SUGGESTIONS_DEFAULT);
        expect(readQuickSuggestions(undefined)).toBe(QUICK_SUGGESTIONS_DEFAULT);
    });

    it("valueFor берёт режим своего вида", () => {
        const config = { other: "on", comments: "inline", strings: "off" } as const;
        expect(valueFor(config, "other")).toBe("on");
        expect(valueFor(config, "comment")).toBe("inline");
        expect(valueFor(config, "string")).toBe("off");
    });
});

describe("standardTokenTypeAt — вид токена по скоупам TextMate", () => {
    const tokens = createLineTokens([
        createToken(0, ["source.ts"]),
        createToken(4, ["source.ts", "string.quoted.double.ts"]),
        createToken(10, ["source.ts", "comment.line.double-slash.ts"]),
        createToken(20, ["source.ts", "string.template.ts", "meta.embedded.line.ts"]),
        createToken(25, ["source.ts", "string.regexp.ts"]),
    ]);

    it("строка, комментарий, прочее — по накрывающему токену", () => {
        expect(standardTokenTypeAt(tokens, 0)).toBe("other");
        expect(standardTokenTypeAt(tokens, 3)).toBe("other");
        expect(standardTokenTypeAt(tokens, 4)).toBe("string");
        expect(standardTokenTypeAt(tokens, 9)).toBe("string");
        expect(standardTokenTypeAt(tokens, 10)).toBe("comment");
    });

    it("побеждает самый вложенный скоуп: meta.embedded внутри строки — код", () => {
        expect(standardTokenTypeAt(tokens, 21)).toBe("other");
    });

    it("регекс: `string.regexp` — строка, голый `regex` — «прочее»", () => {
        // Как у vscode-textmate: `\bregex\b` слово `regexp` не ловит, зато ловит
        // `string` той же строки скоупа; вид RegEx для настройки — «прочее».
        expect(standardTokenTypeAt(tokens, 26)).toBe("string");
        const regex = createLineTokens([createToken(0, ["source.js", "regex.js"])]);
        expect(standardTokenTypeAt(regex, 0)).toBe("other");
    });

    it("без токенов — прочее", () => {
        expect(standardTokenTypeAt(undefined, 3)).toBe("other");
        expect(standardTokenTypeAt(createLineTokens([createToken(5, ["comment"])]), 2)).toBe("other");
    });
});

describe("shouldAutoTrigger — LineContext.shouldAutoTrigger эталона", () => {
    it("каретка в конце слова — да", () => {
        expect(shouldAutoTrigger("const fo", 8)).toBe(true);
        expect(shouldAutoTrigger("x", 1)).toBe(true);
        expect(shouldAutoTrigger("привет", 6)).toBe(true);
    });

    it("не на слове: пробел, скобка, точка, дефис — нет", () => {
        expect(shouldAutoTrigger("foo ", 4)).toBe(false);
        expect(shouldAutoTrigger("foo(", 4)).toBe(false);
        expect(shouldAutoTrigger("foo.", 4)).toBe(false);
        expect(shouldAutoTrigger("a -", 3)).toBe(false);
        expect(shouldAutoTrigger("", 0)).toBe(false);
    });

    it("числа — нет", () => {
        expect(shouldAutoTrigger("x = 42", 6)).toBe(false);
        expect(shouldAutoTrigger("x = 1.5", 7)).toBe(false);
        expect(shouldAutoTrigger("x = 4a", 6)).toBe(true);
    });

    it("каретка внутри слова — нет, но сразу за его первым символом — да", () => {
        // Набрали `x` перед словом `foo`: слово `xfoo`, каретка за первым символом.
        expect(shouldAutoTrigger("xfoo", 1)).toBe(true);
        expect(shouldAutoTrigger("xfoo", 2)).toBe(false);
        expect(shouldAutoTrigger("a xfoo", 3)).toBe(true);
        expect(shouldAutoTrigger("a xfoo", 4)).toBe(false);
    });
});
