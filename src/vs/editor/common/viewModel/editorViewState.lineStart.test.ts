import { describe, expect, it } from "vitest";

import { createCursorSelection, createSelection } from "../core/iSelection.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

// Мак-команды «до начала строки»: Ctrl+A (cursorLineStart) и Cmd+Backspace
// (deleteAllLeft). В отличие от smart-home, отступ не учитывается.

describe("EditorViewState.cursorLineStart", () => {
    it("идёт в колонку 0 сразу, минуя отступ", () => {
        const state = new EditorViewState(new TextDocument("    hello"), [createCursorSelection(0, 7)]);
        state.cursorLineStart();
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
        state.cursorLineStart(); // повторно — остаётся на месте (не smart-home toggle)
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("в режиме выделения тянет выделение от якоря", () => {
        const state = new EditorViewState(new TextDocument("    hello"), [createCursorSelection(0, 7)]);
        state.cursorLineStart(true);
        expect(state.selections[0].anchor).toEqual({ line: 0, character: 7 });
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("на продолжении перенесённой строки — начало фрагмента", () => {
        const state = new EditorViewState(new TextDocument("aaaa bbbb cccc"), [createCursorSelection(0, 12)]);
        state.viewportWidth = 10;
        state.wordWrap = "on";
        state.cursorLineStart();
        expect(state.selections[0].active).toEqual({ line: 0, character: 10 });
    });
});

describe("EditorViewState.deleteAllLeft", () => {
    it("удаляет всё левее курсора до начала строки, включая отступ", () => {
        const doc = new TextDocument("    hello world");
        const state = new EditorViewState(doc, [createCursorSelection(0, 10)]);
        const undo = state.deleteAllLeft();
        expect(doc.getText()).toBe("world");
        expect(undo?.label).toBe("deleteAllLeft");
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("в колонке 0 склеивает с предыдущей строкой", () => {
        const doc = new TextDocument("hello\nworld");
        const state = new EditorViewState(doc, [createCursorSelection(1, 0)]);
        state.deleteAllLeft();
        expect(doc.getText()).toBe("helloworld");
    });

    it("выделение удаляется как есть", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc, [createSelection(0, 2, 0, 5)]);
        state.deleteAllLeft();
        expect(doc.getText()).toBe("he world");
    });

    it("в начале документа — no-op без undo-элемента", () => {
        const doc = new TextDocument("hello");
        const state = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        expect(state.deleteAllLeft()).toBeUndefined();
        expect(doc.getText()).toBe("hello");
    });
});
