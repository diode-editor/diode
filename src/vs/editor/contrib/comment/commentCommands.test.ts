import { describe, expect, it } from "vitest";

import { createCursorSelection, createSelection, selectionToRange } from "../../common/core/iSelection.ts";
import { TextDocument } from "../../common/model/textDocument.ts";
import { UndoManager } from "../../common/model/undoManager.ts";
import { EditorViewState } from "../../common/viewModel/editorViewState.ts";

import { addLineComment, removeLineComment, toggleBlockComment, toggleLineComment } from "./commentCommands.ts";

const TS = { lineComment: "//", blockComment: ["/*", "*/"] as const };
const CSS = { blockComment: ["/*", "*/"] as const };
const PYTHON = { lineComment: "#" };

function makeState(text: string, selections = [createCursorSelection(0, 0)]): EditorViewState {
    const state = new EditorViewState(new TextDocument(text), selections);
    state.viewportWidth = 80;
    state.viewportHeight = 20;
    return state;
}

function spans(state: EditorViewState): number[][] {
    return state.selections.map((sel) => [
        sel.anchor.line,
        sel.anchor.character,
        sel.active.line,
        sel.active.character,
    ]);
}

describe("toggleLineComment", () => {
    it("комментирует строку каретки и увозит каретку вместе с текстом", () => {
        const state = makeState("const a = 1;", [createCursorSelection(0, 6)]);
        const element = toggleLineComment(state, TS);

        expect(state.document.getText()).toBe("// const a = 1;");
        expect(spans(state)).toEqual([[0, 9, 0, 9]]);
        expect(element?.label).toBe("toggleLineComment");
    });

    it("повторный toggle возвращает исходный текст", () => {
        const state = makeState("const a = 1;", [createCursorSelection(0, 6)]);
        toggleLineComment(state, TS);
        toggleLineComment(state, TS);
        expect(state.document.getText()).toBe("const a = 1;");
        expect(spans(state)).toEqual([[0, 6, 0, 6]]);
    });

    it("выделение нескольких строк остаётся выделением после toggle", () => {
        const state = makeState("aaa\nbbb\nccc", [createSelection(0, 1, 2, 2)]);
        toggleLineComment(state, TS);

        expect(state.document.getText()).toBe("// aaa\n// bbb\n// ccc");
        expect(spans(state)).toEqual([[0, 4, 2, 5]]);
    });

    it("хвост выделения на колонке 0 не комментирует свою строку", () => {
        const state = makeState("aaa\nbbb\nccc", [createSelection(0, 0, 2, 0)]);
        toggleLineComment(state, TS);
        expect(state.document.getText()).toBe("// aaa\n// bbb\nccc");
    });

    it("мультикурсор: каждое выделение тогглится по СВОЕМУ состоянию", () => {
        const state = makeState("// aaa\nbbb", [createCursorSelection(0, 0), createCursorSelection(1, 0)]);
        toggleLineComment(state, TS);
        expect(state.document.getText()).toBe("aaa\n// bbb");
    });

    it("два курсора на одной строке комментируют её один раз", () => {
        const state = makeState("const a = 1;", [createCursorSelection(0, 1), createCursorSelection(0, 5)]);
        toggleLineComment(state, TS);
        expect(state.document.getText()).toBe("// const a = 1;");
    });

    it("выделения, отданные в обратном документном порядке, обрабатываются как прямые", () => {
        // Мультикурсор не обязан приходить отсортированным (Alt+клик снизу
        // вверх): команда сортирует сама, иначе дедуп строк и сдвиги едут.
        const reversed = makeState("aaa\nbbb\nccc", [
            createCursorSelection(2, 1),
            createCursorSelection(1, 0),
            createCursorSelection(0, 2),
        ]);
        toggleLineComment(reversed, TS);

        expect(reversed.document.getText()).toBe("// aaa\n// bbb\n// ccc");
        expect(spans(reversed)).toEqual([
            [0, 5, 0, 5],
            [1, 0, 1, 0],
            [2, 4, 2, 4],
        ]);
    });

    it("язык без lineComment (CSS) оборачивает содержимое строки блочной парой", () => {
        const state = makeState("    color: red;", [createCursorSelection(0, 6)]);
        const element = toggleLineComment(state, CSS);
        // Фолбэк остаётся шагом «toggle line comment» — им его и звали.
        expect(element?.label).toBe("toggleLineComment");
        expect(state.document.getText()).toBe("    /* color: red; */");

        toggleLineComment(state, CSS);
        expect(state.document.getText()).toBe("    color: red;");
    });

    it("язык вовсе без секции comments — no-op даже у toggle", () => {
        const state = makeState("aaa");
        expect(toggleLineComment(state, {})).toBeUndefined();
        expect(state.document.getText()).toBe("aaa");
    });

    it("read-only: правок и undo-элемента нет", () => {
        const state = makeState("aaa");
        state.readOnly = true;
        expect(toggleLineComment(state, TS)).toBeUndefined();
        expect(state.document.getText()).toBe("aaa");
    });

    it("undo восстанавливает и текст, и выделения", () => {
        const state = makeState("aaa\nbbb", [createSelection(0, 1, 1, 2)]);
        const undoManager = new UndoManager(state.document);
        const element = toggleLineComment(state, TS);
        expect(element).toBeDefined();
        if (element) undoManager.pushUndoElement(element);

        undoManager.undo(state);
        expect(state.document.getText()).toBe("aaa\nbbb");
        expect(spans(state)).toEqual([[0, 1, 1, 2]]);
    });
});

