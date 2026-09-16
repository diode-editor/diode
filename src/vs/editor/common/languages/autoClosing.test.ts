import { describe, expect, it } from "vitest";

import { findSurroundingPair, planAutoClose } from "./autoClosing.ts";
import { DEFAULT_AUTO_CLOSE_BEFORE } from "./languageConfiguration.ts";
import type { IResolvedAutoClosingPair } from "./languageConfiguration.ts";

const PAIRS: IResolvedAutoClosingPair[] = [
    { open: "{", close: "}", notIn: [] },
    { open: "(", close: ")", notIn: [] },
    { open: "'", close: "'", notIn: [] },
    { open: "/**", close: " */", notIn: [] },
];

function plan(typedChar: string, lineContent: string, column: number, pairs = PAIRS, before = DEFAULT_AUTO_CLOSE_BEFORE) {
    return planAutoClose({ typedChar, lineContent, column, autoClosingPairs: pairs, autoCloseBefore: before });
}

describe("planAutoClose — вставка пары", () => {
    it("открывающая в конце строки даёт пару", () => {
        expect(plan("{", "const a = ", 10)).toEqual({ kind: "autoClose", close: "}" });
    });

    it("открывающая перед символом из autoCloseBefore даёт пару", () => {
        expect(plan("(", "call;", 4)).toEqual({ kind: "autoClose", close: ")" });
        expect(plan("{", "a }", 2)).toEqual({ kind: "autoClose", close: "}" });
    });

    it("открывающая посреди слова НЕ закрывается", () => {
        expect(plan("{", "word", 2)).toEqual({ kind: "plain" });
        expect(plan("(", "foo bar", 4)).toEqual({ kind: "plain" });
    });

    it("непарный символ набирается как обычно", () => {
        expect(plan("x", "", 0)).toEqual({ kind: "plain" });
    });

    it("многосимвольная открывающая матчится хвостом текста до каретки", () => {
        // `/**` длиннее `(`/`{` — набор `*` после `/*` дописывает ` */`.
        expect(plan("*", "/*", 2)).toEqual({ kind: "autoClose", close: " */" });
        // без префикса `/*` звёздочка — обычный символ
        expect(plan("*", "a", 1)).toEqual({ kind: "plain" });
    });

    it("при нескольких подошедших открывающих побеждает самая длинная, в любом порядке", () => {
        const overlapping = [
            { open: "ab", close: "X", notIn: [] },
            { open: "b", close: "Y", notIn: [] },
        ];
        // Длинная объявлена раньше короткой: короткая её НЕ перебивает.
        expect(plan("b", "a", 1, overlapping)).toEqual({ kind: "autoClose", close: "X" });
        // И наоборот: длинная, объявленная позже, перебивает короткую.
        expect(plan("b", "a", 1, [...overlapping].reverse())).toEqual({ kind: "autoClose", close: "X" });
    });

    it("скобка после символа слова в конце строки закрывается (правило только для кавычек)", () => {
        // Контекстная проверка «не после слова» — про кавычки; скобкам она не
        // мешает: `foo{` в конце строки обязано дать пару.
        expect(plan("{", "foo", 3)).toEqual({ kind: "autoClose", close: "}" });
    });

    it("хвост строки ПОСЛЕ каретки в поиск открывающей не входит", () => {
        // Каретка в начале строки `;/*`: набранная `*` не склеивается с хвостом
        // в `/**` — открывающая ищется только слева от каретки.
        expect(plan("*", ";/*", 0)).toEqual({ kind: "plain" });
    });

    it("многосимвольная симметричная пара не подчиняется правилу «не после слова»", () => {
        // Правило про апостроф (`don't`) — для однобуквенных кавычек; тройная
        // кавычка Python открывается и сразу после такой же.
        const triple = [{ open: '"""', close: '"""', notIn: [] }];
        expect(plan('"', 'a""', 3, triple)).toEqual({ kind: "autoClose", close: '"""' });
    });

    it("при равной длине открывающих побеждает заявленная первой", () => {
        const duplicates = [
            { open: "a", close: "X", notIn: [] },
            { open: "a", close: "Y", notIn: [] },
        ];
        expect(plan("a", "", 0, duplicates)).toEqual({ kind: "autoClose", close: "X" });
    });

    it("кастомный autoCloseBefore сужает контекст", () => {
        expect(plan("{", "a;", 1, PAIRS, ";")).toEqual({ kind: "autoClose", close: "}" });
        expect(plan("{", "a)", 1, PAIRS, ";")).toEqual({ kind: "plain" });
    });
});

describe("planAutoClose — кавычки (симметричные пары)", () => {
    it("кавычка в пустоте открывает пару", () => {
        expect(plan("'", "a = ", 4)).toEqual({ kind: "autoClose", close: "'" });
    });

    it("кавычка в начале строки открывает пару (слева ничего нет)", () => {
        expect(plan("'", "", 0)).toEqual({ kind: "autoClose", close: "'" });
    });

    it("кавычка после символа слова — апостроф, не пара (don't)", () => {
        expect(plan("'", "don", 3)).toEqual({ kind: "plain" });
    });

    it("кавычка после той же кавычки не удваивается", () => {
        expect(plan("'", "' ", 1, PAIRS, " ")).toEqual({ kind: "plain" });
    });
});

describe("planAutoClose — typeover", () => {
    it("набор закрывающей, уже стоящей под кареткой — перешагивание", () => {
        expect(plan("}", "{}", 1)).toEqual({ kind: "typeover" });
        expect(plan(")", "f()", 2)).toEqual({ kind: "typeover" });
        expect(plan("'", "''", 1)).toEqual({ kind: "typeover" });
    });

    it("typeover сильнее автозакрытия у кавычек", () => {
        // Под кареткой та же кавычка: `''` + `'` в середине даёт `''`, а не `''''`.
        const decision = plan("'", "''", 1);
        expect(decision.kind).toBe("typeover");
    });

    it("символ не из закрывающих не перешагивается", () => {
        expect(plan("x", "x", 0)).toEqual({ kind: "plain" });
    });

    it("под кареткой другой символ — обычная вставка пары или набор", () => {
        expect(plan("}", "{a", 1)).toEqual({ kind: "plain" });
    });
});

describe("findSurroundingPair", () => {
    const SURROUND = [
        ["{", "}"],
        ["'", "'"],
    ] as const;

    it("находит пару по открывающей", () => {
        expect(findSurroundingPair("{", SURROUND)).toEqual(["{", "}"]);
        expect(findSurroundingPair("'", SURROUND)).toEqual(["'", "'"]);
    });

    it("символ вне пар — undefined", () => {
        expect(findSurroundingPair("}", SURROUND)).toBeUndefined();
        expect(findSurroundingPair("x", SURROUND)).toBeUndefined();
    });
});
