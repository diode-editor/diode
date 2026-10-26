import { packRgb } from "@tuidom/core/common/colorUtils";
import { BoxConstraints, Offset, Point, Rect, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { extendVarScope, ROOT_STYLE_CONTEXT } from "@tuidom/core/dom/styles/tuiStyle";
import { RenderContext } from "@tuidom/core/dom/tuiElement";
import { TerminalScreen } from "@tuidom/core/rendering/terminalScreen";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import { MarkerSeverity } from "../../platform/markers/common/iMarker.ts";
import { createRange } from "../common/core/iRange.ts";
import { createCursorSelection, createSelection } from "../common/core/iSelection.ts";
import { WordTokenColor, WordTokenizer } from "../common/languages/builtin/wordTokenizer.ts";
import { ColorMapTokenStyleResolver } from "../common/languages/colorMapTokenStyleResolver.ts";
import type { IInlineInsertion } from "../common/model/iInlineInsertion.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { DocumentTokenStore } from "../common/tokens/documentTokenStore.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

/** Insertions of an outside owner (the future color decorators) next to and together with ghost text. */

const EDITOR_FG = packRgb(0xd4, 0xd4, 0xd4);
const BG = packRgb(0x1e, 0x1e, 0x1e);
const GHOST_FG = packRgb(0x6a, 0x6a, 0x6a);
const RED = packRgb(0xff, 0x00, 0x00);
const BLUE = packRgb(0x00, 0x00, 0xff);
const TOKEN_FG = packRgb(0x11, 0x22, 0x33);
const SELECTION_BG = packRgb(0x26, 0x4f, 0x78);
const WARNING_FG = packRgb(0xcc, 0xa7, 0x00);
const CARET_BG = packRgb(0xae, 0xaf, 0xad);
const NUMBER_FG = packRgb(0x00, 0xff, 0x00);
// editorElement.ts FIND_MATCH_BG.
const FIND_MATCH_BG = packRgb(98, 91, 23);

const STYLE_VARS = {
    "editor.background": BG,
    "editor.foreground": EDITOR_FG,
    "editor.selectionBackground": SELECTION_BG,
    "editorGhostText.foreground": GHOST_FG,
    "editorWarning.foreground": WARNING_FG,
    "editorCursor.foreground": CARET_BG,
    "test.insertion": TOKEN_FG,
};

function createEditor(
    text: string,
    insertions: readonly IInlineInsertion[],
    size = new Size(30, 4),
): { app: TestApp; editor: EditorElement; gutterW: number } {
    const viewState = new EditorViewState(new TextDocument(text));
    const editor = new EditorElement(viewState);
    editor.occurrenceHighlightEnabled = false;
    editor.setStyleVars(STYLE_VARS);
    editor.style = { fg: "editor.foreground", bg: "editor.background" };
    editor.setInlineInsertions(insertions);
    const app = TestApp.createWithContent(editor, size);
    app.render();
    return { app, editor, gutterW: editor.gutterWidth };
}

function fireMouse(editor: EditorElement, type: "mousedown" | "mousemove", localX: number, localY: number): void {
    editor.dispatchEvent(new TUIMouseEvent(type, { button: "left", screenX: localX, screenY: localY, localX, localY }));
}

describe("EditorElement — inline insertions", () => {
    it("several insertions in one line: the tail shifts by their total width, each in its own color", () => {
        const { app, editor, gutterW } = createEditor("ab cd ef", [
            { line: 0, offset: 3, text: "[R]", fg: RED },
            { line: 0, offset: 6, text: "<T>", colorToken: "test.insertion" },
            { line: 0, offset: 3, text: "{B}", fg: BLUE },
            { line: 0, offset: 0, text: "^" },
            { line: 0, offset: 8, text: "$", fg: RED },
        ]);

        expect(app.backend.getTextAt(new Point(gutterW, 0), 22)).toBe("^ab [R]{B}cd <T>ef$   ");
        // No color given: the editor text color.
        expect(app.backend.getFgAt(new Point(gutterW, 0))).toBe(EDITOR_FG);
        expect(app.backend.getFgAt(new Point(gutterW + 1, 0))).toBe(EDITOR_FG);
        // Two insertions at one offset, in the order given.
        expect(app.backend.getFgAt(new Point(gutterW + 4, 0))).toBe(RED);
        expect(app.backend.getFgAt(new Point(gutterW + 6, 0))).toBe(RED);
        expect(app.backend.getFgAt(new Point(gutterW + 7, 0))).toBe(BLUE);
        expect(app.backend.getFgAt(new Point(gutterW + 9, 0))).toBe(BLUE);
        expect(app.backend.getFgAt(new Point(gutterW + 10, 0))).toBe(EDITOR_FG);
        // A theme token resolved on the frame.
        expect(app.backend.getFgAt(new Point(gutterW + 13, 0))).toBe(TOKEN_FG);
        expect(app.backend.getFgAt(new Point(gutterW + 15, 0))).toBe(TOKEN_FG);
        expect(app.backend.getFgAt(new Point(gutterW + 16, 0))).toBe(EDITOR_FG);
        expect(app.backend.getFgAt(new Point(gutterW + 18, 0))).toBe(RED);
        // Not in the buffer.
        expect(editor.viewState.document.getText()).toBe("ab cd ef");
    });

    it("insertions on many lines shift each line's own tail", () => {
        const { app, gutterW } = createEditor("one\ntwo\nthree", [
            { line: 0, offset: 1, text: "--" },
            { line: 2, offset: 0, text: "#" },
            { line: 2, offset: 5, text: "!" },
        ]);

        expect(app.backend.getTextAt(new Point(gutterW, 0), 8)).toBe("o--ne   ");
        expect(app.backend.getTextAt(new Point(gutterW, 1), 8)).toBe("two     ");
        expect(app.backend.getTextAt(new Point(gutterW, 2), 8)).toBe("#three! ");
    });

    it("replacing and clearing the set redraws the lines", () => {
        const { app, editor, gutterW } = createEditor("abc", [{ line: 0, offset: 1, text: "X" }]);

        editor.setInlineInsertions([{ line: 0, offset: 2, text: "YY" }]);
        app.render();
        expect(editor.inlineInsertions).toEqual([{ line: 0, offset: 2, text: "YY" }]);
        expect(app.backend.getTextAt(new Point(gutterW, 0), 6)).toBe("abYYc ");

        editor.setInlineInsertions([]);
        app.render();
        expect(app.backend.getTextAt(new Point(gutterW, 0), 6)).toBe("abc   ");
    });

    it("an insertion is as wide as its text on screen (wide characters)", () => {
        const { app, gutterW } = createEditor("ab", [{ line: 0, offset: 1, text: "日" }]);

        expect(app.backend.getTextAt(new Point(gutterW, 0), 1)).toBe("a");
        expect(app.backend.getTextAt(new Point(gutterW + 3, 0), 1)).toBe("b");
    });

    it("a stale insertion past the line end goes to the end, one on a missing line is dropped", () => {
        const { app, editor, gutterW } = createEditor("abcdef\nxyz", [
            { line: 0, offset: 4, text: "X" },
            { line: 1, offset: 3, text: "Y" },
        ]);

        editor.viewState.document.applyEdits([{ range: createRange(0, 2, 1, 3), text: "" }]);
        app.render();

        expect(editor.viewState.document.getText()).toBe("ab");
        expect(app.backend.getTextAt(new Point(gutterW, 0), 5)).toBe("abX  ");
        expect(app.backend.getTextAt(new Point(gutterW, 1), 3)).toBe("   ");
    });
});

describe("EditorElement — overlays on the composed line", () => {
    it("a selection on the tail lands on the tail, one ending at an insertion point leaves the insertion out", () => {
        const { app, editor, gutterW } = createEditor("abcdef", [{ line: 0, offset: 3, text: "XY" }]);

        editor.viewState.selections = [createSelection(0, 4, 0, 6)];
        app.render();
        // "abcXYdef": e and f are columns 6 and 7.
        expect(app.backend.getBgAt(new Point(gutterW + 5, 0))).toBe(BG);
        expect(app.backend.getBgAt(new Point(gutterW + 6, 0))).toBe(SELECTION_BG);
        expect(app.backend.getBgAt(new Point(gutterW + 7, 0))).toBe(SELECTION_BG);

        editor.viewState.selections = [createSelection(0, 1, 0, 3)];
        app.render();
        expect(app.backend.getBgAt(new Point(gutterW + 1, 0))).toBe(SELECTION_BG);
        expect(app.backend.getBgAt(new Point(gutterW + 2, 0))).toBe(SELECTION_BG);
        expect(app.backend.getBgAt(new Point(gutterW + 3, 0))).toBe(BG);
        expect(app.backend.getBgAt(new Point(gutterW + 5, 0))).toBe(BG);
    });

    it("a selection starting at an insertion point starts after the insertion", () => {
        const { app, editor, gutterW } = createEditor("abcdef", [{ line: 0, offset: 3, text: "XY" }]);

        editor.viewState.selections = [createSelection(0, 3, 0, 4)];
        app.render();

        expect(app.backend.getBgAt(new Point(gutterW + 4, 0))).toBe(BG);
        expect(app.backend.getBgAt(new Point(gutterW + 5, 0))).toBe(SELECTION_BG);
        expect(app.backend.getBgAt(new Point(gutterW + 6, 0))).toBe(BG);
    });

    it("find matches and a squiggle after two insertions move with the text", () => {
        const { app, editor, gutterW } = createEditor("a b foo bar", [
            { line: 0, offset: 1, text: "11" },
            { line: 0, offset: 3, text: "222" },
        ]);
        editor.viewState.searchMatches = [createRange(0, 4, 0, 7)];
        editor.viewState.currentSearchMatchIndex = -1;
        editor.markerDecorations = [{ range: createRange(0, 8, 0, 11), severity: MarkerSeverity.Warning }];
        app.render();

        // Composed: "a11 b222foo bar"; foo at 9..11, bar at 13..15 (offset + 5).
        expect(app.backend.getTextAt(new Point(gutterW, 0), 16)).toBe("a11 b222 foo bar");
        expect(app.backend.getBgAt(new Point(gutterW + 8, 0))).toBe(BG);
        expect(app.backend.getBgAt(new Point(gutterW + 9, 0))).toBe(FIND_MATCH_BG);
        expect(app.backend.getBgAt(new Point(gutterW + 11, 0))).toBe(FIND_MATCH_BG);
        expect(app.backend.getBgAt(new Point(gutterW + 12, 0))).toBe(BG);
        expect(app.backend.getFgAt(new Point(gutterW + 12, 0))).toBe(EDITOR_FG);
        expect(app.backend.getFgAt(new Point(gutterW + 13, 0))).toBe(WARNING_FG);
        expect(app.backend.getFgAt(new Point(gutterW + 15, 0))).toBe(WARNING_FG);
    });

    it("tokens of the tail keep their colors after several insertions", () => {
        const doc = new TextDocument("x 1 y 2");
        const viewState = new EditorViewState(doc);
        viewState.tokenStore = new DocumentTokenStore(doc, new WordTokenizer());
        const editor = new EditorElement(viewState);
        editor.occurrenceHighlightEnabled = false;
        editor.setStyleVars(STYLE_VARS);
        editor.style = { fg: "editor.foreground", bg: "editor.background" };
        const colorMap = ["", "#000000", "#000000"];
        colorMap[WordTokenColor.number] = "#00ff00";
        editor.tokenStyleResolver = new ColorMapTokenStyleResolver({ getColorMap: () => colorMap });
        editor.setInlineInsertions([
            { line: 0, offset: 2, text: "aa", fg: RED },
            { line: 0, offset: 6, text: "bbb", fg: RED },
        ]);
        const app = TestApp.createWithContent(editor, new Size(30, 2));
        app.render();

        const gutterW = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gutterW, 0), 12)).toBe("x aa1 y bbb2");
        expect(app.backend.getFgAt(new Point(gutterW + 2, 0))).toBe(RED);
        expect(app.backend.getFgAt(new Point(gutterW + 4, 0))).toBe(NUMBER_FG);
        expect(app.backend.getFgAt(new Point(gutterW + 6, 0))).toBe(EDITOR_FG);
        expect(app.backend.getFgAt(new Point(gutterW + 8, 0))).toBe(RED);
        expect(app.backend.getFgAt(new Point(gutterW + 11, 0))).toBe(NUMBER_FG);
    });

    it("an indent guide stands on the shifted indent of a line with an insertion", () => {
        const { app, editor, gutterW } = createEditor("if {\n    a\n  \n}", [
            { line: 1, offset: 0, text: "##" },
            { line: 2, offset: 1, text: "@" },
        ]);
        editor.setStyleVars({
            ...STYLE_VARS,
            "editorIndentGuide.background1": BLUE,
            "editorIndentGuide.activeBackground1": BLUE,
        });
        editor.viewState.setFoldingRegions([{ startLine: 0, endLine: 3, isCollapsed: false }]);
        app.render();

        // Header indent 0: the guide is the first whitespace cell of the body, after the insertion.
        expect(app.backend.getTextAt(new Point(gutterW, 1), 7)).toBe("##▏   a");
        expect(app.backend.getFgAt(new Point(gutterW + 2, 1))).toBe(BLUE);
        expect(app.backend.getFgAt(new Point(gutterW, 1))).toBe(EDITOR_FG);
        // A blank line carries the guide; its insertion at offset 1 is right of column 0.
        expect(app.backend.getTextAt(new Point(gutterW, 2), 3)).toBe("▏@ ");
    });

    it("an indent guide past column 0 moves only by the insertions left of it", () => {
        const { app, editor, gutterW } = createEditor("  if {\n      a\n  }", [{ line: 1, offset: 1, text: "@" }]);
        editor.viewState.setFoldingRegions([{ startLine: 0, endLine: 2, isCollapsed: false }]);
        app.render();

        // Header indent 2: the guide stands on document column 2, composed column 3.
        expect(app.backend.getTextAt(new Point(gutterW, 1), 8)).toBe(" @ ▏   a");
    });
});

