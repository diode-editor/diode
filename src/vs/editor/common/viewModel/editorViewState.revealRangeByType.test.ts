import { describe, expect, it } from "vitest";

import { createFoldingRegion } from "../../contrib/folding/iFoldingRegion.ts";
import { createRange } from "../core/iRange.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState, type RangeRevealType } from "./editorViewState.ts";

const HEIGHT = 10;

function stateWith(lineCount = 100, lineText = "x"): EditorViewState {
    const state = new EditorViewState(new TextDocument(Array.from({ length: lineCount }, () => lineText).join("\n")));
    state.viewportHeight = HEIGHT;
    state.viewportWidth = 20;
    return state;
}

function scrollTopAfter(state: EditorViewState, startLine: number, endLine: number, type: RangeRevealType): number {
    state.revealRangeByType(createRange(startLine, 0, endLine, 0), type);
    return state.scrollTop;
}

describe("EditorViewState.revealRangeByType", () => {
    it("default keeps a range touching both edges of the viewport, and scrolls just enough otherwise", () => {
        const state = stateWith();
        state.scrollTop = 20;
        expect(scrollTopAfter(state, 20, 29, "default")).toBe(20);
        expect(scrollTopAfter(state, 30, 30, "default")).toBe(21);
        expect(scrollTopAfter(state, 19, 19, "default")).toBe(19);
    });

    it("center is exact for a box of any height", () => {
        const state = stateWith();
        expect(scrollTopAfter(state, 50, 50, "center")).toBe(45);
        expect(scrollTopAfter(state, 50, 53, "center")).toBe(47);
    });

    it("centerIfOutsideViewport treats a box crossing the edge as outside", () => {
        const state = stateWith();
        state.scrollTop = 20;
        expect(scrollTopAfter(state, 20, 29, "centerIfOutsideViewport")).toBe(20);
        expect(scrollTopAfter(state, 29, 30, "centerIfOutsideViewport")).toBe(25);
        state.scrollTop = 20;
        expect(scrollTopAfter(state, 19, 20, "centerIfOutsideViewport")).toBe(15);
    });

    it("a box larger than the viewport shows its top, whatever the type", () => {
        for (const type of ["default", "center", "centerIfOutsideViewport", "top"] as const) {
            const state = stateWith();
            state.scrollTop = 35;
            expect(scrollTopAfter(state, 30, 50, type)).toBe(30);
        }
    });

    it("a box exactly the viewport's height is not larger", () => {
        const state = stateWith();
        state.scrollTop = 35;
        expect(scrollTopAfter(state, 30, 39, "default")).toBe(30);
        state.scrollTop = 25;
        expect(scrollTopAfter(state, 30, 39, "center")).toBe(30);
    });

    it("stays within the document at both ends", () => {
        const state = stateWith();
        expect(scrollTopAfter(state, 99, 99, "top")).toBe(90);
        expect(scrollTopAfter(state, 99, 99, "center")).toBe(90);
        expect(scrollTopAfter(state, 0, 0, "center")).toBe(0);
    });

    it("a document shorter than the viewport does not scroll", () => {
        const state = stateWith(3);
        expect(scrollTopAfter(state, 2, 2, "top")).toBe(0);
    });

    it("our non-zero cursorSurroundingLines does not pad: top is the top row, a visible range does not scroll", () => {
        const state = stateWith();
        state.cursorSurroundingLines = 3;
        expect(scrollTopAfter(state, 50, 50, "top")).toBe(50);
        expect(scrollTopAfter(state, 59, 59, "default")).toBe(50);
    });

    it("a line hidden by a fold reveals its header and stays folded", () => {
        const state = stateWith();
        state.setFoldingRegions([createFoldingRegion(40, 60)]);
        state.foldRegionContaining(40);
        state.scrollTop = 0;

        expect(scrollTopAfter(state, 50, 50, "top")).toBe(40);
        expect(state.foldedRegions[0].isCollapsed).toBe(true);
    });

    it("with wrap the box goes by the rows of the position, not of the line start", () => {
        const state = stateWith(100, "a".repeat(30));
        state.wordWrap = "on";
        state.revealRangeByType(createRange(5, 25, 5, 25), "top");
        expect(state.scrollTop).toBe(state.viewLineForPosition(5, 25));
        expect(state.scrollTop).toBeGreaterThan(state.logicalToVisualLine(5));
    });

    it("one line reveals its columns with the start first, several lines scroll back to the base", () => {
        const state = stateWith(100, "a".repeat(200));
        state.revealRangeByType(createRange(5, 100, 5, 110), "default");
        expect(state.scrollLeft).toBeGreaterThan(90);
        expect(state.scrollLeft).toBeLessThanOrEqual(100);

        state.revealRangeByType(createRange(5, 100, 5, 190), "default");
        expect(state.scrollLeft).toBe(100);

        state.revealRangeByType(createRange(5, 100, 6, 100), "default");
        expect(state.scrollLeft).toBe(0);
    });

    it("a folding recompute keeps the revealed view while the cursor stays visible and off screen", () => {
        const state = stateWith();
        scrollTopAfter(state, 50, 50, "top");
        state.applyRecomputedFoldingRegions([createFoldingRegion(60, 70)]);
        expect(state.scrollTop).toBe(50);
    });

    it("a folding recompute that hides the cursor brings it back", () => {
        const state = stateWith();
        state.goToPosition(65, 0);
        scrollTopAfter(state, 0, 0, "top");
        const hiding = createFoldingRegion(60, 70);
        hiding.isCollapsed = true;
        state.applyRecomputedFoldingRegions([hiding]);
        expect(state.primaryCursorLine).toBe(65);
        expect(hiding.isCollapsed).toBe(false);
        expect(state.scrollTop).toBe(56);
    });

    it("a folding recompute that pushes an on-screen cursor off the screen brings it back", () => {
        const state = stateWith();
        const collapsed = createFoldingRegion(5, 50);
        collapsed.isCollapsed = true;
        state.setFoldingRegions([collapsed]);
        state.goToPosition(52, 0);
        expect(state.scrollTop).toBe(0);

        state.applyRecomputedFoldingRegions([]);

        expect(state.scrollTop).toBe(43);
    });

    it("the selection stays", () => {
        const state = stateWith();
        state.goToPosition(1, 0);
        const selections = state.selections;
        state.revealRangeByType(createRange(50, 0, 50, 0), "top");
        expect(state.selections).toBe(selections);
    });

    it("an unlaid editor does not scroll", () => {
        const height = stateWith();
        height.viewportHeight = 0;
        expect(scrollTopAfter(height, 50, 50, "top")).toBe(0);
        const width = stateWith();
        width.viewportWidth = 0;
        expect(scrollTopAfter(width, 50, 50, "top")).toBe(0);
    });
});
