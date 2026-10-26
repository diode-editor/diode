import { packRgb } from "@tuidom/core/common/colorUtils";
import type { CursorStyle } from "@tuidom/core/common/cursorStyle";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import { createCursorSelection } from "../common/core/iSelection.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

/** Dark+ default of `editorCursor.foreground` — the background of a cell cursor. */
const CARET_BG = packRgb(0xae, 0xaf, 0xad);

const BAR: CursorStyle = { shape: "bar", blinking: true };
const UNDERLINE: CursorStyle = { shape: "underline", blinking: false };
const BLOCK: CursorStyle = { shape: "block", blinking: true };

function createEditor(text: string): { app: TestApp; editor: EditorElement; viewState: EditorViewState; gw: number } {
    const viewState = new EditorViewState(new TextDocument(text));
    const editor = new EditorElement(viewState);
    const app = TestApp.createWithContent(editor, new Size(30, 5));
    return { app, editor, viewState, gw: editor.gutterWidth };
}

describe("EditorElement — hardware cursor shape (editor.cursorStyle)", () => {
    it("the focused editor hands its shape to the terminal with the caret position", () => {
        const { app, editor, viewState, gw } = createEditor("abc");
        editor.cursorStyle = BAR;
        viewState.selections = [createCursorSelection(0, 2)];
        editor.focus();
        app.render();

        expect(app.backend.cursorPosition).toEqual(new Point(gw + 2, 0));
        expect(app.backend.cursorStyle).toEqual(BAR);
    });

    it("without a style the terminal keeps its own shape", () => {
        const { app, editor } = createEditor("abc");
        editor.focus();
        app.render();

        expect(app.backend.cursorStyle).toBeNull();
    });
});

describe("EditorElement — multi-cursor with a non-block cursor style", () => {
    it.each([
        ["bar", BAR],
        ["underline", UNDERLINE],
    ])("%s: the primary is only the hardware cursor, secondaries stay cell blocks", (_name, style) => {
        const { app, editor, viewState, gw } = createEditor("abc\ndef");
        editor.cursorStyle = style;
        viewState.selections = [createCursorSelection(0, 1), createCursorSelection(1, 2)];
        editor.focus();
        app.render();

        expect(app.backend.getBgAt(new Point(gw + 1, 0))).not.toBe(CARET_BG);
        expect(app.backend.cursorPosition).toEqual(new Point(gw + 1, 0));
        expect(app.backend.cursorStyle).toEqual(style);
        expect(app.backend.getBgAt(new Point(gw + 2, 1))).toBe(CARET_BG);
    });

    it.each([
        ["block", BLOCK],
        ["the terminal's shape", null],
    ])("%s: the primary is painted as a cell block too", (_name, style) => {
        const { app, editor, viewState, gw } = createEditor("abc\ndef");
        editor.cursorStyle = style;
        viewState.selections = [createCursorSelection(0, 1), createCursorSelection(1, 2)];
        editor.focus();
        app.render();

        expect(app.backend.getBgAt(new Point(gw + 1, 0))).toBe(CARET_BG);
        expect(app.backend.getBgAt(new Point(gw + 2, 1))).toBe(CARET_BG);
    });
});
