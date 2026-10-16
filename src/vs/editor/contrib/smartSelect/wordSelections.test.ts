import { describe, expect, it } from "vitest";

import { createPosition } from "../../common/core/iPosition.ts";
import { createRange } from "../../common/core/iRange.ts";
import { TextDocument } from "../../common/model/textDocument.ts";

import { provideWordSelectionRanges } from "./wordSelections.ts";

/** Тексты ступеней одной каретки — самый читаемый ассерт. */
function steps(text: string, line: number, character: number, selectSubwords = true): string[] {
    const document = new TextDocument(text);
    const [ranges] = provideWordSelectionRanges(document, [createPosition(line, character)], selectSubwords);
    return ranges.map((range) => document.getTextInRange(range));
}

describe("provideWordSelectionRanges — wordSelections эталона", () => {
    it("camelCase: подслово под кареткой, затем слово и документ", () => {
        const text = "const fooBarBaz = 1";
        expect(steps(text, 0, 9)).toEqual(["Bar", "fooBarBaz", text]);
        expect(steps(text, 0, 6)).toEqual(["foo", "fooBarBaz", text]);
        // Каретка сразу за словом — всё ещё на слове.
        expect(steps(text, 0, 15)).toEqual(["Baz", "fooBarBaz", text]);
    });

    it("snake_case: границы подслова — подчёркивания", () => {
        expect(steps("foo_bar_baz\n", 0, 5)).toEqual(["bar", "foo_bar_baz", "foo_bar_baz\n"]);
        // Каретка прямо на `_`: левый проход его не считает границей.
        expect(steps("foo_bar\n", 0, 3)).toEqual(["foo", "foo_bar", "foo_bar\n"]);
    });

    it("слово из одного подслова схлопывается при слиянии, а здесь отдаётся дважды", () => {
        expect(steps("value\n", 0, 2)).toEqual(["value", "value", "value\n"]);
    });

    it("selectSubwords: false — без подслов", () => {
        expect(steps("fooBar\n", 0, 4, false)).toEqual(["fooBar", "fooBar\n"]);
    });

    it("каретка не на слове — только документ", () => {
        expect(steps("a + b", 0, 2)).toEqual(["a + b"]);
    });

    it("строка из одних пробелов — строка целиком; пустая — нет", () => {
        const document = new TextDocument("a\n   \n\nb");
        const ranges = provideWordSelectionRanges(document, [createPosition(1, 1), createPosition(2, 0)], true);
        expect(ranges).toEqual([[createRange(1, 0, 1, 3), createRange(0, 0, 3, 1)], [createRange(0, 0, 3, 1)]]);
    });
});