describe("addLineComment / removeLineComment", () => {
    it("add на закомментированной строке добавляет второй маркер, remove снимает один", () => {
        const state = makeState("// aaa");
        const added = addLineComment(state, TS);
        expect(state.document.getText()).toBe("// // aaa");
        const removed = removeLineComment(state, TS);
        expect(state.document.getText()).toBe("// aaa");
        // Метка шага истории — что покажет «Undo …» и по чему шаги различают в стеке.
        expect(added?.label).toBe("addLineComment");
        expect(removed?.label).toBe("removeLineComment");
    });

    it("без lineComment оба — no-op (фолбэк только у toggle)", () => {
        const state = makeState("aaa");
        expect(addLineComment(state, CSS)).toBeUndefined();
        expect(removeLineComment(state, CSS)).toBeUndefined();
        expect(state.document.getText()).toBe("aaa");
    });

    it("remove на чистых строках — no-op", () => {
        const state = makeState("aaa");
        expect(removeLineComment(state, PYTHON)).toBeUndefined();
    });
});

describe("toggleBlockComment", () => {
    it("оборачивает выделение парой и оставляет выделение на тексте", () => {
        const state = makeState("const a = 1;", [createSelection(0, 6, 0, 7)]);
        const element = toggleBlockComment(state, TS);

        expect(element?.label).toBe("blockComment");
        expect(state.document.getText()).toBe("const /* a */ = 1;");
        expect(spans(state)).toEqual([[0, 9, 0, 10]]);
        expect(state.document.getTextInRange(selectionToRange(state.selections[0]))).toBe("a");
    });

    it("повторный toggle снимает пару", () => {
        const state = makeState("const a = 1;", [createSelection(0, 6, 0, 7)]);
        toggleBlockComment(state, TS);
        toggleBlockComment(state, TS);
        expect(state.document.getText()).toBe("const a = 1;");
        expect(spans(state)).toEqual([[0, 6, 0, 7]]);
    });

    it("пустое выделение вставляет пару с кареткой между пробелами", () => {
        const state = makeState("ab", [createCursorSelection(0, 1)]);
        toggleBlockComment(state, TS);
        expect(state.document.getText()).toBe("a/*  */b");
        expect(spans(state)).toEqual([[0, 4, 0, 4]]);
    });

    it("два выделения на одной строке: правки первого сдвигают выделение второго", () => {
        const state = makeState("aa bb", [createSelection(0, 0, 0, 2), createSelection(0, 3, 0, 5)]);
        toggleBlockComment(state, TS);
        expect(state.document.getText()).toBe("/* aa */ /* bb */");
        expect(state.document.getTextInRange(selectionToRange(state.selections[0]))).toBe("aa");
        expect(state.document.getTextInRange(selectionToRange(state.selections[1]))).toBe("bb");
    });

    it("снятие двух пар на одной строке: правки первой сдвигают вторую", () => {
        const state = makeState("/* aa */ /* bb */", [createSelection(0, 0, 0, 8), createSelection(0, 9, 0, 17)]);
        toggleBlockComment(state, TS);

        expect(state.document.getText()).toBe("aa bb");
        expect(state.document.getTextInRange(selectionToRange(state.selections[0]))).toBe("aa");
        expect(state.document.getTextInRange(selectionToRange(state.selections[1]))).toBe("bb");
    });

    it("выделения одной строки в обратном порядке дают тот же результат, что прямые", () => {
        // Сдвиг от правок соседа считается в документном порядке — команда
        // обязана отсортировать выделения сама.
        const state = makeState("aa bb", [createSelection(0, 3, 0, 5), createSelection(0, 0, 0, 2)]);
        toggleBlockComment(state, TS);

        expect(state.document.getText()).toBe("/* aa */ /* bb */");
        // Без сортировки сдвиг от правок соседа лёг бы не на то выделение:
        // порядок здесь документный, и тексты обязаны совпасть поштучно.
        const texts = state.selections.map((sel) => state.document.getTextInRange(selectionToRange(sel)));
        expect(texts).toEqual(["aa", "bb"]);
    });

    it("undo блочного комментария возвращает текст и выделение", () => {
        const state = makeState("const a = 1;", [createSelection(0, 6, 0, 7)]);
        const undoManager = new UndoManager(state.document);
        const element = toggleBlockComment(state, TS);
        if (element) undoManager.pushUndoElement(element);

        undoManager.undo(state);
        expect(state.document.getText()).toBe("const a = 1;");
        expect(spans(state)).toEqual([[0, 6, 0, 7]]);
    });

    it("язык без блочной пары — no-op", () => {
        const state = makeState("aaa", [createSelection(0, 0, 0, 3)]);
        expect(toggleBlockComment(state, PYTHON)).toBeUndefined();
        expect(state.document.getText()).toBe("aaa");
    });

    it("read-only — no-op", () => {
        const state = makeState("aaa", [createSelection(0, 0, 0, 3)]);
        state.readOnly = true;
        expect(toggleBlockComment(state, TS)).toBeUndefined();
        expect(state.document.getText()).toBe("aaa");
    });
});
