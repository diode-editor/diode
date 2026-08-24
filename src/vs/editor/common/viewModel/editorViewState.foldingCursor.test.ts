import { describe, expect, it } from "vitest";

import { createFoldingRegion } from "../../contrib/folding/iFoldingRegion.ts";
import { createCursorSelection } from "../core/iSelection.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

// 0: a          ← outer region 0..5
// 1:   b        ← inner region 1..3
// 2:     c
// 3:   d
// 4:   e
// 5:   f
// 6: g
function nested(): EditorViewState {
    const doc = new TextDocument("a\n  b\n    c\n  d\n  e\n  f\ng");
    const state = new EditorViewState(doc);
    state.setFoldingRegions([createFoldingRegion(0, 5), createFoldingRegion(1, 3)]);
    return state;
}

function cursorLine(state: EditorViewState): number {
    return state.selections[0].active.line;
}

describe("EditorViewState – cursor reconciliation on fold", () => {
    it("snaps the cursor to the header when foldRegionContaining hides it", () => {
        const state = nested();
        state.selections = [createCursorSelection(2, 3)]; // inside inner body (1..3)
        state.foldRegionContaining(2);
        expect(cursorLine(state)).toBe(1); // inner header
        expect(state.logicalToVisualLine(cursorLine(state))).toBeGreaterThanOrEqual(0);
    });

    it("snaps the cursor to the header when toggleFoldContaining collapses over it", () => {
        const state = nested();
        state.selections = [createCursorSelection(2, 0)];
        state.toggleFoldContaining(2);
        expect(cursorLine(state)).toBe(1);
    });

    it("snaps the cursor when a gutter toggleFold hides it", () => {
        const state = nested();
        state.selections = [createCursorSelection(3, 1)]; // body of inner (1..3)
        state.toggleFold(1); // collapse the region whose header is line 1
        expect(cursorLine(state)).toBe(1);
        expect(state.logicalToVisualLine(1)).toBeGreaterThanOrEqual(0);
    });

    it("snaps to the OUTERMOST visible header when foldAll hides a deeply nested cursor", () => {
        const state = nested();
        state.selections = [createCursorSelection(2, 0)]; // inside both outer and inner
        state.foldAll();
        expect(cursorLine(state)).toBe(0); // outer header — the only visible one
        expect(state.logicalToVisualLine(0)).toBeGreaterThanOrEqual(0);
    });

    it("finds the outermost hiding region regardless of region array order", () => {
        // Regions supplied inner-first: outermostCollapsedRegionHiding must still
        // pick the enclosing (smaller startLine) region.
        const doc = new TextDocument("a\n  b\n    c\n  d\n  e\n  f\ng");
        const state = new EditorViewState(doc);
        state.setFoldingRegions([createFoldingRegion(1, 3), createFoldingRegion(0, 5)]);
        state.selections = [createCursorSelection(2, 0)];
        state.foldAll();
        expect(cursorLine(state)).toBe(0);
    });

    it("clamps the snapped cursor's column to the header line length", () => {
        const state = nested();
        state.selections = [createCursorSelection(2, 4)]; // char 4 on "    c"
        state.foldRegionContaining(2);
        // Header "  b" has length 3 → column clamped.
        expect(cursorLine(state)).toBe(1);
        expect(state.selections[0].active.character).toBeLessThanOrEqual(3);
    });

    it("scrolls the snapped cursor into view when its header is off-screen", () => {
        const body = Array.from({ length: 40 }, (_, i) => `  body ${i.toString()}`).join("\n");
        const state = new EditorViewState(new TextDocument(`a\n${body}\nb`));
        state.setFoldingRegions([createFoldingRegion(0, 40)]);
        state.viewportHeight = 10;
        state.viewportWidth = 40;
        state.selections = [createCursorSelection(35, 0)];
        state.scrollTop = 30;

        state.foldRegionContaining(35);

        // Snapping alone is not enough: the header sits far above the viewport, so
        // the caret would end up off-screen unless the fold scrolls it back in.
        expect(cursorLine(state)).toBe(0);
        expect(state.scrollTop).toBe(0);
    });

    it("leaves the cursor put when folding does not hide it (cursor on header)", () => {
        const state = nested();
        state.selections = [createCursorSelection(1, 2)]; // inner header — stays visible
        state.foldRegionContaining(1); // collapses inner; its header line 1 stays shown
        expect(cursorLine(state)).toBe(1);
        expect(state.selections[0].active.character).toBe(2); // untouched
    });

    it("reconciles only the hidden cursors of a multi-selection", () => {
        const state = nested();
        state.selections = [createCursorSelection(0, 0), createCursorSelection(2, 1)];
        state.foldRegionContaining(2); // collapses inner (1..3), hides line 2 only
        const lines = state.selections.map((s) => s.active.line).sort((a, b) => a - b);
        expect(lines).toContain(0); // visible cursor untouched
        expect(lines).toContain(1); // hidden cursor snapped to inner header
    });

    it("does not move the cursor on unfold operations", () => {
        const state = nested();
        state.foldAll();
        state.selections = [createCursorSelection(0, 0)];
        state.unfoldRegionContaining(0);
        expect(cursorLine(state)).toBe(0);
        state.unfoldAll();
        expect(cursorLine(state)).toBe(0);
    });
});

describe("EditorViewState – cursorBottom with a folded tail", () => {
    it("lands on the last visible line, not a hidden one", () => {
        // 0: a
        // 1: b
        // 2: block     ← region 2..4
        // 3:   x
        // 4:   y
        const doc = new TextDocument("a\nb\nblock\n  x\n  y");
        const state = new EditorViewState(doc);
        state.setFoldingRegions([createFoldingRegion(2, 4)]);
        state.foldRegionContaining(2); // collapse the tail region
        state.selections = [createCursorSelection(0, 0)];
        state.cursorBottom();
        // Last logical line 4 is hidden → cursor reconciled onto header line 2.
        expect(cursorLine(state)).toBe(2);
        expect(state.logicalToVisualLine(cursorLine(state))).toBeGreaterThanOrEqual(0);
    });

    it("lands on the true last line when nothing is folded", () => {
        const doc = new TextDocument("a\nb\nc");
        const state = new EditorViewState(doc);
        state.cursorBottom();
        expect(cursorLine(state)).toBe(2);
    });
});
