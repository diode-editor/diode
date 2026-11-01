import { describe, expect, it } from "vitest";

import { createRange } from "../../common/core/iRange.ts";
import { createCursorSelection } from "../../common/core/iSelection.ts";
import {
    DocumentHighlightKind,
    textWordHighlightSet,
    wordHighlightSetOf,
} from "../../common/languages/iDocumentHighlightSource.ts";
import { TextDocument } from "../../common/model/textDocument.ts";
import { EditorViewState } from "../../common/viewModel/editorViewState.ts";
import { computeWordOccurrences } from "../find/computeWordOccurrences.ts";

import { moveToWordHighlight } from "./wordHighlightNavigation.ts";

/** With the set a textual query would paint: the navigation only reads what is on the frame. */
function makeState(text: string, line: number, character: number): EditorViewState {
    const state = new EditorViewState(new TextDocument(text), [createCursorSelection(line, character)]);
    state.wordHighlights = textWordHighlightSet(computeWordOccurrences(state.document, { line, character }));
    return state;
}

/** Cursor as [line, column]; also asserts there is a single collapsed selection. */
function caret(state: EditorViewState): number[] {
    expect(state.selections).toHaveLength(1);
    const sel = state.selections[0];
    expect(sel.anchor).toEqual(sel.active);
    return [sel.active.line, sel.active.character];
}

describe("moveToWordHighlight", () => {
    it("walks the set of a provider, whatever the kinds, skipping the same word it did not name", () => {
        const state = new EditorViewState(new TextDocument("x x x"), [createCursorSelection(0, 0)]);
        state.wordHighlights = wordHighlightSetOf([
            { range: createRange(0, 0, 0, 1), kind: DocumentHighlightKind.Read },
            { range: createRange(0, 4, 0, 5), kind: DocumentHighlightKind.Write },
        ]);
        moveToWordHighlight(state, 1);
        expect(caret(state)).toEqual([0, 4]);
        moveToWordHighlight(state, 1);
        expect(caret(state)).toEqual([0, 0]);
    });

    it("without a set stays put, though the word occurs again", () => {
        const state = new EditorViewState(new TextDocument("foo foo"), [createCursorSelection(0, 0)]);
        moveToWordHighlight(state, 1);
        expect(caret(state)).toEqual([0, 0]);
    });

    // "foo bar foo\nfoo" — occurrences of foo: (0,0) (0,8) (1,0).
    const text = "foo bar foo\nfoo";

    it("next goes to the start of the next occurrence", () => {
        const state = makeState(text, 0, 1);
        moveToWordHighlight(state, 1);
        expect(caret(state)).toEqual([0, 8]);
        moveToWordHighlight(state, 1);
        expect(caret(state)).toEqual([1, 0]);
    });

    it("next from the last wraps to the first", () => {
        const state = makeState(text, 1, 2);
        moveToWordHighlight(state, 1);
        expect(caret(state)).toEqual([0, 0]);
    });

    it("previous goes to the start of the previous occurrence", () => {
        const state = makeState(text, 1, 2);
        moveToWordHighlight(state, -1);
        expect(caret(state)).toEqual([0, 8]);
    });

    it("previous from the first wraps to the last", () => {
        const state = makeState(text, 0, 2);
        moveToWordHighlight(state, -1);
        expect(caret(state)).toEqual([1, 0]);
    });

    it("cursor right after a word counts as on that word", () => {
        const state = makeState(text, 0, 11);
        moveToWordHighlight(state, 1);
        expect(caret(state)).toEqual([1, 0]);
    });

    it("single occurrence: the cursor moves to its start", () => {
        const state = makeState("hello world", 0, 3);
        moveToWordHighlight(state, 1);
        expect(caret(state)).toEqual([0, 0]);
    });

    it("cursor not on a word is a no-op", () => {
        const state = makeState("foo  foo", 0, 4);
        moveToWordHighlight(state, 1);
        expect(caret(state)).toEqual([0, 4]);
    });

    it("target outside the viewport: the viewport scrolls to it", () => {
        const lines = ["foo", ...Array.from({ length: 50 }, () => "x"), "  foo"];
        const state = makeState(lines.join("\n"), 0, 0);
        state.viewportHeight = 10;
        state.viewportWidth = 80;
        moveToWordHighlight(state, 1);
        expect(caret(state)).toEqual([51, 2]);
        expect(state.scrollTop).toBeGreaterThan(0);
    });
});
