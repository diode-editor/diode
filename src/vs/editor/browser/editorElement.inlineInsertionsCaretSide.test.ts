import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import { createCursorSelection, createSelection } from "../common/core/iSelection.ts";
import type { IInlineInsertion } from "../common/model/iInlineInsertion.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

/** An insertion with `caretSide: "right"` (a color swatch): the block caret never covers its cells. */

const EDITOR_FG = packRgb(0xd4, 0xd4, 0xd4);
const BG = packRgb(0x1e, 0x1e, 0x1e);
const SELECTION_BG = packRgb(0x26, 0x4f, 0x78);
const CARET_BG = packRgb(0xae, 0xaf, 0xad);

const STYLE_VARS = {
    "editor.background": BG,
    "editor.foreground": EDITOR_FG,
    "editor.selectionBackground": SELECTION_BG,
    "editorCursor.foreground": CARET_BG,
};

function swatch(line: number, offset: number): IInlineInsertion {
    return { line, offset, text: "■ ", caretSide: "right" };
}

function createEditor(
    text: string,
    insertions: readonly IInlineInsertion[],
): { app: TestApp; editor: EditorElement; gutterW: number } {
    const viewState = new EditorViewState(new TextDocument(text));
    const editor = new EditorElement(viewState);
    editor.occurrenceHighlightEnabled = false;
    editor.setStyleVars(STYLE_VARS);
    editor.style = { fg: "editor.foreground", bg: "editor.background" };
    editor.setInlineInsertions(insertions);
    const app = TestApp.createWithContent(editor, new Size(30, 4));
    editor.focus();
    app.render();
    return { app, editor, gutterW: editor.gutterWidth };
}

describe("EditorElement — caret next to a right-side insertion", () => {
    it("a caret at the swatch's point stands on the first character after the swatch", () => {
        const { app, editor, gutterW } = createEditor("c: #f00;", [swatch(0, 3)]);
        // "c: ■ #f00;": the swatch at 3, the space at 4, "#" at 5.
        expect(app.backend.getTextAt(new Point(gutterW, 0), 10)).toBe("c: ■ #f00;");

        editor.viewState.selections = [createCursorSelection(0, 3)];
        app.render();
        expect(editor.getCaretScreenCell()).toEqual(new Point(gutterW + 5, 0));

        // One character to the left is the space before the swatch, left of it.
        editor.viewState.cursorLeft();
        app.render();
        expect(editor.getCaretScreenCell()).toEqual(new Point(gutterW + 2, 0));
    });

    it("walking the line with the arrows never puts the caret on the swatch or the space after it", () => {
        const { app, editor, gutterW } = createEditor("c: #f00;", [swatch(0, 3)]);
        editor.viewState.selections = [createCursorSelection(0, 8)];
        const columns: number[] = [];
        for (let i = 0; i < 8; i++) {
            editor.viewState.cursorLeft();
            app.render();
            columns.push(editor.getCaretScreenCell()!.x - gutterW);
        }
        expect(columns).toEqual([9, 8, 7, 6, 5, 2, 1, 0]);
    });

    it("a swatch at column 0: Home puts the caret on the color, the swatch stays left of it", () => {
        const { app, editor, gutterW } = createEditor("x\n#fff", [swatch(1, 0)]);
        editor.viewState.selections = [createCursorSelection(1, 4)];
        editor.viewState.cursorHome();
        app.render();
        expect(editor.viewState.selections[0].active).toEqual({ line: 1, character: 0 });
        expect(editor.getCaretScreenCell()).toEqual(new Point(gutterW + 2, 1));
    });

    it("a click on the swatch or the space after it puts the caret on the color", () => {
        const { app, editor, gutterW } = createEditor("c: #f00;", [swatch(0, 3)]);
        for (const x of [3, 4]) {
            const position = editor.docPositionAt(gutterW + x, 0);
            editor.viewState.selections = [createCursorSelection(position.line, position.character)];
            app.render();
            expect(editor.getCaretScreenCell()).toEqual(new Point(gutterW + 5, 0));
        }
    });

    it("secondary carets at the swatch's point are painted on the color, not on the swatch", () => {
        const { app, gutterW, editor } = createEditor("#f00\n#0f0", [swatch(0, 0), swatch(1, 0)]);
        editor.viewState.selections = [createCursorSelection(0, 0), createCursorSelection(1, 0)];
        app.render();
        for (const y of [0, 1]) {
            expect(app.backend.getBgAt(new Point(gutterW, y))).toBe(BG);
            expect(app.backend.getBgAt(new Point(gutterW + 1, y))).toBe(BG);
            expect(app.backend.getBgAt(new Point(gutterW + 2, y))).toBe(CARET_BG);
        }
    });

    it("with a bar cursor style the hardware cursor is on the color too", () => {
        const { app, editor, gutterW } = createEditor("c: #f00;", [swatch(0, 3)]);
        editor.cursorStyle = { shape: "bar", blinking: false };
        editor.viewState.selections = [createCursorSelection(0, 3)];
        app.render();
        expect(editor.getCaretScreenCell()).toEqual(new Point(gutterW + 5, 0));
    });

    it("a selection ending at the swatch's point does not cover the swatch, the caret is on the color", () => {
        const { app, editor, gutterW } = createEditor("c: #f00;", [swatch(0, 3)]);
        editor.viewState.selections = [createSelection(0, 1, 0, 3)];
        app.render();
        expect(app.backend.getBgAt(new Point(gutterW + 1, 0))).toBe(SELECTION_BG);
        expect(app.backend.getBgAt(new Point(gutterW + 2, 0))).toBe(SELECTION_BG);
        expect(app.backend.getBgAt(new Point(gutterW + 3, 0))).toBe(BG);
        expect(app.backend.getBgAt(new Point(gutterW + 4, 0))).toBe(BG);
        expect(editor.getCaretScreenCell()).toEqual(new Point(gutterW + 5, 0));
    });

    it("a left-side insertion before a swatch at the same point: the caret passes both", () => {
        const { app, editor, gutterW } = createEditor("ab", [{ line: 0, offset: 1, text: "XY" }, swatch(0, 1)]);
        // "aXY■ b"
        editor.viewState.selections = [createCursorSelection(0, 1)];
        app.render();
        expect(editor.getCaretScreenCell()).toEqual(new Point(gutterW + 5, 0));
    });

    it("a swatch before a left-side insertion at the same point: the caret stops between them", () => {
        const { app, editor, gutterW } = createEditor("ab", [swatch(0, 1), { line: 0, offset: 1, text: "XY" }]);
        // "a■ XYb"
        editor.viewState.selections = [createCursorSelection(0, 1)];
        app.render();
        expect(editor.getCaretScreenCell()).toEqual(new Point(gutterW + 3, 0));
    });
});
