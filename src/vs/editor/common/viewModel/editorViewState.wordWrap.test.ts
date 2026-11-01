import { describe, expect, it } from "vitest";

import { createCursorSelection } from "../core/iSelection.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

function makeState(lines: string, viewportWidth = 10): EditorViewState {
    const state = new EditorViewState(new TextDocument(lines), [createCursorSelection(0, 0)]);
    state.viewportWidth = viewportWidth;
    return state;
}

describe("EditorViewState word wrap — projection", () => {
    it("wordWrap=on expands a long line into one row per fragment", () => {
        const state = makeState("aaaa bbbb cccc\nshort");
        expect(state.getViewLineCount()).toBe(2);
        state.wordWrap = "on";
        // "aaaa bbbb " + "cccc" = 2 rows, plus "short".
        expect(state.getViewLineCount()).toBe(3);
    });

    it("both fragments return the same logical line", () => {
        const state = makeState("aaaa bbbb cccc\nshort");
        state.wordWrap = "on";
        expect(state.visualToLogicalLine(0)).toBe(0);
        expect(state.visualToLogicalLine(1)).toBe(0);
        expect(state.visualToLogicalLine(2)).toBe(1);
        expect(state.logicalToVisualLine(0)).toBe(0);
        expect(state.logicalToVisualLine(1)).toBe(2);
    });

    it("getViewLine of a fragment is the whole logical line (the window crops rendering)", () => {
        const state = makeState("aaaa bbbb cccc");
        state.wordWrap = "on";
        expect(state.getViewLine(0)).toBe("aaaa bbbb cccc");
        expect(state.getViewLine(1)).toBe("aaaa bbbb cccc");
    });

    it("viewLineRange returns fragment offsets, the last one ends at line length", () => {
        const state = makeState("aaaa bbbb cccc");
        state.wordWrap = "on";
        expect(state.viewLineRange(0)).toEqual({ start: 0, end: 10 });
        expect(state.viewLineRange(1)).toEqual({ start: 10, end: 14 });
        expect(state.viewLineRange(5)).toEqual({ start: 0, end: 0 });
        expect(state.viewLineRange(-1)).toEqual({ start: 0, end: 0 });
    });

    it("viewLineStartColumn is the display column of the fragment start (tabs counted)", () => {
        const state = makeState("\taaaa bbb cc");
        state.wordWrap = "on";
        // "\taaaa bbb cc": tab=4 + aaaa=8, ws=9 → "bbb" doesn't fit → break offset 6.
        expect(state.viewLineRange(0)).toEqual({ start: 0, end: 6 });
        expect(state.viewLineStartColumn(0)).toBe(0);
        expect(state.viewLineStartColumn(1)).toBe(9);
    });

    it("viewLineForPosition puts a position on its fragment; a boundary goes to the next row", () => {
        const state = makeState("aaaa bbbb cccc\nshort");
        state.wordWrap = "on";
        expect(state.viewLineForPosition(0, 0)).toBe(0);
        expect(state.viewLineForPosition(0, 9)).toBe(0);
        expect(state.viewLineForPosition(0, 10)).toBe(1);
        expect(state.viewLineForPosition(0, 14)).toBe(1);
        expect(state.viewLineForPosition(1, 0)).toBe(2);
    });

    it("viewLineForPosition on a line hidden by a fold is -1", () => {
        const state = makeState("header\naaaa bbbb cccc");
        state.wordWrap = "on";
        state.setFoldingRegions([{ startLine: 0, endLine: 1, isCollapsed: true }]);
        expect(state.viewLineForPosition(1, 3)).toBe(-1);
    });

    it("wordWrap=off behaves as before: one row per line, range is the whole line", () => {
        const state = makeState("aaaa bbbb cccc");
        expect(state.getViewLineCount()).toBe(1);
        expect(state.viewLineRange(0)).toEqual({ start: 0, end: 14 });
        expect(state.viewLineStartColumn(0)).toBe(0);
        expect(state.viewLineForPosition(0, 12)).toBe(0);
    });
});

