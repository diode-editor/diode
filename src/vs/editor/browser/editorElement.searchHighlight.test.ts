import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

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

        expect(app.backend.getBgAt(new Point(gw, 0))).toBe(FIND_MATCH_BG);
        expect(app.backend.getBgAt(new Point(gw + 8, 0))).toBe(FIND_MATCH_CURRENT_BG);
    });

    it("paints the matches of the visible rows of a scrolled file, multi-line ones included", () => {
        // Line i is "ab"; one match per line, plus one spanning lines 501..502 from its middle.
        const text = Array.from({ length: 1000 }, () => "ab").join("\n");
        const { app, editor, viewState, gw } = createEditor(text, 30, 5);
        const matches = Array.from({ length: 1000 }, (_, i) => createRange(i, 0, i, 1));
        matches.splice(502, 0, createRange(501, 1, 502, 0));
        viewState.searchMatches = matches;
        viewState.currentSearchMatchIndex = 500;
        viewState.scrollTop = 499;
        app.render();

        // Rows show lines 499..503.
        expect(app.backend.getBgAt(new Point(gw, 0))).toBe(FIND_MATCH_BG);
        expect(app.backend.getBgAt(new Point(gw, 1))).toBe(FIND_MATCH_CURRENT_BG);
        expect(app.backend.getBgAt(new Point(gw + 1, 1))).toBe(editor.resolvedStyle.bg);
        // The spanning match covers line 501 from char 1 through the virtual newline cell.
        expect(app.backend.getBgAt(new Point(gw + 1, 2))).toBe(FIND_MATCH_BG);
        expect(app.backend.getBgAt(new Point(gw + 2, 2))).toBe(FIND_MATCH_BG);
        expect(app.backend.getBgAt(new Point(gw + 3, 2))).toBe(editor.resolvedStyle.bg);
        expect(app.backend.getBgAt(new Point(gw, 4))).toBe(FIND_MATCH_BG);
        expect(app.backend.getBgAt(new Point(gw + 1, 4))).toBe(editor.resolvedStyle.bg);
    });

    it("paints nothing for matches above or below the viewport", () => {
        const text = Array.from({ length: 100 }, () => "ab").join("\n");
        const { app, editor, viewState, gw } = createEditor(text, 30, 5);
        viewState.searchMatches = [createRange(10, 0, 10, 1), createRange(90, 0, 90, 1)];
        viewState.currentSearchMatchIndex = -1;
        viewState.scrollTop = 50;
        app.render();

        for (let row = 0; row < 5; row++) {
            expect(app.backend.getBgAt(new Point(gw, row))).toBe(editor.resolvedStyle.bg);
        }
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
