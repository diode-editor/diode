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

/** Иерархия «слово → внутри скобок → вызов» для любой каретки. */
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
        // Иерархию спросили один раз: дальше — по стеку.
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
        state.document.applyEdits([{ range: createRange(0, 17, 0, 17), text: ";" }]);
        state.selections = [createSelection(0, 5, 0, 10)];
        // Подписка снята ещё на смене выделения; версия — вторая линия.
        await controller.run(true, compute);
        expect(compute).toHaveBeenCalledTimes(2);
    });

    it("ступени внутри текущего выделения пропускаются: первый шаг — шире выделения", async () => {
        const state = makeState(7);
        state.selections = [createSelection(0, 5, 0, 10)];
        await new SmartSelectController(state).run(true, HIERARCHY);
        expect(texts(state)).toEqual(["alpha, beta"]);
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

        await controller.run(true, () => Promise.resolve([]));
        await controller.run(true, () => Promise.resolve([[], []]));
        expect(state.selections).toEqual([createCursorSelection(0, 2)]);
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
