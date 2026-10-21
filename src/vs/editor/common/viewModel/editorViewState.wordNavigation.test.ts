import { describe, expect, it } from "vitest";

import { createCursorSelection, createSelection } from "../core/iSelection.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

describe("EditorViewState.cursorWordLeft", () => {
    it("moves to the start of the current word", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc, [createCursorSelection(0, 8)]);
        state.cursorWordLeft();
        expect(state.selections[0].active).toEqual({ line: 0, character: 6 });
    });

    it("skips whitespace then word characters", () => {
        const doc = new TextDocument("hello   world");
        const state = new EditorViewState(doc, [createCursorSelection(0, 8)]);
        state.cursorWordLeft();
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("stops at punctuation boundary", () => {
        const doc = new TextDocument("foo.bar");
        const state = new EditorViewState(doc, [createCursorSelection(0, 7)]);
        state.cursorWordLeft();
        expect(state.selections[0].active).toEqual({ line: 0, character: 4 });
    });

    it("moves from punctuation to end of preceding word", () => {
        const doc = new TextDocument("foo.bar");
        const state = new EditorViewState(doc, [createCursorSelection(0, 4)]);
        state.cursorWordLeft();
        expect(state.selections[0].active).toEqual({ line: 0, character: 3 });
    });

    it("wraps to end of previous line at line start", () => {
        const doc = new TextDocument("hello\nworld");
        const state = new EditorViewState(doc, [createCursorSelection(1, 0)]);
        state.cursorWordLeft();
        expect(state.selections[0].active).toEqual({ line: 0, character: 5 });
    });

    it("stays at document start", () => {
        const doc = new TextDocument("hello");
        const state = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        state.cursorWordLeft();
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("moves to 0 from within first word", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc, [createCursorSelection(0, 3)]);
        state.cursorWordLeft();
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("with selection mode creates selection", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc, [createCursorSelection(0, 8)]);
        state.cursorWordLeft(true);
        expect(state.selections[0].anchor).toEqual({ line: 0, character: 8 });
        expect(state.selections[0].active).toEqual({ line: 0, character: 6 });
    });

    it("handles multiple spaces between words", () => {
        const doc = new TextDocument("a    b");
        const state = new EditorViewState(doc, [createCursorSelection(0, 5)]);
        state.cursorWordLeft();
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("extends existing selection further left on second call", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc, [createCursorSelection(0, 11)]);
        state.cursorWordLeft(true);
        expect(state.selections[0].anchor).toEqual({ line: 0, character: 11 });
        expect(state.selections[0].active).toEqual({ line: 0, character: 6 });
        state.cursorWordLeft(true);
        expect(state.selections[0].anchor).toEqual({ line: 0, character: 11 });
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("shrinks a rightward selection when moving left", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc, [createSelection(0, 0, 0, 6)]);
        state.cursorWordLeft(true);
        expect(state.selections[0].anchor).toEqual({ line: 0, character: 0 });
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
    });
});

