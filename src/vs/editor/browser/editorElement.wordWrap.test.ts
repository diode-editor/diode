import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import { createCursorSelection, createSelection } from "../common/core/iSelection.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";
import { LONG_LINE_TRUNCATION_BADGE, STOP_RENDERING_LINE_AFTER } from "../common/viewModel/longLineRendering.ts";

import { EditorElement } from "./editorElement.ts";

/** Dark+ `editor.selectionBackground`; the TestApp palette puts it into the var scope. */
const SELECTION_BG = packRgb(38, 79, 120);
const BADGE_LABEL = LONG_LINE_TRUNCATION_BADGE.trim();

function createEditor(
    text: string,
    width = 16,
    height = 4,
): { app: TestApp; editor: EditorElement; vs: EditorViewState } {
    const doc = new TextDocument(text);
    const vs = new EditorViewState(doc);
    vs.wordWrap = "on";
    const editor = new EditorElement(vs);
    const app = TestApp.createWithContent(editor, new Size(width, height));
    return { app, editor, vs };
}

describe("EditorElement word wrap — fragment rendering", () => {
    it("a long line unfolds into several screen rows", () => {
        const { app, editor } = createEditor("aaaa bbbb cccc\nshort");
        app.render();
        const gw = editor.gutterWidth; // contentCols = 16 - 6 = 10
        expect(app.backend.getTextAt(new Point(gw, 0), 10)).toBe("aaaa bbbb ");
        expect(app.backend.getTextAt(new Point(gw, 1), 10)).toBe("cccc      ");
        expect(app.backend.getTextAt(new Point(gw, 2), 10)).toBe("short     ");
    });

    it("performLayout writes the text area width into view state before render", () => {
        const { app, editor, vs } = createEditor("aaaa bbbb cccc");
        app.render();
        expect(vs.viewportWidth).toBe(16 - editor.gutterWidth);
        expect(vs.viewportHeight).toBe(4);
    });

    it("a continuation row does not repeat the line number, the next line continues numbering", () => {
        const { app, editor } = createEditor("aaaa bbbb cccc\nshort");
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(0, 0), gw)).toContain("1");
        expect(app.backend.getTextAt(new Point(0, 1), gw).trim()).toBe("");
        expect(app.backend.getTextAt(new Point(0, 2), gw)).toContain("2");
    });

    it("the fragment tail after the wrap point is background, not the next fragment's text", () => {
        // Wrap at a word boundary at column 8: the row is shorter than contentCols.
        const { app, editor } = createEditor("aaaaaaa bbbbbb");
        // A background of its own, distinct from the body's base: a skipped tail fill
        // would be indistinguishable by glyphs (the base already clears the frame with spaces).
        const editorBg = packRgb(12, 34, 56);
        editor.style = { bg: editorBg };
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gw, 0), 10)).toBe("aaaaaaa   ");
        expect(app.backend.getTextAt(new Point(gw, 1), 10)).toBe("bbbbbb    ");
        expect(app.backend.getBgAt(new Point(gw + 8, 0))).toBe(editorBg);
        expect(app.backend.getBgAt(new Point(gw + 9, 0))).toBe(editorBg);
    });

    it("a selection crossing the wrap highlights both fragments in their own columns", () => {
        const { app, editor, vs } = createEditor("aaaa bbbb cccc");
        vs.selections = [createSelection(0, 2, 0, 12)];
        app.render();
        const gw = editor.gutterWidth;
        // Row 0: offsets 2..9 → columns 2..9.
        expect(app.backend.getBgAt(new Point(gw + 2, 0))).toBe(SELECTION_BG);
        expect(app.backend.getBgAt(new Point(gw + 9, 0))).toBe(SELECTION_BG);
        expect(app.backend.getBgAt(new Point(gw + 1, 0))).not.toBe(SELECTION_BG);
        // Row 1: offsets 10..11 → fragment columns 0..1.
        expect(app.backend.getBgAt(new Point(gw, 1))).toBe(SELECTION_BG);
        expect(app.backend.getBgAt(new Point(gw + 1, 1))).toBe(SELECTION_BG);
        expect(app.backend.getBgAt(new Point(gw + 2, 1))).not.toBe(SELECTION_BG);
    });

    it("a selection to the line end fills neither the fragment tail nor the virtual newline cell", () => {
        const { app, editor, vs } = createEditor("aaaaaaa bbbbbb\nzz"); // fragments of 8 and 6 columns
        vs.selections = [createSelection(0, 0, 0, 14)];
        app.render();
        const gw = editor.gutterWidth;
        // Row 0: the highlight ends at the fragment boundary (col. 7), the tail is clean.
        expect(app.backend.getBgAt(new Point(gw + 7, 0))).toBe(SELECTION_BG);
        expect(app.backend.getBgAt(new Point(gw + 8, 0))).not.toBe(SELECTION_BG);
        // Row 1: text is filled, the virtual line-break cell (col. 6) is not:
        // the selection ends exactly at end of line without covering the line break.
        expect(app.backend.getBgAt(new Point(gw + 5, 1))).toBe(SELECTION_BG);
        expect(app.backend.getBgAt(new Point(gw + 6, 1))).not.toBe(SELECTION_BG);
    });

    it("a multi-line selection fills the virtual newline cell on the LAST fragment", () => {
        const { app, editor, vs } = createEditor("aaaaaaa bbbbbb\nzz");
        vs.selections = [createSelection(0, 2, 1, 1)];
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getBgAt(new Point(gw + 6, 1))).toBe(SELECTION_BG); // virtual line break
        expect(app.backend.getBgAt(new Point(gw, 2))).toBe(SELECTION_BG); // "z"
    });

    it("contentWidth under wrap equals the viewport width — nothing to scroll horizontally", () => {
        const { app, editor, vs } = createEditor("aaaa bbbb cccc");
        app.render();
        expect(editor.contentWidth).toBe(vs.viewportWidth);
        vs.wordWrap = "off";
        expect(editor.contentWidth).toBe(14);
    });

    it("the Long line trimmed badge sits exactly at the cut of a short last fragment", () => {
        // contentCols 34: 10000 % 34 = 4, so the last fragment is 4 columns.
        const { app, editor } = createEditor("x".repeat(STOP_RENDERING_LINE_AFTER + 500), 40, 4);
        const vs = editor.viewState;
        vs.scrollTop = vs.getViewLineCount() - 4;
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gw, 3), 4)).toBe("xxxx");
        expect(app.backend.getTextAt(new Point(gw + 4, 3), LONG_LINE_TRUNCATION_BADGE.length)).toBe(
            LONG_LINE_TRUNCATION_BADGE,
        );
        expect(app.backend.getTextAt(new Point(gw, 0), 34)).not.toContain(BADGE_LABEL);
        expect(app.backend.getTextAt(new Point(gw, 2), 34)).not.toContain(BADGE_LABEL);
    });

    it("the badge on a full-width last fragment is pushed into the visible area", () => {
        // contentCols 25: 10000 % 25 = 0, so the last fragment takes the full width;
        // without the clamp the badge would sit just past the edge.
        const { app, editor } = createEditor("x".repeat(STOP_RENDERING_LINE_AFTER + 500), 31, 4);
        const vs = editor.viewState;
        vs.scrollTop = vs.getViewLineCount() - 4;
        app.render();
        const gw = editor.gutterWidth;
        const contentCols = 31 - gw;
        const badgeCol = contentCols - LONG_LINE_TRUNCATION_BADGE.length;
        expect(app.backend.getTextAt(new Point(gw + badgeCol, 3), LONG_LINE_TRUNCATION_BADGE.length)).toBe(
            LONG_LINE_TRUNCATION_BADGE,
        );
        expect(app.backend.getTextAt(new Point(gw, 3), badgeCol)).toBe("x".repeat(badgeCol));
    });

    it("toggling wrap off and on repaints both fragment tails and the continuation gutter", () => {
        const doc = new TextDocument("aaaaaaa bbbbbb\nsecond");
        const vs = new EditorViewState(doc);
        const editor = new EditorElement(vs);
        const app = TestApp.createWithContent(editor, new Size(16, 4));
        app.render(); // no wrap: row0 = "aaaaaaa bb", gutter row1 carries "2"
        const gw = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gw, 0), 10)).toBe("aaaaaaa bb");
        expect(app.backend.getTextAt(new Point(0, 1), gw)).toContain("2");

        vs.wordWrap = "on";
        editor.markDirty();
        app.render();
        // The row 0 tail must be repainted with background (not leftover "bb"), and the
        // continuation gutter with spaces (not leftover "2").
        expect(app.backend.getTextAt(new Point(gw, 0), 10)).toBe("aaaaaaa   ");
        expect(app.backend.getTextAt(new Point(gw, 1), 10)).toBe("bbbbbb    ");
        expect(app.backend.getTextAt(new Point(0, 1), gw)).toBe(" ".repeat(gw));
    });

    it("an external gutter marker lives on the first fragment and is not repeated on continuations", () => {
        const { app, editor, vs } = createEditor("aaaa bbbb cccc\nzz");
        editor.decorations = { gutterMarkers: [{ line: 0, char: "+" }] };
        editor.markDirty();
        app.render();
        const markerCol = 3; // GUTTER_LEFT_PADDING + digitCount
        expect(app.backend.getTextAt(new Point(markerCol, 0), 1)).toBe("+");
        expect(app.backend.getTextAt(new Point(markerCol, 1), 1)).toBe(" ");
        expect(vs.getViewLineCount()).toBe(3);
    });

    it("the indent guide is drawn on the first body fragment and does not overlap the continuation", () => {
        const { app, editor, vs } = createEditor("aaaa:\n    aaaa bbbb cc");
        vs.setFoldingRegions([{ startLine: 0, endLine: 1, isCollapsed: false }]);
        app.render();
        const gw = editor.gutterWidth;
        // Row 1 is the first fragment of the body: the guide is over the indent at the header column.
        expect(app.backend.getTextAt(new Point(gw, 1), 1)).toBe("▏");
        // Row 2 is a continuation from column 0: text, no guide over it.
        expect(app.backend.getTextAt(new Point(gw, 2), 1)).toBe("b");
    });
});