describe("EditorElement — caret and mouse around insertions", () => {
    it("the caret at an insertion point is drawn left of it, one step right puts it right of the next character", () => {
        const { app, editor, gutterW } = createEditor("abcdef", [
            { line: 0, offset: 3, text: "XY" },
            { line: 0, offset: 3, text: "Z" },
        ]);
        editor.viewState.selections = [createCursorSelection(0, 3)];
        editor.focus();
        app.render();
        expect(editor.getCaretScreenCell()).toEqual(new Point(gutterW + 3, 0));

        editor.viewState.cursorRight();
        app.render();
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 4 });
        // "abcXYZdef": right of "d".
        expect(editor.getCaretScreenCell()).toEqual(new Point(gutterW + 7, 0));

        editor.viewState.cursorLeft();
        app.render();
        expect(editor.getCaretScreenCell()).toEqual(new Point(gutterW + 3, 0));
    });

    it("secondary carets after an insertion move with the tail", () => {
        const { app, editor, gutterW } = createEditor("abcdef", [{ line: 0, offset: 2, text: "XY" }]);
        editor.viewState.selections = [createCursorSelection(0, 0), createCursorSelection(0, 4)];
        editor.focus();
        app.render();

        expect(app.backend.getBgAt(new Point(gutterW + 6, 0))).toBe(CARET_BG);
        expect(app.backend.getBgAt(new Point(gutterW + 4, 0))).toBe(BG);
    });

    it("a click on an insertion's cells gives its insertion point, on the tail the document position", () => {
        const { editor, gutterW } = createEditor("abcdef", [
            { line: 0, offset: 1, text: "X" },
            { line: 0, offset: 3, text: "YYY" },
        ]);

        // "aXbcYYYdef"
        expect(editor.docPositionAt(gutterW + 1, 0)).toEqual({ line: 0, character: 1 });
        expect(editor.docPositionAt(gutterW + 2, 0)).toEqual({ line: 0, character: 1 });
        expect(editor.docPositionAt(gutterW + 3, 0)).toEqual({ line: 0, character: 2 });
        expect(editor.docPositionAt(gutterW + 5, 0)).toEqual({ line: 0, character: 3 });
        expect(editor.docPositionAt(gutterW + 6, 0)).toEqual({ line: 0, character: 3 });
        expect(editor.docPositionAt(gutterW + 7, 0)).toEqual({ line: 0, character: 3 });
        expect(editor.docPositionAt(gutterW + 8, 0)).toEqual({ line: 0, character: 4 });
        expect(editor.docPositionAt(gutterW + 20, 0)).toEqual({ line: 0, character: 6 });
    });

    it("dragging over an insertion selects document text only", () => {
        const { editor, gutterW } = createEditor("abcdef", [{ line: 0, offset: 3, text: "YYY" }]);

        fireMouse(editor, "mousedown", gutterW + 1, 0);
        fireMouse(editor, "mousemove", gutterW + 5, 0);
        expect(editor.viewState.selections[0]).toEqual(createSelection(0, 1, 0, 3));

        fireMouse(editor, "mousemove", gutterW + 7, 0);
        expect(editor.viewState.getSelectedText()).toBe("bcd");
    });
});

