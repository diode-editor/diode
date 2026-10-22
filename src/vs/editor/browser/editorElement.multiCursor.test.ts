import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import { MarkerSeverity } from "../../platform/markers/common/iMarker.ts";
import { createCursorSelection, createSelection } from "../common/core/iSelection.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

/** Dark+ defaults for the `editorCursor.*` tokens (the theme does not override them). */
const CARET_BG = packRgb(0xae, 0xaf, 0xad); // editorCursor.foreground
const CARET_FG = packRgb(0x51, 0x50, 0x52); // editorCursor.background

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

describe("EditorElement — secondary cursors in the frame", () => {
    it("each multi-cursor cursor is painted as an inverse block", () => {
        const { app, editor, viewState, gw } = createEditor("abc\ndef");
        viewState.selections = [createCursorSelection(0, 1), createCursorSelection(1, 2)];
        editor.focus();
        app.render();

        expect(app.backend.getBgAt(new Point(gw + 1, 0))).toBe(CARET_BG);
        expect(app.backend.getFgAt(new Point(gw + 1, 0))).toBe(CARET_FG);
        expect(app.backend.getBgAt(new Point(gw + 2, 1))).toBe(CARET_BG);
        expect(app.backend.getFgAt(new Point(gw + 2, 1))).toBe(CARET_FG);
    });

    it("the glyph under the cursor stays in place — the patch is partial", () => {
        const { app, editor, viewState, gw } = createEditor("abc");
        viewState.selections = [createCursorSelection(0, 1), createCursorSelection(0, 2)];
        editor.focus();
        app.render();

        expect(app.backend.getTextAt(new Point(gw + 1, 0), 2)).toBe("bc");
    });

    it("colors come from theme tokens, not hardcoded", () => {
        const customBg = packRgb(10, 200, 30);
        const customFg = packRgb(200, 10, 30);
        const { app, editor, viewState, gw } = createEditor("abc");
        editor.setStyleVars({ "editorCursor.foreground": customBg, "editorCursor.background": customFg });
        viewState.selections = [createCursorSelection(0, 0), createCursorSelection(0, 2)];
        editor.focus();
        app.render();

        expect(app.backend.getBgAt(new Point(gw + 0, 0))).toBe(customBg);
        expect(app.backend.getFgAt(new Point(gw + 0, 0))).toBe(customFg);
    });

    it("with a single cursor the frame is unchanged — the terminal draws the cursor", () => {
        // Cursor on a space: no word under it, so no occurrence highlight —
        // the cell must keep the plain editor background.
        const { app, editor, viewState, gw } = createEditor("a b");
        viewState.selections = [createCursorSelection(0, 1)];
        editor.focus();
        app.render();

        expect(app.backend.getBgAt(new Point(gw + 1, 0))).toBe(editor.resolvedStyle.bg);
        expect(app.backend.cursorPosition.x).toBe(gw + 1);
    });

    it("the primary cursor in multi-cursor is drawn AND holds the hardware cursor", () => {
        const { app, editor, viewState, gw } = createEditor("abc\ndef");
        viewState.selections = [createCursorSelection(0, 0), createCursorSelection(1, 0)];
        editor.focus();
        app.render();

        expect(app.backend.getBgAt(new Point(gw + 0, 0))).toBe(CARET_BG);
        expect(app.backend.cursorPosition.x).toBe(gw + 0);
        expect(app.backend.cursorPosition.y).toBe(0);
    });

    it("no cursors without focus", () => {
        const { app, viewState, editor, gw } = createEditor("abc\ndef");
        viewState.selections = [createCursorSelection(0, 1), createCursorSelection(1, 1)];
        app.render();

        expect(app.backend.getBgAt(new Point(gw + 1, 0))).toBe(editor.resolvedStyle.bg);
        expect(app.backend.getBgAt(new Point(gw + 1, 1))).toBe(editor.resolvedStyle.bg);
    });

    it("cursors are drawn in read-only — selecting and copying still work there", () => {
        const { app, editor, viewState, gw } = createEditor("abc\ndef");
        viewState.readOnly = true;
        viewState.selections = [createCursorSelection(0, 1), createCursorSelection(1, 1)];
        editor.focus();
        app.render();

        expect(app.backend.getBgAt(new Point(gw + 1, 0))).toBe(CARET_BG);
    });
});

describe("EditorElement — cursor above other layers", () => {
    it("beats the selection background", () => {
        const { app, editor, viewState, gw } = createEditor("abcdef");
        viewState.selections = [createSelection(0, 1, 0, 4), createCursorSelection(0, 5)];
        editor.focus();
        app.render();

        // The active end of the selection (column 4) is the cursor; the column next to it has the selection bg.
        expect(app.backend.getBgAt(new Point(gw + 4, 0))).toBe(CARET_BG);
        expect(app.backend.getBgAt(new Point(gw + 3, 0))).not.toBe(CARET_BG);
    });

    it("beats the find match highlight", () => {
        const { app, editor, viewState, gw } = createEditor("foo foo");
        viewState.searchMatches = [
            { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
            { start: { line: 0, character: 4 }, end: { line: 0, character: 7 } },
        ];
        viewState.currentSearchMatchIndex = 0;
        viewState.selections = [createCursorSelection(0, 0), createCursorSelection(0, 5)];
        editor.focus();
        app.render();

        expect(app.backend.getBgAt(new Point(gw + 0, 0))).toBe(CARET_BG);
        expect(app.backend.getBgAt(new Point(gw + 5, 0))).toBe(CARET_BG);
    });

    it("suppresses the diagnostic underline beneath it", () => {
        const { app, editor, viewState, gw } = createEditor("abcdef");
        editor.markerDecorations = [
            {
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
                severity: MarkerSeverity.Error,
            },
        ];
        viewState.selections = [createCursorSelection(0, 1), createCursorSelection(0, 3)];
        editor.focus();
        app.render();

        const cell = app.app.screen.getCell(new Point(gw + 1, 0));
        expect(cell.style).toBe(StyleFlags.None);
        expect(app.backend.getFgAt(new Point(gw + 1, 0))).toBe(CARET_FG);
        expect(app.app.screen.getCell(new Point(gw + 2, 0)).style).not.toBe(StyleFlags.None);
    });

    it("occurrence highlight is off in multi-cursor", () => {
        vi.useFakeTimers();
        const { app, editor, viewState, gw } = createEditor("foo bar foo");
        viewState.selections = [createCursorSelection(0, 1)];
        editor.focus();
        app.render();
        // The occurrence query runs after the frame (upstream `WordHighlighter.runDelayer`).
        vi.advanceTimersByTime(50);
        vi.useRealTimers();
        app.render();
        const highlighted = app.backend.getBgAt(new Point(gw + 8, 0));
        expect(highlighted).not.toBe(editor.resolvedStyle.bg);

        viewState.selections = [createCursorSelection(0, 1), createCursorSelection(0, 5)];
        app.render();
        expect(app.backend.getBgAt(new Point(gw + 8, 0))).toBe(editor.resolvedStyle.bg);
    });

    it("exactly one line number is highlighted — the primary cursor's", () => {
        const { app, editor, viewState } = createEditor("aaa\nbbb\nccc");
        viewState.selections = [createCursorSelection(0, 0), createCursorSelection(2, 0)];
        editor.focus();
        app.render();

        const activeFg = app.backend.getFgAt(new Point(0, 0));
        const secondaryFg = app.backend.getFgAt(new Point(0, 2));
        expect(activeFg).not.toBe(secondaryFg);
    });
});
