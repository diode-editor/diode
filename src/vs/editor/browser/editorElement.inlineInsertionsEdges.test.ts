import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import { createRange } from "../common/core/iRange.ts";
import { createCursorSelection, createSelection } from "../common/core/iSelection.ts";
import type { IInlineInsertion } from "../common/model/iInlineInsertion.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";
import { createFoldingRegion } from "../contrib/folding/iFoldingRegion.ts";

import { EditorElement } from "./editorElement.ts";

/** Edges of inline insertions: tabs, scroll, edits after the set, folds, odd texts. */

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

describe("EditorElement — inline insertions next to tabs", () => {
    it("the caret, a click and the drawn text agree on a line with a tab after an insertion", () => {
        const { app, editor, gutterW } = createEditor("a\tb", [{ line: 0, offset: 1, text: "XY" }]);
        editor.focus();
        const row = app.backend.getTextAt(new Point(gutterW, 0), 10);
        const bColumn = row.indexOf("b");
        expect(row.startsWith("aXY")).toBe(true);

        // Caret right of the tab (document offset 2) is drawn on the "b" cell.
        editor.viewState.selections = [createCursorSelection(0, 2)];
        app.render();
        expect(editor.getCaretScreenCell()).toEqual(new Point(gutterW + bColumn, 0));
        // A click on "b" gives offset 2.
        expect(editor.docPositionAt(gutterW + bColumn, 0)).toEqual({ line: 0, character: 2 });
    });
});

describe("EditorElement — selection across an insertion", () => {
    it("a selection around an insertion highlights the text on both sides", () => {
        const { app, editor, gutterW } = createEditor("abcdef", [{ line: 0, offset: 3, text: "XY" }]);

        editor.viewState.selections = [createSelection(0, 2, 0, 4)];
        app.render();
        // "abcXYdef": c at 2, d at 5.
        expect(app.backend.getBgAt(new Point(gutterW + 1, 0))).toBe(BG);
        expect(app.backend.getBgAt(new Point(gutterW + 2, 0))).toBe(SELECTION_BG);
        expect(app.backend.getBgAt(new Point(gutterW + 5, 0))).toBe(SELECTION_BG);
        expect(app.backend.getBgAt(new Point(gutterW + 6, 0))).toBe(BG);
        expect(editor.viewState.getSelectedText()).toBe("cd");
    });
});

describe("EditorElement — horizontal scroll over insertions", () => {
    it("with the line scrolled into an insertion, the visible part of the insertion and the tail are in place", () => {
        const { app, editor, gutterW } = createEditor("abcdef", [{ line: 0, offset: 2, text: "XYZ" }]);
        editor.viewState.scrollLeft = 3;
        app.render();

        // "abXYZcdef" from column 3.
        expect(app.backend.getTextAt(new Point(gutterW, 0), 7)).toBe("YZcdef ");
        expect(editor.docPositionAt(gutterW + 2, 0)).toEqual({ line: 0, character: 2 });
        expect(editor.docPositionAt(gutterW, 0)).toEqual({ line: 0, character: 2 });
    });

    it("a wide insertion cut by the left edge leaves a blank, not half a glyph, and the tail is in place", () => {
        const { app, editor, gutterW } = createEditor("abcd", [{ line: 0, offset: 1, text: "漢" }]);
        editor.viewState.scrollLeft = 2;
        app.render();

        // "a漢bcd": 漢 at 1–2; from column 2 its continuation cell.
        expect(app.backend.getTextAt(new Point(gutterW, 0), 4)).toBe(" bcd");
    });
});

describe("EditorElement — the set outlives document edits", () => {
    it("an insertion line deleted after the set does not break the frame", () => {
        const { app, editor, gutterW } = createEditor("one\ntwo\nthree", [{ line: 2, offset: 3, text: "#" }]);

        editor.viewState.document.applyEdits([{ range: createRange(0, 3, 2, 5), text: "" }]);
        app.render();

        expect(app.backend.getTextAt(new Point(gutterW, 0), 5)).toBe("one  ");
    });

    it("a line shortened under an insertion keeps it at the line end", () => {
        const { app, editor, gutterW } = createEditor("abcdef", [{ line: 0, offset: 5, text: "#" }]);

        editor.viewState.document.applyEdits([{ range: createRange(0, 2, 0, 6), text: "" }]);
        app.render();

        expect(app.backend.getTextAt(new Point(gutterW, 0), 4)).toBe("ab# ");
    });

    it("typing at an insertion point writes into the document, the insertion stays out of it", () => {
        const { app, editor } = createEditor("abcd", [{ line: 0, offset: 2, text: "XY" }]);
        editor.focus();
        editor.viewState.selections = [createCursorSelection(0, 2)];
        editor.viewState.type("Q");
        app.render();

        expect(editor.viewState.document.getText()).toBe("abQcd");
    });
});