describe("EditorViewState word wrap — modes and invalidation", () => {
    it("mode on wraps at the viewport and IGNORES wordWrapColumn", () => {
        const state = makeState("aaaa bbbb cccc", 40);
        state.wordWrap = "on";
        state.wordWrapColumn = 10;
        // Column 10 would break the line; viewport width 40 doesn't.
        expect(state.getViewLineCount()).toBe(1);
    });

    it("modes wordWrapColumn/bounded are limited by both the column and the viewport (v1)", () => {
        const state = makeState("aaaa bbbb cccc", 40);
        state.wordWrap = "wordWrapColumn";
        state.wordWrapColumn = 10;
        expect(state.getViewLineCount()).toBe(2);

        state.wordWrap = "bounded";
        expect(state.getViewLineCount()).toBe(2);

        state.viewportWidth = 10;
        state.wordWrapColumn = 80;
        expect(state.getViewLineCount()).toBe(2);
    });

    it("degenerate (zero) viewport width clamps to MIN_WRAP_WIDTH instead of disabling wrapping", () => {
        const state = makeState("aaaa bbbb cccc", 0);
        state.wordWrap = "on";
        // Clamped to 8 columns: "aaaa " + "bbbb " + "cccc" = 3 rows.
        expect(state.getViewLineCount()).toBe(3);
    });

    it("changing viewport width rebuilds the projection (snapshot invalidation)", () => {
        const state = makeState("aaaa bbbb cccc");
        state.wordWrap = "on";
        expect(state.getViewLineCount()).toBe(2);
        state.viewportWidth = 40;
        expect(state.getViewLineCount()).toBe(1);
        state.viewportWidth = 10;
        expect(state.getViewLineCount()).toBe(2);
    });

    it("changing tabSize rebuilds the projection: wrap points depend on tabs", () => {
        const state = makeState("\t\taaaa bbbb");
        state.wordWrap = "on";
        // tabSize 4: 2 tabs = 8 columns → aaaa doesn't fit.
        const before = state.getViewLineCount();
        state.tabSize = 2;
        // tabSize 2: 2 tabs = 4 columns → "\t\taaaa " = 9… bbbb still doesn't fit,
        // but the layout differs — compare ranges, not just the count.
        const after = state.viewLineRange(0);
        state.tabSize = 4;
        expect(state.getViewLineCount()).toBe(before);
        expect(state.viewLineRange(0)).not.toEqual(after);
    });

    it("a document edit rebuilds fragments", () => {
        const state = makeState("aaaa bbbb cccc");
        state.wordWrap = "on";
        expect(state.getViewLineCount()).toBe(2);
        state.selections = [createCursorSelection(0, 14)];
        state.type(" dddd eeee");
        expect(state.getViewLineCount()).toBe(3);
    });
});

describe("EditorViewState word wrap — folding and zones", () => {
    it("a collapsed region hides fragments of hidden lines entirely", () => {
        const state = makeState("header\naaaa bbbb cccc\ntail");
        state.wordWrap = "on";
        expect(state.getViewLineCount()).toBe(4); // header + 2 fragments + tail
        state.setFoldingRegions([{ startLine: 0, endLine: 1, isCollapsed: true }]);
        expect(state.getViewLineCount()).toBe(2); // header + tail
        expect(state.logicalToVisualLine(1)).toBe(-1);
    });

    it("a zone goes after the LAST fragment of its line", () => {
        const state = makeState("aaaa bbbb cccc\ntail");
        state.wordWrap = "on";
        state.setViewZones([{ afterLine: 0, size: 1 }]);
        // Rows: fragment 1, fragment 2, zone, tail.
        expect(state.getViewLineCount()).toBe(4);
        expect(state.viewLineKind(0)).toBe("doc");
        expect(state.viewLineKind(1)).toBe("doc");
        expect(state.viewLineKind(2)).toBe("zone");
        expect(state.viewLineKind(3)).toBe("doc");
        expect(state.zoneAnchorForViewLine(2)).toBe(0);
        expect(state.viewLineRange(2)).toEqual({ start: 0, end: 0 });
        expect(state.viewLineStartColumn(2)).toBe(0);
    });
});

describe("EditorViewState word wrap — scrollLeft", () => {
    it("with wrap active scrollLeft clamps to zero, with off it is free again", () => {
        const state = makeState("aaaa bbbb cccc");
        state.scrollLeft = 5;
        expect(state.scrollLeft).toBe(5);
        state.wordWrap = "on";
        state.scrollLeft = 7;
        expect(state.scrollLeft).toBe(0);
        state.wordWrap = "off";
        state.scrollLeft = 7;
        expect(state.scrollLeft).toBe(7);
    });
});

describe("EditorViewState — wrapping sees the insertions", () => {
    function wrapped(): EditorViewState {
        const state = new EditorViewState(new TextDocument("aaaa bbbb\nccc"));
        state.viewportWidth = 10;
        state.viewportHeight = 10;
        state.wordWrap = "on";
        return state;
    }

    it("an insertion that overflows the line adds a row, removing it takes the row away", () => {
        const state = wrapped();
        expect(state.docLineForViewLine(1)).toBe(1);
        state.inlineInsertions = [{ line: 0, offset: 4, text: ": int" }];
        expect(state.docLineForViewLine(1)).toBe(0);
        expect(state.docLineForViewLine(2)).toBe(1);
        state.inlineInsertions = [];
        expect(state.docLineForViewLine(1)).toBe(1);
    });

    it("insertions set while wrap is off count once it is on", () => {
        const state = wrapped();
        state.wordWrap = "off";
        state.inlineInsertions = [{ line: 0, offset: 4, text: ": int" }];
        expect(state.docLineForViewLine(1)).toBe(1);
        state.wordWrap = "on";
        expect(state.docLineForViewLine(1)).toBe(0);
    });

    it("a recolored insertion keeps the rows", () => {
        const state = wrapped();
        state.inlineInsertions = [{ line: 0, offset: 4, text: ": int" }];
        state.inlineInsertions = [{ line: 0, offset: 4, text: ": int", italic: true }];
        expect(state.docLineForViewLine(2)).toBe(1);
    });
});
