import { describe, expect, it } from "vitest";

import { createCursorSelection, createSelection } from "../../common/core/iSelection.ts";
import { TextDocument } from "../../common/model/textDocument.ts";
import { EditorViewState } from "../../common/viewModel/editorViewState.ts";

import { moveToWordHighlight } from "./wordHighlightNavigation.ts";

function makeState(text: string, line: number, character: number): EditorViewState {
    return new EditorViewState(new TextDocument(text), [createCursorSelection(line, character)]);
}

/** Cursor as [line, column]; also asserts there is a single collapsed selection. */
function caret(state: EditorViewState): number[] {
    expect(state.selections).toHaveLength(1);
    const sel = state.selections[0];
    expect(sel.anchor).toEqual(sel.active);
    return [sel.active.line, sel.active.character];
}

describe("moveToWordHighlight", () => {
    // "foo bar foo\nfoo" — occurrences of foo: (0,0) (0,8) (1,0).
    const text = "foo bar foo\nfoo";

    it("вперёд — на начало следующего вхождения", () => {
        const state = makeState(text, 0, 1);
        moveToWordHighlight(state, 1);
        expect(caret(state)).toEqual([0, 8]);
        moveToWordHighlight(state, 1);
        expect(caret(state)).toEqual([1, 0]);
    });

    it("вперёд с последнего — циклически на первое", () => {
        const state = makeState(text, 1, 2);
        moveToWordHighlight(state, 1);
        expect(caret(state)).toEqual([0, 0]);
    });

    it("назад — на начало предыдущего вхождения", () => {
        const state = makeState(text, 1, 2);
        moveToWordHighlight(state, -1);
        expect(caret(state)).toEqual([0, 8]);
    });

    it("назад с первого — циклически на последнее", () => {
        const state = makeState(text, 0, 2);
        moveToWordHighlight(state, -1);
        expect(caret(state)).toEqual([1, 0]);
    });

    it("каретка сразу за словом — на этом слове", () => {
        const state = makeState(text, 0, 11);
        moveToWordHighlight(state, 1);
        expect(caret(state)).toEqual([1, 0]);
    });

    it("единственное вхождение — каретка встаёт на его начало", () => {
        const state = makeState("hello world", 0, 3);
        moveToWordHighlight(state, 1);
        expect(caret(state)).toEqual([0, 0]);
    });

    it("каретка не на слове — no-op", () => {
        const state = makeState("foo  foo", 0, 4);
        moveToWordHighlight(state, 1);
        expect(caret(state)).toEqual([0, 4]);
    });

    it("непустое выделение — no-op (подсветки вхождений нет)", () => {
        const state = makeState(text, 0, 0);
        state.selections = [createSelection(0, 0, 0, 3)];
        moveToWordHighlight(state, 1);
        expect(state.selections).toEqual([createSelection(0, 0, 0, 3)]);
    });

    it("мультикурсор — no-op (подсветки вхождений нет)", () => {
        const state = makeState(text, 0, 0);
        const carets = [createCursorSelection(0, 1), createCursorSelection(1, 1)];
        state.selections = carets;
        moveToWordHighlight(state, 1);
        expect(state.selections).toEqual(carets);
    });

    it("цель за вьюпортом — вьюпорт едет к ней", () => {
        const lines = ["foo", ...Array.from({ length: 50 }, () => "x"), "  foo"];
        const state = makeState(lines.join("\n"), 0, 0);
        state.viewportHeight = 10;
        state.viewportWidth = 80;
        moveToWordHighlight(state, 1);
        expect(caret(state)).toEqual([51, 2]);
        expect(state.scrollTop).toBeGreaterThan(0);
    });
});
