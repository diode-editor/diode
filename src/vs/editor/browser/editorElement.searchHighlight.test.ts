import { describe, expect, it } from "vitest";

import { packRgb } from "@tuidom/all/common/colorUtils";
import { Point, Size } from "@tuidom/all/common/geometryPromitives";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { createRange } from "../common/core/iRange.ts";
import { createSelection } from "../common/core/iSelection.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

const FIND_MATCH_BG = packRgb(98, 91, 23);
const FIND_MATCH_CURRENT_BG = packRgb(168, 109, 0);
const SELECTION_BG = packRgb(38, 79, 120);

function createEditor(
    text: string,
    width = 30,
    height = 5,
): { app: TestApp; editor: EditorElement; viewState: EditorViewState; gw: number } {
    const doc = new TextDocument(text);
    const viewState = new EditorViewState(doc);
    const editor = new EditorElement(viewState);
    editor.occurrenceHighlightEnabled = false; // these cases isolate search-match highlighting
    const app = TestApp.createWithContent(editor, new Size(width, height));
    return { app, editor, viewState, gw: editor.gutterWidth };
}

describe("EditorElement — search-match highlight", () => {
    it("paints a non-current match with FIND_MATCH_BG and the current with FIND_MATCH_CURRENT_BG", () => {
        // "foo bar foo" — matches at chars 0..3 and 8..11; the second is current.
        const { app, viewState, gw } = createEditor("foo bar foo");
        viewState.searchMatches = [createRange(0, 0, 0, 3), createRange(0, 8, 0, 11)];
        viewState.currentSearchMatchIndex = 1;
        app.render();

        // First (non-current) match.
        expect(app.backend.getBgAt(new Point(gw, 0))).toBe(FIND_MATCH_BG);
        // Second (current) match starts at content column 8.
        expect(app.backend.getBgAt(new Point(gw + 8, 0))).toBe(FIND_MATCH_CURRENT_BG);
    });

    it("draws the current match on top of an overlapping selection", () => {
        const { app, viewState, gw } = createEditor("foo");
        viewState.selections = [createSelection(0, 0, 0, 3)];
        viewState.searchMatches = [createRange(0, 0, 0, 3)];
        viewState.currentSearchMatchIndex = 0;
        app.render();

        expect(app.backend.getBgAt(new Point(gw, 0))).toBe(FIND_MATCH_CURRENT_BG);
        expect(app.backend.getBgAt(new Point(gw, 0))).not.toBe(SELECTION_BG);
    });

    it("does not highlight anything when there are no matches", () => {
        const { app, editor, viewState, gw } = createEditor("foo");
        viewState.searchMatches = [];
        viewState.currentSearchMatchIndex = -1;
        app.render();

        const bg = app.backend.getBgAt(new Point(gw, 0));
        expect(bg).toBe(editor.resolvedStyle.bg);
        expect(bg).not.toBe(FIND_MATCH_BG);
        expect(bg).not.toBe(FIND_MATCH_CURRENT_BG);
    });
});
