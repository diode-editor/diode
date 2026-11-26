import { describe, expect, it } from "vitest";

import { createFoldingRegion } from "../../contrib/folding/iFoldingRegion.ts";
import { createRange } from "../core/iRange.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

/** Line `i` is `line i`, so its length is 6 for one digit and 7 for two. */
function stateOf(lineCount: number, viewportHeight: number): EditorViewState {
    const text = Array.from({ length: lineCount }, (_, i) => `line ${String(i)}`).join("\n");
    const state = new EditorViewState(new TextDocument(text));
    state.viewportHeight = viewportHeight;
    return state;
}

describe("EditorViewState.getVisibleRanges", () => {
    it("is the lines on screen, from the start of the first to the end of the last", () => {
        const state = stateOf(30, 5);
        state.scrollTop = 10;

        expect(state.getVisibleRanges()).toEqual([createRange(10, 0, 14, 7)]);
    });

    it("stops at the end of a document shorter than the viewport", () => {
        const state = stateOf(3, 10);

        expect(state.getVisibleRanges()).toEqual([createRange(0, 0, 2, 6)]);
    });

    it("splits around a collapsed fold and leaves its body out", () => {
        const state = stateOf(30, 6);
        state.setFoldingRegions([createFoldingRegion(2, 5)]);
        state.toggleFold(2);

        // Rows: 0 1 2 6 7 8 — lines 3..5 are under the fold.
        expect(state.getVisibleRanges()).toEqual([createRange(0, 0, 2, 6), createRange(6, 0, 8, 6)]);
    });

    it("keeps one range when a fold is expanded", () => {
        const state = stateOf(30, 6);
        state.setFoldingRegions([createFoldingRegion(2, 5)]);

        expect(state.getVisibleRanges()).toEqual([createRange(0, 0, 5, 6)]);
    });

    it("keeps one range across a view zone", () => {
        const state = stateOf(30, 6);
        state.setViewZones([{ afterLine: 1, size: 2 }]);

        // Rows: 0 1 zone zone 2 3.
        expect(state.getVisibleRanges()).toEqual([createRange(0, 0, 3, 6)]);
    });

    it("skips view zone rows at the top", () => {
        const state = stateOf(30, 3);
        state.setViewZones([{ afterLine: -1, size: 1 }]);

        expect(state.getVisibleRanges()).toEqual([createRange(0, 0, 1, 6)]);
    });

    describe("with word wrap", () => {
        /** Line 1 wraps into three rows at width 10. */
        function wrapped(): EditorViewState {
            const state = new EditorViewState(new TextDocument("a\nbbbbbbbbb bbbbbbbbb bbbbbbbbb\nc\nd\ne\nf"));
            state.viewportWidth = 10;
            state.wordWrap = "on";
            state.viewportHeight = 3;
            return state;
        }

        it("leaves out a line cut by the bottom edge", () => {
            const state = wrapped();

            expect(state.getVisibleRanges()).toEqual([createRange(0, 0, 0, 1)]);
        });

        it("leaves out a line cut by the top edge", () => {
            const state = wrapped();
            state.scrollTop = 2;

            // Rows: b-tail(2) b-tail(3) c(4).
            expect(state.getVisibleRanges()).toEqual([createRange(2, 0, 2, 1)]);
        });

        it("takes the line at the top when none fits whole", () => {
            const state = wrapped();
            state.viewportHeight = 2;
            state.scrollTop = 1;

            expect(state.getVisibleRanges()).toEqual([createRange(1, 0, 1, 29)]);
        });

        it("includes a wrapped line that fits whole", () => {
            const state = wrapped();
            state.viewportHeight = 5;

            expect(state.getVisibleRanges()).toEqual([createRange(0, 0, 2, 1)]);
        });
    });

    it("treats a zero-height viewport as one row", () => {
        const state = stateOf(30, 0);
        state.scrollTop = 4;

        expect(state.getVisibleRanges()).toEqual([createRange(4, 0, 4, 6)]);
    });
});
