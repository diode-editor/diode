import { describe, expect, it, vi } from "vitest";

import { createPosition } from "../../common/core/iPosition.ts";
import { createRange, type IRange } from "../../common/core/iRange.ts";
import { createCursorSelection, createSelection, selectionToRange } from "../../common/core/iSelection.ts";
import { TextDocument } from "../../common/model/textDocument.ts";
import { EditorViewState } from "../../common/viewModel/editorViewState.ts";

import { type ComputeSelectionRanges, SmartSelectController } from "./smartSelectController.ts";

const TEXT = "call(alpha, beta)";

function makeState(...cursors: number[]): EditorViewState {
    return new EditorViewState(
        new TextDocument(TEXT),
        cursors.map((character) => createCursorSelection(0, character)),
    );
}

const texts = (state: EditorViewState): string[] =>
    state.selections.map((selection) => state.document.getTextInRange(selectionToRange(selection)));

/** Hierarchy "word → inside parens → call" for any cursor. */
const HIERARCHY: ComputeSelectionRanges = (positions) =>
    Promise.resolve(
        positions.map((position) => {
            const word = position.character < 11 ? createRange(0, 5, 0, 10) : createRange(0, 12, 0, 16);
            return [word, createRange(0, 5, 0, 16), createRange(0, 0, 0, 17)];
        }),
    );

describe("SmartSelectController — Expand/Shrink Selection", () => {
    it("expand widens step by step, shrink goes back to the cursor; past the ends it stays", async () => {
        const state = makeState(7);
        const controller = new SmartSelectController(state);
        const compute = vi.fn(HIERARCHY);

        await controller.run(true, compute);
        expect(texts(state)).toEqual(["alpha"]);
        await controller.run(true, compute);
        expect(texts(state)).toEqual(["alpha, beta"]);
        await controller.run(true, compute);
        await controller.run(true, compute);
        expect(texts(state)).toEqual([TEXT]);

        await controller.run(false, compute);
        expect(texts(state)).toEqual(["alpha, beta"]);
        await controller.run(false, compute);
        await controller.run(false, compute);
        await controller.run(false, compute);
        expect(state.selections).toEqual([createSelection(0, 7, 0, 7)]);
        // The hierarchy is asked once; later steps come from the stack.
        expect(compute).toHaveBeenCalledTimes(1);
        expect(compute).toHaveBeenCalledWith([createPosition(0, 7)]);
    });

    it("selection is left to right: anchor at step start, active at its end", async () => {
        const state = makeState(7);
        await new SmartSelectController(state).run(true, HIERARCHY);
        expect(state.selections).toEqual([createSelection(0, 5, 0, 10)]);
    });

    it("external selection change forgets the stack: the next step asks again", async () => {
        const state = makeState(7);
        const controller = new SmartSelectController(state);
        const compute = vi.fn(HIERARCHY);
        await controller.run(true, compute);
        await controller.run(true, compute);

        state.selections = [createCursorSelection(0, 13)];
        await controller.run(true, compute);
        expect(texts(state)).toEqual(["beta"]);
        expect(compute).toHaveBeenCalledTimes(2);
    });

    it("document edit forgets the stack even if the selection stays in place", async () => {
        const state = makeState(7);
        const controller = new SmartSelectController(state);
        const compute = vi.fn(HIERARCHY);
        await controller.run(true, compute);
        // An edit after the cursor doesn't move the selection: no cursor event, the version catches it.
        state.document.applyEdits([{ range: createRange(0, 17, 0, 17), text: ";" }]);
        await controller.run(true, compute);
        expect(compute).toHaveBeenCalledTimes(2);
    });

    it("edit before the first step is harmless: no stack yet, nothing to forget", async () => {
        const state = makeState(7);
        state.document.applyEdits([{ range: createRange(0, 17, 0, 17), text: ";" }]);
        await new SmartSelectController(state).run(true, HIERARCHY);
        expect(texts(state)).toEqual(["alpha"]);
    });

    it("steps inside the current selection are skipped: the first step is wider than the selection", async () => {
        const state = makeState(7);
        state.selections = [createSelection(0, 5, 0, 10)];
        await new SmartSelectController(state).run(true, HIERARCHY);
        expect(texts(state)).toEqual(["alpha, beta"]);
    });

    it("only steps enclosing the whole selection count: narrower ones and ones touching one edge are skipped", async () => {
        const state = makeState(7);
        // active = 16: the word `beta` is inside the selection and doesn't contain its start.
        state.selections = [createSelection(0, 5, 0, 16)];
        await new SmartSelectController(state).run(true, HIERARCHY);
        expect(texts(state)).toEqual([TEXT]);
    });

    it("multi-cursor: each cursor follows its own hierarchy", async () => {
        const state = makeState(7, 13);
        const controller = new SmartSelectController(state);
        await controller.run(true, HIERARCHY);
        expect(texts(state)).toEqual(["alpha", "beta"]);
    });

    it("stale result (cursor moved while computing) or not aligned with cursors: no step", async () => {
        const state = makeState(7);
        const controller = new SmartSelectController(state);
        await controller.run(true, (positions) => {
            state.selections = [createCursorSelection(0, 2)];
            return HIERARCHY(positions);
        });
        expect(state.selections).toEqual([createCursorSelection(0, 2)]);

        // An edit during computation also makes it stale, even if the selection stays put.
        await controller.run(true, (positions) => {
            state.document.applyEdits([{ range: createRange(0, 17, 0, 17), text: ";" }]);
            return HIERARCHY(positions);
        });
        expect(state.selections).toEqual([createCursorSelection(0, 2)]);

        await controller.run(true, () => Promise.resolve([]));
        await controller.run(true, () => Promise.resolve([[], []]));
        expect(state.selections).toEqual([createCursorSelection(0, 2)]);
    });

    it("stale also when the cursor count, one cursor or only the anchor changes", async () => {
        const changes = [
            [createCursorSelection(0, 7), createCursorSelection(0, 13)],
            [createCursorSelection(0, 7), createCursorSelection(0, 14)],
            [createSelection(0, 6, 0, 13)],
        ];
        for (const [initial, during] of [
            [[createCursorSelection(0, 7)], changes[0]],
            [changes[0], [createCursorSelection(0, 7)]],
            [changes[0], changes[1]],
            [[createCursorSelection(0, 13)], changes[2]],
        ]) {
            const state = new EditorViewState(new TextDocument(TEXT), initial);
            await new SmartSelectController(state).run(true, (positions) => {
                state.selections = during;
                return HIERARCHY(positions);
            });
            expect(state.selections).toEqual(during);
        }
    });

    it("step equal to the current one is skipped in both directions", async () => {
        const state = makeState(7);
        const controller = new SmartSelectController(state);
        const word: IRange = createRange(0, 5, 0, 10);
        const compute: ComputeSelectionRanges = () => Promise.resolve([[word, word, createRange(0, 0, 0, 17)]]);
        await controller.run(true, compute);
        await controller.run(true, compute);
        expect(texts(state)).toEqual([TEXT]);
        await controller.run(false, compute);
        expect(texts(state)).toEqual(["alpha"]);
    });
});
