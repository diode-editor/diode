import { describe, expect, it } from "vitest";

import { createFoldingRegion } from "../../contrib/folding/iFoldingRegion.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

function stateWithRegions(): EditorViewState {
    // 0: a          ← outer region 0..5
    // 1:   b        ← inner region 1..3
    // 2:     c
    // 3:   d
    // 4:   e
    // 5:   f
    // 6: g
    const doc = new TextDocument("a\n  b\n    c\n  d\n  e\n  f\ng");
    const state = new EditorViewState(doc);
    state.setFoldingRegions([createFoldingRegion(0, 5), createFoldingRegion(1, 3)]);
    return state;
}

describe("foldingRegionContaining", () => {
    it("returns the innermost region covering a line", () => {
        const state = stateWithRegions();
        expect(state.foldingRegionContaining(2)?.startLine).toBe(1);
    });

    it("returns the header region when the line is the header", () => {
        const state = stateWithRegions();
        expect(state.foldingRegionContaining(1)?.startLine).toBe(1);
        expect(state.foldingRegionContaining(0)?.startLine).toBe(0);
    });

    it("returns the outer region for lines only it covers", () => {
        const state = stateWithRegions();
        expect(state.foldingRegionContaining(4)?.startLine).toBe(0);
    });

    it("returns undefined for lines outside every region", () => {
        const state = stateWithRegions();
        expect(state.foldingRegionContaining(6)).toBeUndefined();
    });

    it("picks the innermost region regardless of array order", () => {
        // Регионы изнутри наружу: объемлющий идёт позже и не должен вытеснить внутренний.
        const doc = new TextDocument("a\n  b\n    c\n  d\n  e\n  f\ng");
        const state = new EditorViewState(doc);
        state.setFoldingRegions([createFoldingRegion(1, 3), createFoldingRegion(0, 5)]);
        expect(state.foldingRegionContaining(2)?.startLine).toBe(1);
    });
});

describe("foldRegionContaining", () => {
    it("collapses the innermost expanded region and hides its body", () => {
        const state = stateWithRegions();
        const before = state.getViewLineCount();
        state.foldRegionContaining(2);
        expect(state.getViewLineCount()).toBe(before - 2);
        expect(state.foldingRegionContaining(1)?.isCollapsed).toBe(true);
    });

    it("folds outward on repeated calls", () => {
        const state = stateWithRegions();
        state.foldRegionContaining(2);
        state.foldRegionContaining(1); // header of inner is still visible → collapses outer
        expect(state.foldedRegions.find((r) => r.startLine === 0)?.isCollapsed).toBe(true);
    });

    it("is a no-op when no expanded region covers the line", () => {
        const state = stateWithRegions();
        const before = state.getViewLineCount();
        state.foldRegionContaining(6);
        expect(state.getViewLineCount()).toBe(before);
    });
});

describe("unfoldRegionContaining", () => {
    it("expands the innermost collapsed region", () => {
        const state = stateWithRegions();
        state.foldAll();
        const collapsedCount = state.getViewLineCount();
        state.unfoldRegionContaining(0);
        expect(state.getViewLineCount()).toBeGreaterThan(collapsedCount);
    });

    it("is a no-op when no collapsed region covers the line", () => {
        const state = stateWithRegions();
        const before = state.getViewLineCount();
        state.unfoldRegionContaining(2);
        expect(state.getViewLineCount()).toBe(before);
    });

    it("expands the innermost region when nested regions both cover the line", () => {
        const state = stateWithRegions();
        state.foldAll();
        state.unfoldRegionContaining(2); // covered by both outer (0..5) and inner (1..3)
        expect(state.foldedRegions.find((r) => r.startLine === 1)?.isCollapsed).toBe(false);
        expect(state.foldedRegions.find((r) => r.startLine === 0)?.isCollapsed).toBe(true);
    });
});

describe("toggleFoldContaining", () => {
    it("toggles the innermost region at the line", () => {
        const state = stateWithRegions();
        state.toggleFoldContaining(2);
        expect(state.foldingRegionContaining(1)?.isCollapsed).toBe(true);
        state.toggleFoldContaining(1);
        expect(state.foldedRegions.find((r) => r.startLine === 1)?.isCollapsed).toBe(false);
    });

    it("is a no-op when no region covers the line", () => {
        const state = stateWithRegions();
        expect(() => {
            state.toggleFoldContaining(6);
        }).not.toThrow();
    });
});

describe("revealRange", () => {
    it("expands a fold hiding the range's END line, not just its start", () => {
        const state = stateWithRegions();
        state.foldRegionContaining(2); // collapse inner (1..3) → lines 2,3 hidden
        expect(state.logicalToVisualLine(3)).toBe(-1);
        state.revealRange({ start: { line: 1, character: 0 }, end: { line: 3, character: 0 } });
        expect(state.logicalToVisualLine(3)).toBeGreaterThanOrEqual(0);
    });
});

describe("goToPosition reveals a hidden target line", () => {
    it("expands a single collapsed region hiding the target", () => {
        const state = stateWithRegions();
        state.foldRegionContaining(2);
        expect(state.logicalToVisualLine(2)).toBe(-1);
        state.goToPosition(2, 0);
        expect(state.logicalToVisualLine(2)).toBeGreaterThanOrEqual(0);
        expect(state.selections[0].active).toEqual({ line: 2, character: 0 });
    });

    it("expands every enclosing region when the target is nested in collapsed folds", () => {
        const state = stateWithRegions();
        state.foldAll();
        expect(state.logicalToVisualLine(2)).toBe(-1);
        state.goToPosition(2, 0);
        expect(state.logicalToVisualLine(2)).toBeGreaterThanOrEqual(0);
        expect(state.foldedRegions.find((r) => r.startLine === 0)?.isCollapsed).toBe(false);
        expect(state.foldedRegions.find((r) => r.startLine === 1)?.isCollapsed).toBe(false);
    });
});

describe("setFoldingRegions – adversarial input", () => {
    it("tolerates a region whose endLine runs past the document", () => {
        const doc = new TextDocument("a\nb\nc");
        const state = new EditorViewState(doc);
        state.setFoldingRegions([createFoldingRegion(1, 10, true)]); // endLine ≫ lineCount
        expect(() => state.getViewLineCount()).not.toThrow();
        expect(state.getViewLineCount()).toBe(2);
        expect(state.visualToLogicalLine(0)).toBe(0);
        expect(state.visualToLogicalLine(1)).toBe(1);
    });

    it("tolerates duplicate/overlapping region headers", () => {
        const doc = new TextDocument("a\n  b\n    c\n  d\ne");
        const state = new EditorViewState(doc);
        state.setFoldingRegions([createFoldingRegion(1, 3), createFoldingRegion(1, 2)]);
        expect(() => {
            state.toggleFold(1);
        }).not.toThrow();
        expect(() => state.getViewLineCount()).not.toThrow();
        expect(state.visualToLogicalLine(0)).toBe(0);
    });
});
