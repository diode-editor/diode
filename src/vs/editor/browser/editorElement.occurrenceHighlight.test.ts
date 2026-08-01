import { describe, expect, it } from "vitest";

import { packRgb } from "../../../../tuidom/common/colorUtils.ts";
import { Point, Size } from "../../../../tuidom/common/geometryPromitives.ts";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { createCursorSelection, createSelection } from "../common/core/iSelection.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

// Default occurrence-highlight background (DEFAULT_OCCURRENCE_HIGHLIGHT_BG in EditorElement).
const OCCURRENCE_BG = packRgb(71, 71, 71);

function createEditor(
    text: string,
    width = 30,
    height = 5,
): { app: TestApp; editor: EditorElement; viewState: EditorViewState; gw: number } {
    const doc = new TextDocument(text);
    const viewState = new EditorViewState(doc);
    const editor = new EditorElement(viewState);
    const app = TestApp.createWithContent(editor, new Size(width, height));
    return { app, editor, viewState, gw: editor.gutterWidth };
}

describe("EditorElement — occurrence highlight (word under cursor)", () => {
    it("highlights every occurrence of the word under the cursor", () => {
        // "foo bar foo" — cursor inside the first "foo".
        const { app, viewState, gw } = createEditor("foo bar foo");
        viewState.selections = [createCursorSelection(0, 1)];
        app.render();

        // First "foo" (cols 0..2).
        expect(app.backend.getBgAt(new Point(gw + 0, 0))).toBe(OCCURRENCE_BG);
        expect(app.backend.getBgAt(new Point(gw + 2, 0))).toBe(OCCURRENCE_BG);
        // Second "foo" (cols 8..10).
        expect(app.backend.getBgAt(new Point(gw + 8, 0))).toBe(OCCURRENCE_BG);
        expect(app.backend.getBgAt(new Point(gw + 10, 0))).toBe(OCCURRENCE_BG);
    });

    it("does not highlight the intervening non-matching word", () => {
        const { app, editor, viewState, gw } = createEditor("foo bar foo");
        viewState.selections = [createCursorSelection(0, 0)];
        app.render();

        // "bar" (col 4) keeps the plain editor background.
        expect(app.backend.getBgAt(new Point(gw + 4, 0))).toBe(editor.resolvedStyle.bg);
    });

    it("uses the configured wordHighlight background when set", () => {
        const custom = packRgb(90, 10, 10);
        const { app, editor, viewState, gw } = createEditor("foo foo");
        editor.setStyleVars({ "editor.wordHighlightBackground": custom });
        viewState.selections = [createCursorSelection(0, 0)];
        app.render();

        expect(app.backend.getBgAt(new Point(gw + 0, 0))).toBe(custom);
        expect(app.backend.getBgAt(new Point(gw + 4, 0))).toBe(custom);
    });

    it("highlights nothing when the cursor rests on whitespace", () => {
        const { app, editor, viewState, gw } = createEditor("foo  foo");
        viewState.selections = [createCursorSelection(0, 4)]; // between the two spaces
        app.render();

        expect(app.backend.getBgAt(new Point(gw + 0, 0))).toBe(editor.resolvedStyle.bg);
        expect(app.backend.getBgAt(new Point(gw + 5, 0))).toBe(editor.resolvedStyle.bg);
    });

    it("suppresses the highlight while a selection is active", () => {
        const { app, editor, viewState, gw } = createEditor("foo bar foo");
        // Select just the "bar" — occurrence highlighting is off while selecting.
        viewState.selections = [createSelection(0, 4, 0, 7)];
        app.render();

        // The other "foo"s are not word-highlighted (col 0 stays editor bg).
        expect(app.backend.getBgAt(new Point(gw + 0, 0))).toBe(editor.resolvedStyle.bg);
    });

    it("does nothing when disabled", () => {
        const { app, editor, viewState, gw } = createEditor("foo foo");
        editor.occurrenceHighlightEnabled = false;
        viewState.selections = [createCursorSelection(0, 0)];
        app.render();

        expect(app.backend.getBgAt(new Point(gw + 0, 0))).toBe(editor.resolvedStyle.bg);
        expect(app.backend.getBgAt(new Point(gw + 4, 0))).toBe(editor.resolvedStyle.bg);
    });

    it("keeps the highlight stable across re-renders and updates it when the cursor moves", () => {
        const { app, editor, viewState, gw } = createEditor("foo bar foo");
        viewState.selections = [createCursorSelection(0, 0)];

        app.render(); // first pass computes and caches
        app.render(); // second pass with the same caret hits the cache
        expect(app.backend.getBgAt(new Point(gw + 0, 0))).toBe(OCCURRENCE_BG);

        // Move onto "bar" — the cached word is stale, so it recomputes.
        viewState.selections = [createCursorSelection(0, 4)];
        app.render();
        expect(app.backend.getBgAt(new Point(gw + 4, 0))).toBe(OCCURRENCE_BG);
        // The former "foo" occurrences are no longer highlighted.
        expect(app.backend.getBgAt(new Point(gw + 0, 0))).toBe(editor.resolvedStyle.bg);
    });

    it("selection background wins over the occurrence highlight on overlap", () => {
        const SELECTION_BG = packRgb(38, 79, 120);
        const { app, viewState, gw } = createEditor("foo foo");
        // Primary collapsed cursor on "foo" plus a second selection covering the
        // second "foo" — the selection paints on top of the occurrence highlight.
        viewState.selections = [createCursorSelection(0, 0), createSelection(0, 4, 0, 7)];
        app.render();

        expect(app.backend.getBgAt(new Point(gw + 4, 0))).toBe(SELECTION_BG);
    });
});