describe("EditorElement word wrap — performLayout and viewport width", () => {
    async function flushMicrotasks(): Promise<void> {
        await Promise.resolve();
        await Promise.resolve();
    }

    it("a width change requests another frame: the projection depends on width", async () => {
        const { app, editor, vs } = createEditor("aaaa bbbb cccc");
        app.render();
        await flushMicrotasks();
        app.render();
        await flushMicrotasks();
        expect(editor.isLayoutDirty).toBe(false);

        app.backend.resize(new Size(20, 4));
        app.render();
        expect(vs.viewportWidth).toBe(20 - editor.gutterWidth);
        await flushMicrotasks();
        expect(editor.isLayoutDirty).toBe(true);
    });

    it("a height change requests another frame too", async () => {
        const { app, editor } = createEditor("aaaa bbbb cccc");
        app.render();
        await flushMicrotasks();
        app.render();
        await flushMicrotasks();
        expect(editor.isLayoutDirty).toBe(false);

        app.backend.resize(new Size(16, 6));
        app.render();
        expect(editor.viewState.viewportHeight).toBe(6);
        await flushMicrotasks();
        expect(editor.isLayoutDirty).toBe(true);
    });

    it("layout with the same geometry requests no frame", async () => {
        const { app, editor } = createEditor("aaaa bbbb cccc");
        app.render();
        await flushMicrotasks();
        app.render(); // any follow-up frame request after the first layout is consumed
        await flushMicrotasks();
        app.render();
        await flushMicrotasks();
        expect(editor.isLayoutDirty).toBe(false);
    });
});

