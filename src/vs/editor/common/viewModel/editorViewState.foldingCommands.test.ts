import { describe, expect, it } from "vitest";

import { createFoldingRegion } from "../../contrib/folding/iFoldingRegion.ts";
import { createCursorSelection } from "../core/iSelection.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

// 0: fn1          ← region 0..3 (level 1)
// 1:   if         ← region 1..2 (level 2, nested in fn1)
// 2:     x
// 3:   y
// 4: fn2          ← region 4..5 (level 1)
// 5:   z
// 6: tail         ← no region
function tree(): EditorViewState {
    const doc = new TextDocument("fn1\n  if\n    x\n  y\nfn2\n  z\ntail");
    const state = new EditorViewState(doc);
    state.setFoldingRegions([createFoldingRegion(0, 3), createFoldingRegion(1, 2), createFoldingRegion(4, 5)]);
    return state;
}

function collapsedOf(state: EditorViewState, startLine: number): boolean | undefined {
    return state.foldedRegions.find((r) => r.startLine === startLine)?.isCollapsed;
}

describe("EditorViewState – foldRecursively / unfoldRecursively", () => {
    it("collapses the region at the cursor and every region nested inside it", () => {
        const state = tree();
        state.foldRecursively(0);
        expect(collapsedOf(state, 0)).toBe(true);
        expect(collapsedOf(state, 1)).toBe(true);
        expect(collapsedOf(state, 4)).toBe(false);
    });

    it("only collapses the innermost region when it has no children", () => {
        const state = tree();
        state.foldRecursively(4);
        expect(collapsedOf(state, 4)).toBe(true);
        expect(collapsedOf(state, 0)).toBe(false);
        expect(collapsedOf(state, 1)).toBe(false);
    });

    it("is a no-op when no region covers the line", () => {
        const state = tree();
        state.foldRecursively(6);
        expect(state.foldedRegions.every((r) => !r.isCollapsed)).toBe(true);
    });

    it("snaps the cursor to a visible header when recursion hides it", () => {
        const state = tree();
        state.selections = [createCursorSelection(2, 0)];
        state.foldRecursively(0);
        expect(state.selections[0].active.line).toBe(0);
        expect(state.logicalToVisualLine(0)).toBeGreaterThanOrEqual(0);
    });

    it("unfoldRecursively expands the region and everything nested in it", () => {
        const state = tree();
        state.foldAll();
        state.unfoldRecursively(0);
        expect(collapsedOf(state, 0)).toBe(false);
        expect(collapsedOf(state, 1)).toBe(false);
        expect(collapsedOf(state, 4)).toBe(true);
    });
});

describe("EditorViewState – foldLevel", () => {
    it("folds only regions at or below the requested nesting level", () => {
        const state = tree();
        state.foldLevel(2);
        expect(collapsedOf(state, 0)).toBe(false);
        expect(collapsedOf(state, 4)).toBe(false);
        expect(collapsedOf(state, 1)).toBe(true);
    });

    it("folds every region at level 1", () => {
        const state = tree();
        state.foldLevel(1);
        expect(state.foldedRegions.every((r) => r.isCollapsed)).toBe(true);
    });

    it("leaves everything expanded for a level deeper than the tree", () => {
        const state = tree();
        state.foldLevel(3);
        expect(state.foldedRegions.every((r) => !r.isCollapsed)).toBe(true);
    });

    it("keeps the cursor visible after folding", () => {
        const state = tree();
        state.selections = [createCursorSelection(2, 0)];
        state.foldLevel(2);
        expect(state.logicalToVisualLine(state.selections[0].active.line)).toBeGreaterThanOrEqual(0);
    });
});

describe("EditorViewState – gotoNextFold / gotoPreviousFold", () => {
    it("moves the cursor to the next region header", () => {
        const state = tree();
        state.selections = [createCursorSelection(0, 0)];
        state.gotoNextFold(0);
        expect(state.selections[0].active).toEqual({ line: 1, character: 0 });
        state.gotoNextFold(1);
        expect(state.selections[0].active).toEqual({ line: 4, character: 0 });
    });

    it("moves the cursor to the previous region header", () => {
        const state = tree();
        state.selections = [createCursorSelection(4, 0)];
        state.gotoPreviousFold(4);
        expect(state.selections[0].active).toEqual({ line: 1, character: 0 });
    });

    it("is a no-op past the last / before the first region", () => {
        const state = tree();
        state.selections = [createCursorSelection(6, 0)];
        state.gotoNextFold(6);
        expect(state.selections[0].active.line).toBe(6);
        state.selections = [createCursorSelection(0, 0)];
        state.gotoPreviousFold(0);
        expect(state.selections[0].active.line).toBe(0);
    });

    it("reveals the target region when its header is hidden in a fold", () => {
        const state = tree();
        state.foldRegionContaining(0); // collapse fn1 → the if header (line 1) is hidden
        expect(state.logicalToVisualLine(1)).toBe(-1);
        state.gotoNextFold(0);
        expect(state.selections[0].active.line).toBe(1);
        expect(state.logicalToVisualLine(1)).toBeGreaterThanOrEqual(0);
    });
});