describe("EditorElement — odd insertions", () => {
    it("an empty insertion changes nothing on screen", () => {
        const { app, editor, gutterW } = createEditor("abcd", [{ line: 0, offset: 2, text: "" }]);
        expect(app.backend.getTextAt(new Point(gutterW, 0), 5)).toBe("abcd ");
        editor.focus();
        editor.viewState.selections = [createCursorSelection(0, 3)];
        app.render();
        expect(editor.getCaretScreenCell()).toEqual(new Point(gutterW + 3, 0));
        expect(editor.docPositionAt(gutterW + 2, 0)).toEqual({ line: 0, character: 2 });
    });

    it("a negative offset goes to the line start, the frame survives", () => {
        const { app, gutterW } = createEditor("abcd", [{ line: 0, offset: -3, text: "#" }]);
        expect(app.backend.getTextAt(new Point(gutterW, 0), 6)).toBe("#abcd ");
    });

    it("an emoji insertion is two cells wide and the tail follows", () => {
        const { app, editor, gutterW } = createEditor("ab", [{ line: 0, offset: 1, text: "🟥" }]);
        editor.focus();
        editor.viewState.selections = [createCursorSelection(0, 2)];
        app.render();
        expect(app.backend.getTextAt(new Point(gutterW + 3, 0), 1)).toBe("b");
        expect(editor.getCaretScreenCell()).toEqual(new Point(gutterW + 4, 0));
    });
});

describe("EditorElement — caret moves around insertions", () => {
    it("End on a line ending with an insertion stands left of it, Home at the start before a leading one", () => {
        const { app, editor, gutterW } = createEditor("abc", [
            { line: 0, offset: 0, text: "<<" },
            { line: 0, offset: 3, text: ">>" },
        ]);
        editor.focus();
        editor.viewState.selections = [createCursorSelection(0, 1)];
        editor.viewState.cursorEnd();
        app.render();
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 3 });
        expect(editor.getCaretScreenCell()).toEqual(new Point(gutterW + 5, 0));

        editor.viewState.cursorHome();
        app.render();
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 0 });
        expect(editor.getCaretScreenCell()).toEqual(new Point(gutterW, 0));
    });

    it("Shift+Right from an insertion point selects the next character, not the insertion", () => {
        const { app, editor, gutterW } = createEditor("abcd", [{ line: 0, offset: 2, text: "XY" }]);
        editor.focus();
        editor.viewState.selections = [createCursorSelection(0, 2)];
        editor.viewState.cursorRight(true);
        app.render();

        expect(editor.viewState.getSelectedText()).toBe("c");
        // "abXYcd"
        expect(app.backend.getBgAt(new Point(gutterW + 2, 0))).toBe(BG);
        expect(app.backend.getBgAt(new Point(gutterW + 3, 0))).toBe(BG);
        expect(app.backend.getBgAt(new Point(gutterW + 4, 0))).toBe(SELECTION_BG);
    });

    it("a click past the end of a line with a trailing insertion puts the caret at the line end", () => {
        const { editor, gutterW } = createEditor("abc\nxyz", [{ line: 0, offset: 3, text: "----" }]);
        expect(editor.docPositionAt(gutterW + 15, 0)).toEqual({ line: 0, character: 3 });
        expect(editor.docPositionAt(gutterW + 15, 1)).toEqual({ line: 1, character: 3 });
    });
});

describe("EditorElement — an insertion at the line start", () => {
    it("the caret after it is drawn right of the insertion", () => {
        const { app, editor, gutterW } = createEditor("abc", [{ line: 0, offset: 0, text: "<<" }]);
        editor.focus();
        editor.viewState.selections = [createCursorSelection(0, 3)];
        app.render();

        // "<<abc": the line end is column 5.
        expect(editor.getCaretScreenCell()).toEqual(new Point(gutterW + 5, 0));
    });

    it("a selection lands on the shifted text", () => {
        const { app, editor, gutterW } = createEditor("abcdef", [{ line: 0, offset: 0, text: "<<" }]);
        editor.viewState.selections = [createSelection(0, 1, 0, 3)];
        app.render();

        // "<<abcdef": b and c are columns 3 and 4.
        expect(app.backend.getBgAt(new Point(gutterW + 1, 0))).toBe(BG);
        expect(app.backend.getBgAt(new Point(gutterW + 2, 0))).toBe(BG);
        expect(app.backend.getBgAt(new Point(gutterW + 3, 0))).toBe(SELECTION_BG);
        expect(app.backend.getBgAt(new Point(gutterW + 4, 0))).toBe(SELECTION_BG);
        expect(app.backend.getBgAt(new Point(gutterW + 5, 0))).toBe(BG);
    });

    it("a click on its cells gives the line start, on the text the document position", () => {
        const { editor, gutterW } = createEditor("abcdef", [{ line: 0, offset: 0, text: "<<" }]);

        expect(editor.docPositionAt(gutterW, 0)).toEqual({ line: 0, character: 0 });
        expect(editor.docPositionAt(gutterW + 1, 0)).toEqual({ line: 0, character: 0 });
        expect(editor.docPositionAt(gutterW + 2, 0)).toEqual({ line: 0, character: 0 });
        expect(editor.docPositionAt(gutterW + 3, 0)).toEqual({ line: 0, character: 1 });
    });
});

describe("EditorElement — insertions and folding", () => {
    it("an insertion on a folded-away line is not drawn, one on the fold header line is", () => {
        const { app, editor, gutterW } = createEditor("head\n  body\ntail", [
            { line: 0, offset: 4, text: "!" },
            { line: 1, offset: 2, text: "#" },
        ]);
        editor.viewState.setFoldingRegions([createFoldingRegion(0, 1, true)]);
        app.render();

        expect(app.backend.getTextAt(new Point(gutterW, 0), 5)).toBe("head!");
        expect(app.backend.getTextAt(new Point(gutterW, 1), 5)).toBe("tail ");
    });
});
