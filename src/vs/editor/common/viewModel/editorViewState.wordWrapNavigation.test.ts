import { describe, expect, it } from "vitest";

import { createCursorSelection, createSelection } from "../core/iSelection.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

// Viewport of 10 columns: "aaaa bbbb cccc" → rows "aaaa bbbb " (offset 0..10) and "cccc".
function makeState(lines = "aaaa bbbb cccc\nshort", viewportWidth = 10): EditorViewState {
    const state = new EditorViewState(new TextDocument(lines), [createCursorSelection(0, 0)]);
    state.viewportWidth = viewportWidth;
    state.wordWrap = "on";
    return state;
}

function active(state: EditorViewState): { line: number; character: number } {
    const pos = state.selections[0].active;
    return { line: pos.line, character: pos.character };
}

describe("word wrap navigation — cursorUp/cursorDown by rows", () => {
    it("cursorDown inside a wrapped line goes to the next fragment, keeping the column", () => {
        const state = makeState();
        state.selections = [createCursorSelection(0, 2)];
        state.cursorDown();
        // Column 2 of fragment 2 → offset 10 + 2.
        expect(active(state)).toEqual({ line: 0, character: 12 });
        state.cursorDown();
        expect(active(state)).toEqual({ line: 1, character: 2 });
    });

    it("cursorUp from a continuation returns to the first fragment", () => {
        const state = makeState();
        state.selections = [createCursorSelection(0, 12)];
        state.cursorUp();
        expect(active(state)).toEqual({ line: 0, character: 2 });
    });

    it("sticky column survives a short fragment", () => {
        const state = makeState();
        state.selections = [createCursorSelection(0, 9)];
        state.cursorDown(); // "cccc" is only 4 columns, cursor goes to the end
        expect(active(state)).toEqual({ line: 0, character: 14 });
        state.cursorUp();
        expect(active(state)).toEqual({ line: 0, character: 9 });
    });

    it("a cursor on a non-last fragment does not cross the boundary when landing", () => {
        // The second line is long: going down from the end of the first row must not yield the boundary offset.
        const state = makeState("aaaa bbbb cccc\naaaa bbbb cccc");
        state.selections = [createCursorSelection(0, 14)]; // end of "cccc" (row 2)
        state.cursorDown();
        expect(active(state)).toEqual({ line: 1, character: 4 });
        state.selections = [createCursorSelection(0, 9)];
        state.cursorDown(); // row 2 ("cccc"): sticky column 9 clamps to the line end
        expect(active(state)).toEqual({ line: 0, character: 14 });
    });

    it("at view edges the cursor stays in place", () => {
        const state = makeState();
        state.selections = [createCursorSelection(0, 2)];
        state.cursorUp();
        expect(active(state)).toEqual({ line: 0, character: 2 });
        state.selections = [createCursorSelection(1, 3)];
        state.cursorDown();
        expect(active(state)).toEqual({ line: 1, character: 3 });
    });

    it("cursorDown skips a zone row between lines", () => {
        const state = makeState();
        state.setViewZones([{ afterLine: 0, size: 1 }]);
        state.selections = [createCursorSelection(0, 12)]; // second fragment
        state.cursorDown();
        expect(active(state)).toEqual({ line: 1, character: 2 });
    });

    it("Shift+Down selection extends across fragments", () => {
        const state = makeState();
        state.selections = [createCursorSelection(0, 2)];
        state.cursorDown(true);
        const sel = state.selections[0];
        expect(sel.anchor).toEqual({ line: 0, character: 2 });
        expect(sel.active).toEqual({ line: 0, character: 12 });
    });
});

describe("word wrap navigation — hidden lines and zones", () => {
    it("cursorUp from a hidden line lands on the FIRST document line if it is the nearest visible one", () => {
        const state = makeState("head\nhidden\ntail");
        state.setFoldingRegions([{ startLine: 0, endLine: 1, isCollapsed: true }]);
        // Cursor on a hidden line — bypassing reconcileHiddenCursors.
        state.selections = [createCursorSelection(1, 2)];
        state.cursorUp();
        expect(active(state)).toEqual({ line: 0, character: 2 });
    });

    it("cursorRight at line end skips a zone and goes to the next line", () => {
        const state = makeState("ab\ncd");
        state.setViewZones([{ afterLine: 0, size: 1 }]);
        state.selections = [createCursorSelection(0, 2)];
        state.cursorRight();
        expect(active(state)).toEqual({ line: 1, character: 0 });
    });

    it("landing with a sticky column past the fragment boundary clamps to the last grapheme", () => {
        const state = makeState("short\naaaa bbbb cccc");
        state.selections = [createCursorSelection(0, 5)];
        state.cursorEnd();
        state.cursorDown(); // row 1 — NOT the last fragment of line 1
        expect(active(state)).toEqual({ line: 1, character: 9 });
    });
});

describe("word wrap navigation — Home/End within a fragment", () => {
    it("Home on a continuation goes to the fragment start, a repeated press is a no-op", () => {
        const state = makeState();
        state.selections = [createCursorSelection(0, 12)];
        state.cursorHome();
        expect(active(state)).toEqual({ line: 0, character: 10 });
        state.cursorHome();
        expect(active(state)).toEqual({ line: 0, character: 10 });
    });

    it("Home on the first fragment is the usual smart home", () => {
        const state = makeState("  aaaa bbbb cccc\nz");
        state.selections = [createCursorSelection(0, 5)];
        state.cursorHome();
        expect(active(state)).toEqual({ line: 0, character: 2 });
        state.cursorHome();
        expect(active(state)).toEqual({ line: 0, character: 0 });
    });

    it("End on a non-last fragment is the fragment's last grapheme", () => {
        const state = makeState();
        state.selections = [createCursorSelection(0, 2)];
        state.cursorEnd();
        // The fragment boundary is offset 10; the cursor is before it, on the space (9).
        expect(active(state)).toEqual({ line: 0, character: 9 });
    });

    it("End on the last fragment is the line end", () => {
        const state = makeState();
        state.selections = [createCursorSelection(0, 12)];
        state.cursorEnd();
        expect(active(state)).toEqual({ line: 0, character: 14 });
    });
});