describe("EditorElement — insertions together with ghost text", () => {
    it("both are drawn on one line; at one offset the suggestion comes first, next to the caret", () => {
        const { app, editor, gutterW } = createEditor("call(#fff);", [
            { line: 0, offset: 5, text: "■", fg: RED },
            { line: 0, offset: 10, text: "!", fg: BLUE },
        ]);
        editor.setGhostText({ line: 0, character: 5, lines: ["x, "] });
        editor.viewState.selections = [createCursorSelection(0, 5)];
        editor.focus();
        app.render();

        expect(app.backend.getTextAt(new Point(gutterW, 0), 16)).toBe("call(x, ■#fff)!;");
        expect(app.backend.getFgAt(new Point(gutterW + 5, 0))).toBe(GHOST_FG);
        expect(app.backend.getFgAt(new Point(gutterW + 8, 0))).toBe(RED);
        expect(app.backend.getFgAt(new Point(gutterW + 9, 0))).toBe(EDITOR_FG);
        expect(app.backend.getFgAt(new Point(gutterW + 14, 0))).toBe(BLUE);
        expect(editor.getCaretScreenCell()).toEqual(new Point(gutterW + 5, 0));

        // Clearing the suggestion keeps the owner's insertions.
        editor.setGhostText(null);
        app.render();
        expect(app.backend.getTextAt(new Point(gutterW, 0), 14)).toBe("call(■#fff)!; ");
    });
});

