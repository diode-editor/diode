import { describe, expect, it } from "vitest";

import { createRange } from "../../common/core/iRange.ts";
import { TextDocument } from "../../common/model/textDocument.ts";

import { planToggleBlockComment } from "./blockComments.ts";

/** Selection as `[al, ac, ll, lc]`. */
function toggle(text: string, range: ReturnType<typeof createRange>, open = "/*", close = "*/") {
    const doc = new TextDocument(text);
    const plan = planToggleBlockComment(doc, range, open, close);
    doc.applyEdits([...plan.edits]);
    const sel = plan.selection;
    return [doc.getText(), [sel.anchor.line, sel.anchor.character, sel.active.line, sel.active.character]] as const;
}

describe("planToggleBlockComment — empty selection", () => {
    it("inserts a pair with the cursor between the spaces", () => {
        const [text, sel] = toggle("ab", createRange(0, 1, 0, 1));
        expect(text).toBe("a/*  */b");
        expect(sel).toEqual([0, 4, 0, 4]);
    });

    it("cursor inside a pair on the line — the pair is removed along with the spaces", () => {
        const [text, sel] = toggle("a/* foo */b", createRange(0, 6, 0, 6));
        expect(text).toBe("afoob");
        expect(sel).toEqual([0, 3, 0, 3]);
    });

    it("cursor inside an empty pair — removal restores the original text", () => {
        const [text, sel] = toggle("a/*  */b", createRange(0, 4, 0, 4));
        expect(text).toBe("ab");
        expect(sel).toEqual([0, 1, 0, 1]);
    });

    it("cursor inside a pair without spaces — tokens are removed as is", () => {
        const [text, sel] = toggle("x/**/y", createRange(0, 3, 0, 3));
        expect(text).toBe("xy");
        expect(sel).toEqual([0, 1, 0, 1]);
    });

    it("cursor inside the closing token also finds the pair", () => {
        const [text] = toggle("/* foo */", createRange(0, 8, 0, 8));
        expect(text).toBe("foo");
    });

    it("the closing token is searched past the end of the opening one, not inside it", () => {
        // The substring `*/` already starts at the second character of the open token.
        const [text, sel] = toggle("/*/ x */", createRange(0, 3, 0, 3));
        expect(text).toBe("/ x");
        expect(sel).toEqual([0, 1, 0, 1]);
    });

    it("a stray `*/` left of the opening token does not count as closing for the cursor", () => {
        const [text, sel] = toggle("a */ b /* c */", createRange(0, 11, 0, 11));
        expect(text).toBe("a */ b c");
        expect(sel).toEqual([0, 8, 0, 8]);
    });

    it("a closing token with no opening one to the left — a new pair is inserted", () => {
        const [text, sel] = toggle("a */ b", createRange(0, 0, 0, 0));
        expect(text).toBe("/*  */a */ b");
        expect(sel).toEqual([0, 3, 0, 3]);
    });

    it("cursor after a closed pair — a new pair is inserted", () => {
        const [text] = toggle("/* a */x", createRange(0, 8, 0, 8));
        expect(text).toBe("/* a */x/*  */");
    });
});

describe("planToggleBlockComment — cursor at every position of the pair", () => {
    // `x/* foo */y`: the pair spans [1, 10), the content `foo` spans [4, 7).
    const TEXT = "x/* foo */y";

    for (let caret = 1; caret <= 10; caret++) {
        it(`cursor at ${String(caret)} inside the pair removes it entirely`, () => {
            const [text, sel] = toggle(TEXT, createRange(0, caret, 0, caret));
            expect(text).toBe("xfooy");
            // Within the former content including its edges, not in the surrounding text.
            expect(sel[3]).toBeGreaterThanOrEqual(1);
            expect(sel[3]).toBeLessThanOrEqual(4);
        });
    }

    it("cursor exactly on the content tracks its character", () => {
        // On `o` (index 5): after removing `/* ` on the left, the character moves to 2.
        const [text, sel] = toggle(TEXT, createRange(0, 5, 0, 5));
        expect(text).toBe("xfooy");
        expect(sel).toEqual([0, 2, 0, 2]);
    });

    it("cursor outside the pair (at the line tail) inserts a new pair", () => {
        const [text] = toggle(TEXT, createRange(0, 11, 0, 11));
        expect(text).toBe("x/* foo */y/*  */");
    });

    it("toggle twice restores the original text and selection (round-trip)", () => {
        for (const range of [createRange(0, 2, 0, 5), createRange(0, 0, 0, 5), createRange(0, 1, 0, 4)]) {
            const doc = new TextDocument("const answer = 42;");
            const first = planToggleBlockComment(doc, range, "/*", "*/");
            doc.applyEdits([...first.edits]);

            const wrapped = {
                start: { line: first.selection.anchor.line, character: first.selection.anchor.character },
                end: { line: first.selection.active.line, character: first.selection.active.character },
            };
            const second = planToggleBlockComment(doc, wrapped, "/*", "*/");
            doc.applyEdits([...second.edits]);

            expect(doc.getText()).toBe("const answer = 42;");
            expect(second.selection.anchor.character).toBe(range.start.character);
            expect(second.selection.active.character).toBe(range.end.character);
        }
    });
});

