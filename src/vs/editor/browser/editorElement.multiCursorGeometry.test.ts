import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import { createCursorSelection } from "../common/core/iSelection.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";
import { createFoldingRegion } from "../contrib/folding/iFoldingRegion.ts";

import { EditorElement } from "./editorElement.ts";

const CARET_BG = packRgb(0xae, 0xaf, 0xad);

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

function makeLines(count: number): string {
    return Array.from({ length: count }, (_, i) => `line ${i.toString()}`).join("\n");
}

describe("EditorElement — secondary cursor geometry", () => {
    it("wide character: glyph and width intact, continuation painted", () => {
        const { app, editor, viewState, gw } = createEditor("漢x漢");
        viewState.selections = [createCursorSelection(0, 0), createCursorSelection(0, 1)];
        editor.focus();
        app.render();

        const head = app.app.screen.getCell(new Point(gw + 0, 0));
        expect(head.char).toBe("漢");
        expect(head.width).toBe(2);
        expect(app.backend.getBgAt(new Point(gw + 0, 0))).toBe(CARET_BG);
        // The engine paints a wide character's continuation cell together with its head.
        expect(app.backend.getBgAt(new Point(gw + 1, 0))).toBe(CARET_BG);
    });

    it("a cursor after a wide character lands in its display column", () => {
        const { app, editor, viewState, gw } = createEditor("漢x");
        viewState.selections = [createCursorSelection(0, 1), createCursorSelection(0, 2)];
        editor.focus();
        app.render();

        // Offset 1 is display column 2 (the wide character took 0 and 1).
        expect(app.backend.getBgAt(new Point(gw + 2, 0))).toBe(CARET_BG);
    });

    it("tab: exactly one column of four is inverted", () => {
        const { app, editor, viewState, gw } = createEditor("\tx\n\ty");
        editor.tabSize = 4;
        viewState.selections = [createCursorSelection(0, 0), createCursorSelection(1, 0)];
        editor.focus();
        app.render();

        expect(app.backend.getBgAt(new Point(gw + 0, 0))).toBe(CARET_BG);
        expect(app.backend.getBgAt(new Point(gw + 1, 0))).toBe(editor.resolvedStyle.bg);
        expect(app.backend.getBgAt(new Point(gw + 3, 0))).toBe(editor.resolvedStyle.bg);
    });

    it("a cursor past the line end is drawn on an empty cell", () => {
        const { app, editor, viewState, gw } = createEditor("abc\nabcdef");
        viewState.selections = [createCursorSelection(0, 3), createCursorSelection(1, 6)];
        editor.focus();
        app.render();

        expect(app.backend.getBgAt(new Point(gw + 3, 0))).toBe(CARET_BG);
        expect(app.backend.getTextAt(new Point(gw + 3, 0), 1)).toBe(" ");
    });

    it("a cursor on an empty line is drawn at column 0", () => {
        const { app, editor, viewState, gw } = createEditor("abc\n\ndef");
        viewState.selections = [createCursorSelection(0, 0), createCursorSelection(1, 0)];
        editor.focus();
        app.render();

        expect(app.backend.getBgAt(new Point(gw + 0, 1))).toBe(CARET_BG);
    });

    it("two cursors on one line are both drawn", () => {
        const { app, editor, viewState, gw } = createEditor("abcdef");
        viewState.selections = [createCursorSelection(0, 1), createCursorSelection(0, 4)];
        editor.focus();
        app.render();

        expect(app.backend.getBgAt(new Point(gw + 1, 0))).toBe(CARET_BG);
        expect(app.backend.getBgAt(new Point(gw + 4, 0))).toBe(CARET_BG);
    });

    it("a cursor inside a folded region is not drawn and the header is not dirtied", () => {
        const { app, editor, viewState, gw } = createEditor("header\n  body\nafter");
        viewState.selections = [createCursorSelection(2, 0), createCursorSelection(1, 2)];
        viewState.foldedRegions = [createFoldingRegion(0, 1, true)];
        editor.focus();
        app.render();

        // View row 0 is the header; the cursor on hidden line 1 is not in the frame.
        for (let x = 0; x < 6; x++) {
            expect(app.backend.getBgAt(new Point(gw + x, 0))).not.toBe(CARET_BG);
        }
    });

    it("a cursor above or below the viewport is not drawn", () => {
        const { app, editor, viewState, gw } = createEditor(makeLines(40), 30, 4);
        viewState.scrollTop = 10;
        viewState.selections = [
            createCursorSelection(0, 0),
            createCursorSelection(11, 0),
            createCursorSelection(39, 0),
        ];
        editor.focus();
        app.render();

        // Only the line 11 cursor is visible → screen row 1.
        expect(app.backend.getBgAt(new Point(gw + 0, 1))).toBe(CARET_BG);
        expect(app.backend.getBgAt(new Point(gw + 0, 0))).not.toBe(CARET_BG);
        expect(app.backend.getBgAt(new Point(gw + 0, 3))).not.toBe(CARET_BG);
    });

    it("horizontal scroll: a cursor left of the viewport disappears, one at its edge is drawn", () => {
        const { app, editor, viewState, gw } = createEditor("abcdefghijklmnop\nabcdefghijklmnop", 20, 4);
        viewState.scrollLeft = 5;
        viewState.selections = [createCursorSelection(0, 2), createCursorSelection(1, 5)];
        editor.focus();
        app.render();

        // The line 1 cursor is exactly at the viewport's left edge.
        expect(app.backend.getBgAt(new Point(gw + 0, 1))).toBe(CARET_BG);
        // The line 0 cursor scrolled off to the left: it is in no column of the frame.
        for (let x = 0; x + gw < 20; x++) {
            expect(app.backend.getBgAt(new Point(gw + x, 0))).not.toBe(CARET_BG);
        }
    });

    it("horizontal scroll: a cursor right of the viewport is not drawn", () => {
        const { app, editor, viewState, gw } = createEditor("abcdefghijklmnopqrstuvwxyz\nabc", 14, 4);
        viewState.selections = [createCursorSelection(0, 25), createCursorSelection(1, 0)];
        editor.focus();
        app.render();

        expect(app.backend.getBgAt(new Point(gw + 0, 1))).toBe(CARET_BG);
        for (let x = 0; x + gw < 14; x++) {
            expect(app.backend.getBgAt(new Point(gw + x, 0))).not.toBe(CARET_BG);
        }
    });

    it("the zone row stays clean and the cursor below it shifts with the projection", () => {
        const { app, editor, viewState, gw } = createEditor("aaa\nbbb\nccc", 20, 5);
        viewState.setViewZones([{ afterLine: 0, size: 1 }]);
        viewState.selections = [createCursorSelection(0, 0), createCursorSelection(1, 0)];
        editor.focus();
        app.render();

        expect(app.backend.getBgAt(new Point(gw + 0, 0))).toBe(CARET_BG);
        // Screen row 1 is a view zone: no document line behind it.
        expect(app.backend.getBgAt(new Point(gw + 0, 1))).not.toBe(CARET_BG);
        // Document line 1 moved to screen row 2.
        expect(app.backend.getBgAt(new Point(gw + 0, 2))).toBe(CARET_BG);
    });
});