describe("EditorElement — horizontal scroll over insertions", () => {
    it("the content width counts the insertions, so the tail can be scrolled to", () => {
        const { editor } = createEditor("short\n0123456789", [{ line: 0, offset: 5, text: "-".repeat(20) }]);

        expect(editor.contentWidth).toBe(25);
        editor.setInlineInsertions([]);
        expect(editor.contentWidth).toBe(10);
    });

    it("the cursor reveal counts the insertions left of the caret", () => {
        const { app, editor, gutterW } = createEditor(
            "abcdefgh",
            [{ line: 0, offset: 2, text: "-".repeat(30) }],
            new Size(gutterW0() + 20, 3),
        );
        editor.focus();

        editor.viewState.selections = [createCursorSelection(0, 3)];
        editor.viewState.cursorRight();
        app.render();

        // The caret is at composed column 34: on screen, not clipped.
        expect(editor.viewState.scrollLeft).toBe(34 - 20 + 1);
        expect(editor.getCaretScreenCell()).toEqual(new Point(gutterW + 19, 0));
    });

    it("under word wrap the frame survives insertions that do not fit", () => {
        const { app, editor, gutterW } = createEditor("abcdefghij klmnop", [{ line: 0, offset: 4, text: "XXXX" }]);
        editor.viewState.wordWrap = "on";
        app.render();

        expect(app.backend.getTextAt(new Point(gutterW, 0), 4)).toBe("abcd");
        expect(editor.contentWidth).toBe(editor.viewState.viewportWidth);
    });
});

