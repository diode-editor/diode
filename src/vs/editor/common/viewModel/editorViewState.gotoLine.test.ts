import { describe, expect, it } from "vitest";

import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

function makeState(lineCount: number): EditorViewState {
    const lines = Array.from({ length: lineCount }, (_, i) => `line ${i}`);
    const state = new EditorViewState(new TextDocument(lines.join("\n")));
    state.viewportWidth = 40;
    state.viewportHeight = 10;
    return state;
}

describe("EditorViewState.goToPosition", () => {
    it("moves the primary cursor to the requested position", () => {
        const state = makeState(50);
        state.goToPosition(20, 3);
        expect(state.selections).toHaveLength(1);
        expect(state.selections[0].active).toEqual({ line: 20, character: 3 });
        expect(state.selections[0].anchor).toEqual({ line: 20, character: 3 });
    });

    it("defaults the column to the line start", () => {
        const state = makeState(50);
        state.goToPosition(20);
        expect(state.selections[0].active).toEqual({ line: 20, character: 0 });
    });

    it("clamps a line past the end to the last line", () => {
        const state = makeState(10);
        state.goToPosition(999, 0);
        expect(state.selections[0].active.line).toBe(9);
    });

    it("clamps a negative line to the first line", () => {
        const state = makeState(10);
        state.goToPosition(-5, 0);
        expect(state.selections[0].active.line).toBe(0);
    });

    it("clamps the column to the line length", () => {
        const state = makeState(10);
        // "line 5" has length 6.
        state.goToPosition(5, 999);
        expect(state.selections[0].active.character).toBe(6);
    });

    it("scrolls the target line into view", () => {
        const state = makeState(100);
        expect(state.scrollTop).toBe(0);
        state.goToPosition(80, 0);
        expect(state.scrollTop).toBeGreaterThan(0);
        expect(state.scrollTop).toBeLessThanOrEqual(80);
    });

    it("exposes the primary cursor line and column", () => {
        const state = makeState(10);
        state.goToPosition(4, 2);
        expect(state.primaryCursorLine).toBe(4);
        expect(state.primaryCursorColumn).toBe(2);
    });

    it("reports 0,0 when there is no selection", () => {
        const state = makeState(10);
        state.selections = [];
        expect(state.primaryCursorLine).toBe(0);
        expect(state.primaryCursorColumn).toBe(0);
    });

    it("fires the cursor-change listener", () => {
        const state = makeState(10);
        let fired = 0;
        state.onDidChangeCursorPosition(() => {
            fired++;
        });
        state.goToPosition(3, 0);
        expect(fired).toBe(1);
    });
});

describe("EditorViewState.revealRangeNearBottom", () => {
    const at = (line: number) => ({ start: { line, character: 0 }, end: { line, character: 3 } });

    it("puts the line two rows above the viewport's end, in either direction, and leaves the selection", () => {
        const state = makeState(100);
        state.revealRangeNearBottom(at(50));
        expect(state.scrollTop).toBe(43);
        state.revealRangeNearBottom(at(20));
        expect(state.scrollTop).toBe(13);
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("unfolds the region the line is in", () => {
        const state = makeState(100);
        state.setFoldingRegions([{ startLine: 48, endLine: 55, isCollapsed: true }] as never);
        state.revealRangeNearBottom(at(50));
        expect(state.getCollapsedFolds()).toEqual([]);
    });

    it("stops at the top of the document", () => {
        const state = makeState(100);
        state.revealRangeNearBottom(at(50));
        state.revealRangeNearBottom(at(2));
        expect(state.scrollTop).toBe(0);
    });

    it("in a tiny viewport the context never pushes the line off the screen", () => {
        const state = makeState(100);
        state.viewportHeight = 3;
        state.revealRangeNearBottom(at(50));
        expect(state.scrollTop).toBe(49);
    });
});

describe("EditorViewState collapsed folds", () => {
    function folded(): EditorViewState {
        const state = makeState(30);
        state.setFoldingRegions([
            { startLine: 2, endLine: 5, isCollapsed: true },
            { startLine: 10, endLine: 14, isCollapsed: false },
        ] as never);
        return state;
    }

    it("reports the start lines of the collapsed regions", () => {
        expect(folded().getCollapsedFolds()).toEqual([2]);
    });

    it("restoring puts both directions back and rebuilds", () => {
        const state = folded();
        const version = state.foldStateVersion;
        state.restoreCollapsedFolds([10]);
        expect(state.getCollapsedFolds()).toEqual([10]);
        expect(state.foldStateVersion).toBeGreaterThan(version);
    });

    it("restoring the same state does not count as a change", () => {
        const state = folded();
        const version = state.foldStateVersion;
        state.restoreCollapsedFolds([2]);
        expect(state.foldStateVersion).toBe(version);
    });
});
