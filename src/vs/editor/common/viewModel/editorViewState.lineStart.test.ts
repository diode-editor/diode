import { describe, expect, it } from "vitest";

import { createCursorSelection, createSelection } from "../core/iSelection.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

describe("EditorViewState.cursorLineStart", () => {
    it("goes straight to column 0, skipping indentation", () => {
        const state = new EditorViewState(new TextDocument("    hello"), [createCursorSelection(0, 7)]);
        state.cursorLineStart();
        expect(state.selections[0].anchor).toEqual({ line: 0, character: 0 });
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
        state.cursorLineStart(); // again — stays put (no smart-home toggle)
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("reveals the cursor: horizontal scroll of a long line resets", () => {
        const state = new EditorViewState(new TextDocument("x".repeat(100)), [createCursorSelection(0, 100)]);
        state.viewportWidth = 20;
        state.cursorEnd();
        expect(state.scrollLeft).toBeGreaterThan(0);
        state.cursorLineStart();
        expect(state.scrollLeft).toBe(0);
    });

    it("in selection mode extends the selection from the anchor", () => {
        const state = new EditorViewState(new TextDocument("    hello"), [createCursorSelection(0, 7)]);
        state.cursorLineStart(true);
        expect(state.selections[0].anchor).toEqual({ line: 0, character: 7 });
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("on a wrapped line continuation — start of the fragment", () => {
        const state = new EditorViewState(new TextDocument("aaaa bbbb cccc"), [createCursorSelection(0, 12)]);
        state.viewportWidth = 10;
        state.wordWrap = "on";
        state.cursorLineStart();
        expect(state.selections[0].active).toEqual({ line: 0, character: 10 });
    });
});

describe("EditorViewState.deleteAllLeft", () => {
    it("deletes everything left of the cursor to line start, indentation included", () => {
        const doc = new TextDocument("    hello world");
        const state = new EditorViewState(doc, [createCursorSelection(0, 10)]);
        const undo = state.deleteAllLeft();
        expect(doc.getText()).toBe("world");
        expect(undo?.label).toBe("deleteAllLeft");
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("at column 0 joins with the previous line", () => {
        const doc = new TextDocument("hello\nworld");
        const state = new EditorViewState(doc, [createCursorSelection(1, 0)]);
        state.deleteAllLeft();
        expect(doc.getText()).toBe("helloworld");
    });

    it("a selection is deleted as is", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc, [createSelection(0, 2, 0, 5)]);
        state.deleteAllLeft();
        expect(doc.getText()).toBe("he world");
    });

    it("at document start — no-op without an undo element", () => {
        const doc = new TextDocument("hello");
        const state = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        expect(state.deleteAllLeft()).toBeUndefined();
        expect(doc.getText()).toBe("hello");
    });
});