describe("EditorElement — insertion style", () => {
    it("an italic insertion is italic, the tail and a plain insertion are not", () => {
        const viewState = new EditorViewState(new TextDocument("ab"));
        const editor = new EditorElement(viewState);
        editor.setInlineInsertions([
            { line: 0, offset: 1, text: "I", italic: true },
            { line: 0, offset: 1, text: "P" },
        ]);
        const size = new Size(20, 2);
        const screen = new TerminalScreen(size);
        editor.localPosition = new Offset(0, 0);
        editor.layout(BoxConstraints.tight(size));
        editor.performStyleResolution({
            ...ROOT_STYLE_CONTEXT,
            vars: extendVarScope(ROOT_STYLE_CONTEXT.vars, STYLE_VARS),
        });
        editor.render(new RenderContext(screen, new Offset(0, 0), new Rect(new Point(0, 0), size)));

        const cell = (col: number) => screen.getCell(new Point(editor.gutterWidth + col, 0));
        expect([0, 1, 2, 3].map((col) => cell(col).char).join("")).toBe("aIPb");
        expect(cell(1).style & StyleFlags.Italic).toBe(StyleFlags.Italic);
        expect(cell(2).style & StyleFlags.Italic).toBe(0);
        expect(cell(3).style & StyleFlags.Italic).toBe(0);
    });

    it("ghost text is an italic insertion, the owner's plain one next to it is not", () => {
        const viewState = new EditorViewState(new TextDocument("ab"));
        const editor = new EditorElement(viewState);
        editor.setInlineInsertions([{ line: 0, offset: 1, text: "P" }]);
        editor.setGhostText({ line: 0, character: 1, lines: ["G"] });
        const size = new Size(20, 2);
        const screen = new TerminalScreen(size);
        editor.localPosition = new Offset(0, 0);
        editor.layout(BoxConstraints.tight(size));
        editor.performStyleResolution({
            ...ROOT_STYLE_CONTEXT,
            vars: extendVarScope(ROOT_STYLE_CONTEXT.vars, STYLE_VARS),
        });
        editor.render(new RenderContext(screen, new Offset(0, 0), new Rect(new Point(0, 0), size)));

        const cell = (col: number) => screen.getCell(new Point(editor.gutterWidth + col, 0));
        expect([0, 1, 2, 3].map((col) => cell(col).char).join("")).toBe("aGPb");
        expect(cell(1).style & StyleFlags.Italic).toBe(StyleFlags.Italic);
        expect(cell(2).style & StyleFlags.Italic).toBe(0);
    });
});

/** Gutter width of a one-line document. */
function gutterW0(): number {
    return new EditorElement(new EditorViewState(new TextDocument(""))).gutterWidth;
}