describe("EditorElement word wrap — folding", () => {
    it("the chevron and the ⋯ marker of a folded region live on the first and last header fragments", () => {
        const { app, editor, vs } = createEditor("aaaa bbbb cc\nhidden\ntail");
        vs.setFoldingRegions([{ startLine: 0, endLine: 1, isCollapsed: true }]);
        app.render();
        const gw = editor.gutterWidth;
        const foldCol = editor.foldControlColumn;
        expect(app.backend.getTextAt(new Point(foldCol, 0), 1)).toBe("");
        expect(app.backend.getTextAt(new Point(foldCol, 1), 1)).toBe(" ");
        expect(app.backend.getTextAt(new Point(gw, 1), 10)).toContain("⋯");
        expect(app.backend.getTextAt(new Point(gw, 0), 10)).not.toContain("⋯");
    });
});

function fireMouseDown(editor: EditorElement, localX: number, localY: number): void {
    editor.dispatchEvent(
        new TUIMouseEvent("mousedown", {
            button: "left",
            screenX: localX,
            screenY: localY,
            localX,
            localY,
        }),
    );
}

describe("EditorElement word wrap — mouse and cursors", () => {
    it("a click on a continuation row places the cursor inside the fragment", () => {
        const { editor } = createEditor("aaaa bbbb cccc");
        const gw = editor.gutterWidth;
        fireMouseDown(editor, gw + 2, 1);
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 12 });
    });

    it("a click past the end of a non-last fragment does not pull the cursor to the next row", () => {
        const { editor } = createEditor("aaaaaaa bbbbbb"); // fragment 1 is 8 columns
        const gw = editor.gutterWidth;
        fireMouseDown(editor, gw + 9, 0);
        // The fragment's last grapheme is the space (offset 7), not the boundary offset (8).
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 7 });
    });

    it("a click INSIDE a non-last fragment places the cursor at the clicked column, no clamp", () => {
        const { editor } = createEditor("aaaaaaa bbbbbb");
        const gw = editor.gutterWidth;
        fireMouseDown(editor, gw + 2, 0);
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 2 });
    });

    it("a click EXACTLY at the fragment boundary column stays on its row", () => {
        const { editor } = createEditor("aaaaaaa bbbbbb"); // fragment boundary is offset 8, column 8
        const gw = editor.gutterWidth;
        fireMouseDown(editor, gw + 8, 0);
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 7 });
    });

    it("a click on a zone row under wrap maps to the anchor line by click column", () => {
        const { editor, vs } = createEditor("aaaa bbbb cccc\nzz");
        vs.setViewZones([{ afterLine: 0, size: 1 }]);
        // Rows: 0-1 are line 0 fragments, 2 is the view zone, 3 is "zz".
        expect(editor.docPositionAt(editor.gutterWidth + 3, 2)).toEqual({ line: 0, character: 3 });
    });

    it("a click on the continuation gutter is column 0 of the ROW, i.e. the fragment start", () => {
        const { editor } = createEditor("aaaa bbbb cccc");
        fireMouseDown(editor, 0, 1);
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 10 });
    });

    it("a click far past the end of the LAST fragment gives the line end, no clamp", () => {
        const { editor } = createEditor("aaaaaaa bbbbbb"); // row 1 = "bbbbbb", end of line 14
        const gw = editor.gutterWidth;
        fireMouseDown(editor, gw + 9, 1);
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 14 });
    });

    it("the hardware cursor under horizontal scroll (wrap off) accounts for scrollLeft", () => {
        const { app, editor, vs } = createEditor("aaaa bbbb cccc");
        vs.wordWrap = "off";
        vs.selections = [createCursorSelection(0, 10)];
        vs.scrollLeft = 4;
        editor.focus();
        app.render();
        const gw = editor.gutterWidth;
        expect(editor.getCaretScreenCell()).toEqual(new Point(gw + 10 - 4, 0));
    });

    it("the hardware cursor on a continuation lands on its row and fragment column", () => {
        const { app, editor, vs } = createEditor("aaaa bbbb cccc");
        vs.selections = [createCursorSelection(0, 12)];
        editor.focus();
        app.render();
        const gw = editor.gutterWidth;
        const cell = editor.getCaretScreenCell();
        expect(cell).toEqual(new Point(gw + 2, 1));
    });

    it("multiple cursors on fragments of one line are each drawn on their own row", () => {
        const { app, editor, vs } = createEditor("aaaa bbbb cccc");
        vs.selections = [createCursorSelection(0, 2), createCursorSelection(0, 12)];
        editor.focus();
        app.render();
        const gw = editor.gutterWidth;
        const caretBg = packRgb(0xae, 0xaf, 0xad); // editorCursor.foreground
        expect(app.backend.getBgAt(new Point(gw + 2, 0))).toBe(caretBg);
        expect(app.backend.getBgAt(new Point(gw + 2, 1))).toBe(caretBg);
    });

    it("a cursor on a line hidden by folding is not drawn", () => {
        const { app, editor, vs } = createEditor("head\nhidden line here\ntail");
        vs.setFoldingRegions([{ startLine: 0, endLine: 1, isCollapsed: true }]);
        // Put a cursor on the hidden line, bypassing reconcileHiddenCursors.
        vs.selections = [createCursorSelection(0, 0), createCursorSelection(1, 2)];
        editor.focus();
        app.render();
        const gw = editor.gutterWidth;
        const caretBg = packRgb(0xae, 0xaf, 0xad); // editorCursor.foreground
        expect(app.backend.getBgAt(new Point(gw, 0))).toBe(caretBg);
        // Row 1 is already "tail"; the hidden line's cursor is not on it.
        expect(app.backend.getBgAt(new Point(gw + 2, 1))).not.toBe(caretBg);
    });

    it("a click on the chevron column of a continuation does not fold the region", () => {
        const { editor, vs } = createEditor("aaaa bbbb cc\nbody\ntail");
        const region = { startLine: 0, endLine: 1, isCollapsed: false };
        vs.setFoldingRegions([region]);
        fireMouseDown(editor, editor.foldControlColumn, 1); // header continuation row
        expect(region.isCollapsed).toBe(false);
        // The click hit the continuation gutter → cursor to the fragment start.
        expect(vs.selections[0].active).toEqual({ line: 0, character: 10 });

        fireMouseDown(editor, editor.foldControlColumn, 0); // first fragment: folds
        expect(region.isCollapsed).toBe(true);
    });
});
