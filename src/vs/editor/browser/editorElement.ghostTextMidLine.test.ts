import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import { MarkerSeverity } from "../../platform/markers/common/iMarker.ts";
import { createRange } from "../common/core/iRange.ts";
import { createCursorSelection } from "../common/core/iSelection.ts";
import { WordTokenColor, WordTokenizer } from "../common/languages/builtin/wordTokenizer.ts";
import { ColorMapTokenStyleResolver } from "../common/languages/colorMapTokenStyleResolver.ts";
import type { IGhostText } from "../common/model/iGhostText.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { DocumentTokenStore } from "../common/tokens/documentTokenStore.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

/** Cursor IN THE MIDDLE of a line (n-4): columns and all overlay passes are computed on the composed line. */

const GHOST_FG = packRgb(0x6a, 0x6a, 0x6a);
const EDITOR_FG = packRgb(0xd4, 0xd4, 0xd4);
const BG = packRgb(0x1e, 0x1e, 0x1e);
const CARET_BG = packRgb(0xae, 0xaf, 0xad);
const WARNING_FG = packRgb(0xcc, 0xa7, 0x00);
const KEYWORD_FG = packRgb(0xff, 0x00, 0x00);
const NUMBER_FG = packRgb(0x00, 0xff, 0x00);

/** Colors only keywords and numbers, as in the highlighting tests. */
const COLOR_MAP: string[] = ["", "#000000", "#000000"];
COLOR_MAP[WordTokenColor.keyword] = "#ff0000";
COLOR_MAP[WordTokenColor.number] = "#00ff00";

const STYLE_VARS = {
    "editor.background": BG,
    "editor.foreground": EDITOR_FG,
    "editorGhostText.foreground": GHOST_FG,
};

function createEditor(
    text: string,
    ghost: IGhostText | null,
    size = new Size(30, 4),
): { app: TestApp; editor: EditorElement } {
    const viewState = new EditorViewState(new TextDocument(text));
    const editor = new EditorElement(viewState);
    editor.setStyleVars(STYLE_VARS);
    editor.style = { fg: "editor.foreground", bg: "editor.background" };
    editor.setGhostText(ghost);
    const app = TestApp.createWithContent(editor, size);
    app.render();
    return { app, editor };
}

describe("EditorElement — ghost text в середине строки", () => {
    it("фантом вставляется между кареткой и хвостом строки, хвост сдвигается вправо", () => {
        const { app, editor } = createEditor("call();", { line: 0, character: 5, lines: ["arg"] });

        const gutterW = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gutterW, 0), 10)).toBe("call(arg);");
        expect(app.backend.getFgAt(new Point(gutterW + 5, 0))).toBe(GHOST_FG);
        expect(app.backend.getFgAt(new Point(gutterW + 7, 0))).toBe(GHOST_FG);
        expect(app.backend.getFgAt(new Point(gutterW + 8, 0))).toBe(EDITOR_FG);
        expect(editor.viewState.document.getText()).toBe("call();");
    });

    it("снятие подсказки возвращает строку в исходный вид", () => {
        const { app, editor } = createEditor("call();", { line: 0, character: 5, lines: ["arg"] });

        editor.setGhostText(null);
        app.render();

        const gutterW = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gutterW, 0), 10)).toBe("call();   ");
    });

    it("многострочная подсказка: хвост остаётся на строке каретки, продолжение — в зонах", () => {
        // Deviation from upstream (which moves the tail below the last ghost text line):
        // the view zone holds only ghost text; a document line cannot move into it.
        const { app, editor } = createEditor("call();", {
            line: 0,
            character: 5,
            lines: ["arg,", "more"],
        });

        const gutterW = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gutterW, 0), 12)).toBe("call(arg,); ");
        expect(app.backend.getTextAt(new Point(gutterW, 1), 4)).toBe("more");
        expect(app.backend.getFgAt(new Point(gutterW, 1))).toBe(GHOST_FG);
    });

    it("каретка остаётся ПЕРЕД фантомом, вторичная за ним — уезжает с хвостом", () => {
        const { app, editor } = createEditor("call();", { line: 0, character: 5, lines: ["arg"] });
        editor.setStyleVars({ ...STYLE_VARS, "editorCursor.foreground": CARET_BG });
        editor.viewState.selections = [createCursorSelection(0, 5), createCursorSelection(0, 7)];
        editor.focus();
        app.render();

        const gutterW = editor.gutterWidth;
        // Hardware cursor (primary cursor) is at column 5, left of the ghost text.
        expect(editor.getCaretScreenCell()).toEqual(new Point(gutterW + 5, 0));
        // The secondary cursor was at the end of the line and moved with the tail
        // (offset 7 → column 7 + 3 ghost columns).
        expect(app.backend.getBgAt(new Point(gutterW + 10, 0))).toBe(CARET_BG);
    });

    it("волна диагностики на хвосте уезжает вместе с хвостом", () => {
        const { app, editor } = createEditor("call();", { line: 0, character: 5, lines: ["arg"] });
        editor.occurrenceHighlightEnabled = false;
        editor.setStyleVars({ ...STYLE_VARS, "editorWarning.foreground": WARNING_FG });
        // Diagnostic on the tail ");": document columns 5..7.
        editor.markerDecorations = [{ range: createRange(0, 5, 0, 7), severity: MarkerSeverity.Warning }];
        app.render();

        const gutterW = editor.gutterWidth;
        expect(app.backend.getFgAt(new Point(gutterW + 8, 0))).toBe(WARNING_FG);
        expect(app.backend.getFgAt(new Point(gutterW + 9, 0))).toBe(WARNING_FG);
        expect(app.backend.getFgAt(new Point(gutterW + 4, 0))).toBe(EDITOR_FG);
    });

    it("клик по хвосту даёт его документную позицию, клик по фантому — точку вставки", () => {
        const { editor } = createEditor("call();", { line: 0, character: 5, lines: ["arg"] });

        const gutterW = editor.gutterWidth;
        // ")" is drawn at column 8, but in the document it is offset 5.
        expect(editor.docPositionAt(gutterW + 8, 0)).toEqual({ line: 0, character: 5 });
        expect(editor.docPositionAt(gutterW + 9, 0)).toEqual({ line: 0, character: 6 });
        // Ghost text columns do not map into the document: they return the insertion point.
        expect(editor.docPositionAt(gutterW + 6, 0)).toEqual({ line: 0, character: 5 });
        expect(editor.docPositionAt(gutterW + 2, 0)).toEqual({ line: 0, character: 2 });
    });
});

