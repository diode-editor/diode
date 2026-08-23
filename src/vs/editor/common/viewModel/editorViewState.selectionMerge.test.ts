import { describe, expect, it } from "vitest";

import { createCursorSelection, createSelection } from "../core/iSelection.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

describe("EditorViewState.selections — нормализация в сеттере", () => {
    it("геттер отдаёт выделения в документном порядке, как бы их ни присвоили", () => {
        const state = new EditorViewState(new TextDocument("aaa\nbbb\nccc"));
        state.selections = [createCursorSelection(2, 0), createCursorSelection(0, 0), createCursorSelection(1, 0)];
        expect(state.selections.map((sel) => sel.active.line)).toEqual([0, 1, 2]);
    });

    it("конструктор нормализует стартовые выделения", () => {
        const state = new EditorViewState(new TextDocument("aaa\nbbb"), [
            createCursorSelection(1, 0),
            createCursorSelection(0, 0),
        ]);
        expect(state.selections.map((sel) => sel.active.line)).toEqual([0, 1]);
    });

    it("присваивание файрит cursor-change РОВНО один раз, уже с финальным набором", () => {
        const state = new EditorViewState(new TextDocument("abcdef"));
        const seen: number[] = [];
        state.onDidChangeCursorPosition(() => {
            seen.push(state.selections.length);
        });

        state.selections = [createCursorSelection(0, 3), createCursorSelection(0, 3), createCursorSelection(0, 5)];

        // Одно событие, и слушатель уже видит слитый набор — не промежуточный.
        expect(seen).toEqual([2]);
    });

    it("дубликаты схлопываются при присваивании", () => {
        const state = new EditorViewState(new TextDocument("abcdef"));
        state.selections = [createCursorSelection(0, 2), createCursorSelection(0, 2)];
        expect(state.selections).toHaveLength(1);
    });

    it("каретка внутри выделения растворяется в нём", () => {
        const state = new EditorViewState(new TextDocument("abcdef"));
        state.selections = [createSelection(0, 1, 0, 5), createCursorSelection(0, 3)];
        expect(state.selections).toHaveLength(1);
        expect(state.selections[0].anchor).toEqual({ line: 0, character: 1 });
        expect(state.selections[0].active).toEqual({ line: 0, character: 5 });
    });
});

describe("EditorViewState — слияние по ходу навигации и правок", () => {
    it("cursorTop сводит все каретки в одну", () => {
        const doc = new TextDocument("aaa\nbbb\nccc");
        const state = new EditorViewState(doc, [
            createCursorSelection(0, 1),
            createCursorSelection(1, 1),
            createCursorSelection(2, 1),
        ]);
        state.cursorTop();
        expect(state.selections).toHaveLength(1);
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("cursorBottom сводит все каретки в одну", () => {
        const doc = new TextDocument("aaa\nbbb");
        const state = new EditorViewState(doc, [createCursorSelection(0, 0), createCursorSelection(1, 0)]);
        state.cursorBottom();
        expect(state.selections).toHaveLength(1);
        expect(state.selections[0].active).toEqual({ line: 1, character: 3 });
    });

    it("cursorHome сводит две каретки одной строки в одну", () => {
        const doc = new TextDocument("hello");
        const state = new EditorViewState(doc, [createCursorSelection(0, 2), createCursorSelection(0, 4)]);
        state.cursorHome();
        expect(state.selections).toHaveLength(1);
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("cursorLeft у соседних кареток схлопывает их, когда они встречаются", () => {
        const doc = new TextDocument("abc");
        const state = new EditorViewState(doc, [createCursorSelection(0, 0), createCursorSelection(0, 1)]);
        state.cursorLeft();
        // Левая упирается в начало строки и стоит, правая приезжает в ту же точку.
        expect(state.selections).toHaveLength(1);
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("правка, сводящая каретки в одну точку, оставляет один курсор", () => {
        const doc = new TextDocument("abc");
        const state = new EditorViewState(doc, [createCursorSelection(0, 1), createCursorSelection(0, 2)]);
        state.deleteLeft();
        expect(doc.getText()).toBe("c");
        expect(state.selections).toHaveLength(1);
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("undo-элемент несёт уже слитый afterSelections — redo не воскрешает дубли", () => {
        const doc = new TextDocument("abc");
        const state = new EditorViewState(doc, [createCursorSelection(0, 1), createCursorSelection(0, 2)]);
        const element = state.deleteLeft();
        expect(element?.beforeSelections).toHaveLength(2);
        expect(element?.afterSelections).toHaveLength(1);
    });

    it("restoreSelections нормализует снимок", () => {
        const doc = new TextDocument("abcdef");
        const state = new EditorViewState(doc);
        state.restoreSelections([createCursorSelection(0, 4), createCursorSelection(0, 4)]);
        expect(state.selections).toHaveLength(1);
    });
});