describe("EditorViewState.cursorWordRight", () => {
    it("moves to the end of the current word and past whitespace", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        state.cursorWordRight();
        expect(state.selections[0].active).toEqual({ line: 0, character: 6 });
    });

    it("moves from middle of word to next word boundary", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc, [createCursorSelection(0, 2)]);
        state.cursorWordRight();
        expect(state.selections[0].active).toEqual({ line: 0, character: 6 });
    });

    it("stops at punctuation boundary", () => {
        const doc = new TextDocument("foo.bar");
        const state = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        state.cursorWordRight();
        expect(state.selections[0].active).toEqual({ line: 0, character: 3 });
    });

    it("moves from punctuation to start of next word", () => {
        const doc = new TextDocument("foo.bar");
        const state = new EditorViewState(doc, [createCursorSelection(0, 3)]);
        state.cursorWordRight();
        expect(state.selections[0].active).toEqual({ line: 0, character: 4 });
    });

    it("wraps to start of next line at line end", () => {
        const doc = new TextDocument("hello\nworld");
        const state = new EditorViewState(doc, [createCursorSelection(0, 5)]);
        state.cursorWordRight();
        expect(state.selections[0].active).toEqual({ line: 1, character: 0 });
    });

    it("stays at document end", () => {
        const doc = new TextDocument("hello");
        const state = new EditorViewState(doc, [createCursorSelection(0, 5)]);
        state.cursorWordRight();
        expect(state.selections[0].active).toEqual({ line: 0, character: 5 });
    });

    it("with selection mode creates selection", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        state.cursorWordRight(true);
        expect(state.selections[0].anchor).toEqual({ line: 0, character: 0 });
        expect(state.selections[0].active).toEqual({ line: 0, character: 6 });
    });

    it("handles multiple spaces between words", () => {
        const doc = new TextDocument("a    b");
        const state = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        state.cursorWordRight();
        expect(state.selections[0].active).toEqual({ line: 0, character: 5 });
    });

    it("extends existing selection further right on second call", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        state.cursorWordRight(true);
        expect(state.selections[0].anchor).toEqual({ line: 0, character: 0 });
        expect(state.selections[0].active).toEqual({ line: 0, character: 6 });
        state.cursorWordRight(true);
        expect(state.selections[0].anchor).toEqual({ line: 0, character: 0 });
        expect(state.selections[0].active).toEqual({ line: 0, character: 11 });
    });

    it("shrinks a leftward selection when moving right", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc, [createSelection(0, 6, 0, 0)]);
        state.cursorWordRight(true);
        expect(state.selections[0].anchor).toEqual({ line: 0, character: 6 });
        expect(state.selections[0].active).toEqual({ line: 0, character: 6 });
    });
});

describe("EditorViewState.deleteWordLeft", () => {
    it("deletes the word to the left of cursor", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc, [createCursorSelection(0, 11)]);
        state.deleteWordLeft();
        expect(doc.getText()).toBe("hello ");
    });

    it("deletes word and whitespace to the left", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc, [createCursorSelection(0, 6)]);
        state.deleteWordLeft();
        expect(doc.getText()).toBe("world");
    });

    it("merges with previous line at line start", () => {
        const doc = new TextDocument("hello\nworld");
        const state = new EditorViewState(doc, [createCursorSelection(1, 0)]);
        state.deleteWordLeft();
        expect(doc.getText()).toBe("helloworld");
    });

    it("no-op at document start", () => {
        const doc = new TextDocument("hello");
        const state = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        const result = state.deleteWordLeft();
        expect(result).toBeUndefined();
        expect(doc.getText()).toBe("hello");
    });

    it("deletes selection instead of word when selection exists", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc, [createSelection(0, 2, 0, 5)]);
        state.deleteWordLeft();
        expect(doc.getText()).toBe("he world");
    });

    it("returns IUndoElement on success", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc, [createCursorSelection(0, 5)]);
        const result = state.deleteWordLeft();
        expect(result).toBeDefined();
        expect(result!.label).toBe("deleteWordLeft");
    });
});

describe("EditorViewState.deleteWordRight", () => {
    it("deletes the word to the right of cursor and trailing whitespace", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        state.deleteWordRight();
        expect(doc.getText()).toBe("world");
    });

    it("deletes word and whitespace to the right", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc, [createCursorSelection(0, 5)]);
        state.deleteWordRight();
        expect(doc.getText()).toBe("helloworld");
    });

    it("merges with next line at line end", () => {
        const doc = new TextDocument("hello\nworld");
        const state = new EditorViewState(doc, [createCursorSelection(0, 5)]);
        state.deleteWordRight();
        expect(doc.getText()).toBe("helloworld");
    });

    it("no-op at document end", () => {
        const doc = new TextDocument("hello");
        const state = new EditorViewState(doc, [createCursorSelection(0, 5)]);
        const result = state.deleteWordRight();
        expect(result).toBeUndefined();
        expect(doc.getText()).toBe("hello");
    });

    it("deletes selection instead of word when selection exists", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc, [createSelection(0, 2, 0, 5)]);
        state.deleteWordRight();
        expect(doc.getText()).toBe("he world");
    });

    it("returns IUndoElement on success", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        const result = state.deleteWordRight();
        expect(result).toBeDefined();
        expect(result!.label).toBe("deleteWordRight");
    });
});