describe("EditorElement — подсветка токенов вокруг фантома", () => {
    function createTokenizedEditor(text: string, ghost: IGhostText): { app: TestApp; editor: EditorElement } {
        const doc = new TextDocument(text);
        const viewState = new EditorViewState(doc);
        viewState.tokenStore = new DocumentTokenStore(doc, new WordTokenizer());
        const editor = new EditorElement(viewState);
        editor.setStyleVars(STYLE_VARS);
        editor.style = { fg: "editor.foreground", bg: "editor.background" };
        editor.tokenStyleResolver = new ColorMapTokenStyleResolver({ getColorMap: () => COLOR_MAP });
        editor.setGhostText(ghost);
        const app = TestApp.createWithContent(editor, new Size(30, 3));
        app.render();
        return { app, editor };
    }

    it("токены хвоста красятся своими цветами, фантом — призрачным", () => {
        // Ghost text "zz " before a number: the composed line is "if zz 1".
        const { app, editor } = createTokenizedEditor("if 1", { line: 0, character: 3, lines: ["zz "] });

        const gutterW = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gutterW, 0), 7)).toBe("if zz 1");
        expect(app.backend.getFgAt(new Point(gutterW, 0))).toBe(KEYWORD_FG);
        expect(app.backend.getFgAt(new Point(gutterW + 3, 0))).toBe(GHOST_FG);
        // The number moved to column 6 and TOOK its token with it.
        expect(app.backend.getFgAt(new Point(gutterW + 6, 0))).toBe(NUMBER_FG);
    });

    it("токены ЛЕВЕЕ фантома ищутся по своим offset'ам, а не по сдвинутым", () => {
        // Ghost text at the end of the line: all real text is left of it. If the
        // shift were applied to it too, the number at column 3 would get the "if" token.
        const { app, editor } = createTokenizedEditor("if 1", { line: 0, character: 4, lines: ["zz"] });

        const gutterW = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gutterW, 0), 6)).toBe("if 1zz");
        expect(app.backend.getFgAt(new Point(gutterW, 0))).toBe(KEYWORD_FG);
        expect(app.backend.getFgAt(new Point(gutterW + 3, 0))).toBe(NUMBER_FG);
        expect(app.backend.getFgAt(new Point(gutterW + 4, 0))).toBe(GHOST_FG);
    });
});