describe("planToggleBlockComment — selection", () => {
    it("wraps the selection and keeps it on the same text", () => {
        const [text, sel] = toggle("const a = 1;", createRange(0, 6, 0, 7));
        expect(text).toBe("const /* a */ = 1;");
        expect(sel).toEqual([0, 9, 0, 10]);
    });

    it("selection including the tokens — tokens are removed, selection shrinks to the content", () => {
        const [text, sel] = toggle("const /* a */ = 1;", createRange(0, 6, 0, 13));
        expect(text).toBe("const a = 1;");
        expect(sel).toEqual([0, 6, 0, 7]);
    });

    it("selection of content wrapped by tokens outside — the outer ones are removed", () => {
        const [text, sel] = toggle("const /* a */ = 1;", createRange(0, 9, 0, 10));
        expect(text).toBe("const a = 1;");
        expect(sel).toEqual([0, 6, 0, 7]);
    });

    it("tokens without spaces are removed too", () => {
        const [text, sel] = toggle("/*a*/", createRange(0, 0, 0, 5));
        expect(text).toBe("a");
        expect(sel).toEqual([0, 0, 0, 1]);
    });

    it("selection of exactly `/**/` (pair with no content and no space) is removed entirely", () => {
        const [text, sel] = toggle("x/**/y", createRange(0, 1, 0, 5));
        expect(text).toBe("xy");
        expect(sel).toEqual([0, 1, 0, 1]);
    });

    it("selection `/*/` is not a pair (too short for both tokens), gets wrapped", () => {
        const [text] = toggle("/*/", createRange(0, 0, 0, 3));
        expect(text).toBe("/* /*/ */");
    });

    it("selection of exactly an empty pair `/* */` — removed without eating the space twice", () => {
        const [text, sel] = toggle("x/* */y", createRange(0, 1, 0, 6));
        expect(text).toBe("xy");
        expect(sel).toEqual([0, 1, 0, 1]);
    });

    it("a multi-line selection with EQUAL columns is not a cursor", () => {
        const [text, sel] = toggle("aaa\nbbb", createRange(0, 1, 1, 1));
        expect(text).toBe("a/* aa\nb */bb");
        expect(sel).toEqual([0, 4, 1, 1]);
    });

    it("multi-line wrapping: tokens at the edges, selection on the same text", () => {
        const [text, sel] = toggle("aaa\nbbb", createRange(0, 1, 1, 2));
        expect(text).toBe("a/* aa\nbb */b");
        expect(sel).toEqual([0, 4, 1, 2]);
    });

    it("multi-line removal: the closing part on the last line", () => {
        const [text, sel] = toggle("a/* aa\nbb */b", createRange(0, 1, 1, 5));
        expect(text).toBe("aaa\nbbb");
        expect(sel).toEqual([0, 1, 1, 2]);
    });

    it("cursor on the opening token — the pair is removed, the cursor does not move", () => {
        const [text, sel] = toggle("a/* foo */b", createRange(0, 1, 0, 1));
        expect(text).toBe("afoob");
        expect(sel).toEqual([0, 1, 0, 1]);
    });

    it("outer tokens without spaces are removed", () => {
        const [text, sel] = toggle("/*a*/", createRange(0, 2, 0, 3));
        expect(text).toBe("a");
        expect(sel).toEqual([0, 0, 0, 1]);
    });

    it("outer tokens without spaces are removed mid-line too", () => {
        // The surrounding text matters: tokens are looked up at the selection boundary, not the line's.
        const [text, sel] = toggle("x/*a*/y", createRange(0, 3, 0, 4));
        expect(text).toBe("xay");
        expect(sel).toEqual([0, 1, 0, 2]);
    });

    it("a closing token outside without an opening one — the selection is wrapped", () => {
        const [text] = toggle("xa*/y", createRange(0, 1, 0, 2));
        expect(text).toBe("x/* a */*/y");
    });

    it("an opening token outside without a closing one — the selection is wrapped", () => {
        const [text] = toggle("x/*ay", createRange(0, 3, 0, 4));
        expect(text).toBe("x/*/* a */y");
    });

    it("outer tokens on different lines are removed, the selection stays", () => {
        const [text, sel] = toggle("/* aa\nbb */", createRange(0, 3, 1, 2));
        expect(text).toBe("aa\nbb");
        expect(sel).toEqual([0, 0, 1, 2]);
    });

    it("selection starts with the opening token but does not end with the closing one — wrapping", () => {
        const [text] = toggle("/* foo bar", createRange(0, 0, 0, 6));
        expect(text).toBe("/* /* foo */ bar");
    });

    it("selection ends with the closing token but does not start with the opening one — wrapping", () => {
        const [text] = toggle("foo */ bar", createRange(0, 0, 0, 6));
        expect(text).toBe("/* foo */ */ bar");
    });

    it("an opening token on the left with no closing one on the right — plain wrapping", () => {
        const [text] = toggle("/* a", createRange(0, 3, 0, 4));
        expect(text).toBe("/* /* a */");
    });

    it("other pair tokens (<!-- -->)", () => {
        const [text] = toggle("hello", createRange(0, 0, 0, 5), "<!--", "-->");
        expect(text).toBe("<!-- hello -->");
    });
});
