import { describe, expect, it } from "vitest";

import { createPosition } from "../../common/core/iPosition.ts";
import { createRange } from "../../common/core/iRange.ts";
import { TextDocument } from "../../common/model/textDocument.ts";

import { provideWordSelectionRanges } from "./wordSelections.ts";

function steps(text: string, line: number, character: number, selectSubwords = true): string[] {
    const document = new TextDocument(text);
    const [ranges] = provideWordSelectionRanges(document, [createPosition(line, character)], selectSubwords);
    return ranges.map((range) => document.getTextInRange(range));
}

describe("provideWordSelectionRanges: upstream wordSelections", () => {
    it("camelCase: subword under the cursor, then word and document", () => {
        const text = "const fooBarBaz = 1";
        expect(steps(text, 0, 9)).toEqual(["Bar", "fooBarBaz", text]);
        expect(steps(text, 0, 6)).toEqual(["foo", "fooBarBaz", text]);
        // A cursor right after the word is still on the word.
        expect(steps(text, 0, 15)).toEqual(["Baz", "fooBarBaz", text]);
    });

    it("snake_case: subword boundaries are underscores", () => {
        expect(steps("foo_bar_baz\n", 0, 5)).toEqual(["bar", "foo_bar_baz", "foo_bar_baz\n"]);
        // Cursor right on `_`: the left pass doesn't treat it as a boundary.
        expect(steps("foo_bar\n", 0, 3)).toEqual(["foo", "foo_bar", "foo_bar\n"]);
    });

    it("camelCase boundaries at edge letters a/z/A/Z", () => {
        expect(steps("aZb\n", 0, 2)).toEqual(["Zb", "aZb", "aZb\n"]);
        expect(steps("zAb\n", 0, 2)).toEqual(["Ab", "zAb", "zAb\n"]);
        expect(steps("aZ\n", 0, 0)).toEqual(["a", "aZ", "aZ\n"]);
        expect(steps("zA\n", 0, 0)).toEqual(["z", "zA", "zA\n"]);
        // Consecutive capitals form one subword with a lowercase tail.
        expect(steps("ABc\n", 0, 2)).toEqual(["ABc", "ABc", "ABc\n"]);
        // As upstream, only Latin letters have case: a non-Latin letter is not lowercase.
        expect(steps("\u0436Bar\n", 0, 2)).toEqual(["\u0436Bar", "\u0436Bar", "\u0436Bar\n"]); // "zhBar"
        // A digit is not a capital: no subword boundary.
        expect(steps("foo1bar\n", 0, 5)).toEqual(["foo1bar", "foo1bar", "foo1bar\n"]);
    });

    it("cursor after a trailing `_`: no subword, only the word", () => {
        expect(steps("foo_ x\n", 0, 4)).toEqual(["foo_", "foo_ x\n"]);
    });

    it("single-subword word collapses on merge, but is returned twice here", () => {
        expect(steps("value\n", 0, 2)).toEqual(["value", "value", "value\n"]);
    });

    it("selectSubwords: false means no subwords", () => {
        expect(steps("fooBar\n", 0, 4, false)).toEqual(["fooBar", "fooBar\n"]);
    });

    it("cursor not on a word: only the document", () => {
        expect(steps("a + b", 0, 2)).toEqual(["a + b"]);
    });

    it("whitespace-only line yields the whole line; an empty one does not", () => {
        const document = new TextDocument("a\n   \n\nb");
        const ranges = provideWordSelectionRanges(document, [createPosition(1, 1), createPosition(2, 0)], true);
        expect(ranges).toEqual([[createRange(1, 0, 1, 3), createRange(0, 0, 3, 1)], [createRange(0, 0, 3, 1)]]);
    });
});
