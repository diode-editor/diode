import { describe, expect, it } from "vitest";

import { createCursorSelection } from "../core/iSelection.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

// ─── Helpers ────────────────────────────────────────────────

function makeDoc(lines: string): TextDocument {
    return new TextDocument(lines);
}

function makeState(lines: string): EditorViewState {
    return new EditorViewState(makeDoc(lines), [createCursorSelection(0, 0)]);
}

// ─── Basic mapping without folding ──────────────────────────

describe("EditorViewState visible lines (no folding)", () => {
    it("getViewLineCount equals document lineCount", () => {
        const state = makeState("a\nb\nc");
        expect(state.getViewLineCount()).toBe(3);
    });

    it("visualToLogicalLine maps 1:1 when no folds", () => {
        const state = makeState("a\nb\nc\nd");
        expect(state.visualToLogicalLine(0)).toBe(0);
        expect(state.visualToLogicalLine(2)).toBe(2);
        expect(state.visualToLogicalLine(3)).toBe(3);
    });

    it("visualToLogicalLine returns -1 for out-of-range visual line", () => {
        const state = makeState("a\nb");
        expect(state.visualToLogicalLine(5)).toBe(-1);
    });

    it("logicalToVisualLine maps 1:1 when no folds", () => {
        const state = makeState("a\nb\nc\nd");
        expect(state.logicalToVisualLine(0)).toBe(0);
        expect(state.logicalToVisualLine(3)).toBe(3);
    });

    it("logicalToVisualLine returns -1 for out-of-range logical line", () => {
        const state = makeState("a\nb");
        expect(state.logicalToVisualLine(-1)).toBe(-1);
        expect(state.logicalToVisualLine(2)).toBe(-1);
        expect(state.logicalToVisualLine(99)).toBe(-1);
    });

    it("repeated calls return the same result", () => {
        const state = makeState("a\nb\nc");
        const first = state.getViewLineCount();
        const second = state.getViewLineCount();
        expect(second).toBe(first);
    });
});

// ─── Cache invalidation: document change ────────────────────

describe("EditorViewState visible lines cache — document change", () => {
    it("getViewLineCount updates after inserting a new line", () => {
        const doc = new TextDocument("a\nb\nc");
        const state = new EditorViewState(doc, [createCursorSelection(0, 0)]);

        expect(state.getViewLineCount()).toBe(3);

        state.type("\n"); // inserts a newline at start → 4 lines
        expect(state.getViewLineCount()).toBe(4);
    });

    it("visualToLogicalLine reflects new mapping after insert", () => {
        const doc = new TextDocument("a\nb\nc");
        const state = new EditorViewState(doc, [createCursorSelection(1, 0)]);

        // Before insert: visual 1 → logical 1
        expect(state.visualToLogicalLine(1)).toBe(1);

        state.type("x\n"); // inserts line before line 1
        // After insert: visual 2 → logical 2 (one line added above)
        expect(state.getViewLineCount()).toBe(4);
    });
});

// ─── Cache invalidation: fold mutations ─────────────────────

describe("EditorViewState visible lines cache — fold mutations", () => {
    function makeRegion(startLine: number, endLine: number, isCollapsed = false) {
        return { startLine, endLine, isCollapsed };
    }

    it("getViewLineCount decreases after toggleFold collapses a region", () => {
        const doc = new TextDocument("a\nb\nc\nd\ne");
        const state = new EditorViewState(doc);
        state.setFoldingRegions([makeRegion(1, 3)]);

        expect(state.getViewLineCount()).toBe(5); // no collapse yet

        state.toggleFold(1);
        // lines 2,3 are hidden → 3 visible lines (0,1,4)
        expect(state.getViewLineCount()).toBe(3);
    });

    it("getViewLineCount restores after toggleFold expands", () => {
        const doc = new TextDocument("a\nb\nc\nd\ne");
        const state = new EditorViewState(doc);
        state.setFoldingRegions([makeRegion(1, 3, true)]);

        expect(state.getViewLineCount()).toBe(3);

        state.toggleFold(1);
        expect(state.getViewLineCount()).toBe(5);
    });

    it("getViewLineCount updates after foldAll", () => {
        const doc = new TextDocument("a\nb\nc\nd\ne");
        const state = new EditorViewState(doc);
        state.setFoldingRegions([makeRegion(1, 3)]);

        expect(state.getViewLineCount()).toBe(5);
        state.foldAll();
        expect(state.getViewLineCount()).toBe(3);
    });

    it("getViewLineCount updates after unfoldAll", () => {
        const doc = new TextDocument("a\nb\nc\nd\ne");
        const state = new EditorViewState(doc);
        state.setFoldingRegions([makeRegion(1, 3, true)]);

        expect(state.getViewLineCount()).toBe(3);
        state.unfoldAll();
        expect(state.getViewLineCount()).toBe(5);
    });

    it("getViewLineCount updates after setFoldingRegions with collapsed region", () => {
        const doc = new TextDocument("a\nb\nc\nd\ne");
        const state = new EditorViewState(doc);

        expect(state.getViewLineCount()).toBe(5);
        state.setFoldingRegions([makeRegion(0, 2, true)]);
        // lines 1,2 are hidden → 3 visible lines (0,3,4)
        expect(state.getViewLineCount()).toBe(3);
    });
});
