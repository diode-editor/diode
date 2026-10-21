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
    it("expand идёт вширь по ступеням, shrink — обратно до каретки; за краями — стоим", async () => {
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

    it("выделение — слева направо: anchor в начале ступени, active в конце", async () => {
        const state = makeState(7);
        await new SmartSelectController(state).run(true, HIERARCHY);
        expect(state.selections).toEqual([createSelection(0, 5, 0, 10)]);
    });

    it("посторонняя смена выделения забывает стек — следующий шаг спрашивает заново", async () => {
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

    it("правка документа забывает стек, даже если выделение осталось на месте", async () => {
        const state = makeState(7);
        const controller = new SmartSelectController(state);
        const compute = vi.fn(HIERARCHY);
        await controller.run(true, compute);
        // An edit after the cursor doesn't move the selection: no cursor event, the version catches it.
        state.document.applyEdits([{ range: createRange(0, 17, 0, 17), text: ";" }]);
        await controller.run(true, compute);
        expect(compute).toHaveBeenCalledTimes(2);
    });

    it("правка до первого шага — не помеха: стека ещё нет, забывать нечего", async () => {
        const state = makeState(7);
        state.document.applyEdits([{ range: createRange(0, 17, 0, 17), text: ";" }]);
        await new SmartSelectController(state).run(true, HIERARCHY);
        expect(texts(state)).toEqual(["alpha"]);
    });

    it("ступени внутри текущего выделения пропускаются: первый шаг — шире выделения", async () => {
        const state = makeState(7);
        state.selections = [createSelection(0, 5, 0, 10)];
        await new SmartSelectController(state).run(true, HIERARCHY);
        expect(texts(state)).toEqual(["alpha, beta"]);
    });

    it("ступени только вокруг выделения целиком: уже его и задевшие один край — мимо", async () => {
        const state = makeState(7);
        // active = 16: the word `beta` is inside the selection and doesn't contain its start.
        state.selections = [createSelection(0, 5, 0, 16)];
        await new SmartSelectController(state).run(true, HIERARCHY);
        expect(texts(state)).toEqual([TEXT]);
    });

    it("мультикурсор: каждая каретка — по своей иерархии", async () => {
        const state = makeState(7, 13);
        const controller = new SmartSelectController(state);
        await controller.run(true, HIERARCHY);
        expect(texts(state)).toEqual(["alpha", "beta"]);
    });

    it("ответ протух (каретка ушла, пока считали) или не выровнен по кареткам — шага нет", async () => {
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

    it("протух и при смене числа кареток, одной из них или только anchor", async () => {
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

    it("ступень, равная текущей, проскакивается в обе стороны", async () => {
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