describe("word wrap navigation — horizontal across boundaries", () => {
    it("cursorRight at the end of a wrapped line goes to the NEXT line, not to its own fragment", () => {
        const state = makeState();
        state.selections = [createCursorSelection(0, 14)];
        state.cursorRight();
        expect(active(state)).toEqual({ line: 1, character: 0 });
    });

    it("cursorLeft at line start goes to the end of the previous wrapped line", () => {
        const state = makeState();
        state.selections = [createCursorSelection(1, 0)];
        state.cursorLeft();
        expect(active(state)).toEqual({ line: 0, character: 14 });
    });
});

describe("word wrap navigation — multi-cursor and pages", () => {
    it("insertCursorBelow adds a cursor on the next ROW of the same line", () => {
        const state = makeState();
        state.selections = [createCursorSelection(0, 2)];
        state.insertCursorBelow();
        expect(state.selections.map((s) => ({ ...s.active }))).toEqual([
            { line: 0, character: 2 },
            { line: 0, character: 12 },
        ]);
    });

    it("insertCursorAbove from a continuation adds a cursor on the first fragment", () => {
        const state = makeState();
        state.selections = [createCursorSelection(0, 12)];
        state.insertCursorAbove();
        expect(state.selections.map((s) => ({ ...s.active }))).toEqual([
            { line: 0, character: 2 },
            { line: 0, character: 12 },
        ]);
    });

    it("a non-empty selection moves to the adjacent row whole", () => {
        const state = makeState();
        state.selections = [createSelection(0, 0, 0, 2)];
        state.insertCursorBelow();
        expect(state.selections).toHaveLength(2);
        const added = state.selections[1];
        expect(added.anchor).toEqual({ line: 0, character: 10 });
        expect(added.active).toEqual({ line: 0, character: 12 });
    });

    it("PageDown steps in view rows", () => {
        // 3 wrapped lines of 2 rows each; viewport of 4 rows → page = 3 rows.
        const state = makeState("aaaa bbbb cccc\naaaa bbbb cccc\naaaa bbbb cccc");
        state.viewportHeight = 4;
        state.selections = [createCursorSelection(0, 2)];
        state.cursorPageDown();
        // Row 0 → row 3 (second fragment of line 1), column 2 → offset 12.
        expect(active(state)).toEqual({ line: 1, character: 12 });
    });

    it("PageUp with a zone before view start falls back to the first document row below", () => {
        const state = makeState("aaaa bbbb cccc\nshort");
        state.viewportHeight = 3; // page = 2 rows
        state.setViewZones([{ afterLine: -1, size: 2 }]);
        state.selections = [createCursorSelection(0, 2)]; // row 2 (after the zone's two rows)
        state.cursorPageUp(); // target row 0 is a zone; no document rows above — down to row 2
        expect(active(state)).toEqual({ line: 0, character: 2 });
    });

    it("cursorWordLeft at document start with a zone before the view is a no-op", () => {
        const state = makeState("aaaa bbbb cccc");
        state.setViewZones([{ afterLine: -1, size: 1 }]);
        state.selections = [createCursorSelection(0, 0)];
        state.cursorWordLeft();
        expect(active(state)).toEqual({ line: 0, character: 0 });
    });

    it("PageUp from a continuation row keeps the column relative to the fragment", () => {
        const state = makeState();
        state.viewportHeight = 2; // page = 1 row
        state.selections = [createCursorSelection(0, 12)]; // row 1, column 2 of the fragment
        state.cursorPageUp();
        expect(active(state)).toEqual({ line: 0, character: 2 });
    });

    it("PageUp onto a zone whose nearest document row is the very first", () => {
        const state = makeState("ab\ncd");
        state.viewportHeight = 2; // page = 1 row
        state.setViewZones([{ afterLine: 0, size: 1 }]);
        state.selections = [createCursorSelection(1, 0)];
        state.cursorPageUp(); // target row 1 is a zone → back up to row 0
        expect(active(state)).toEqual({ line: 0, character: 0 });
    });

    it("PageDown lands past a zone on the nearest document row", () => {
        const state = makeState("aaaa bbbb cccc\nshort");
        state.viewportHeight = 3; // page = 2 rows
        state.setViewZones([{ afterLine: 0, size: 1 }]);
        state.selections = [createCursorSelection(0, 2)];
        state.cursorPageDown(); // row 0 + 2 = zone → back to the last document row above
        expect(active(state)).toEqual({ line: 0, character: 12 });
    });
});

describe("word wrap navigation — reveal", () => {
    it("reveal shows the cursor's ROW: the tail of a long line scrolls the viewport", () => {
        // 8 fragments of 10 columns; viewport of 3 rows.
        const state = makeState(`${"aaaa bbbb ".repeat(8)}end`, 10);
        state.viewportHeight = 3;
        state.goToPosition(0, 82);
        expect(state.scrollTop).toBeGreaterThan(0);
        expect(state.scrollLeft).toBe(0);
    });
});
