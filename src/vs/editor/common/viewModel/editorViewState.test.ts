import { describe, expect, it } from "vitest";

import { createCursorSelection, createSelection } from "../core/iSelection.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

describe("EditorViewState", () => {
    it("initializes with default cursor at 0,0", () => {
        const doc = new TextDocument("hello");
        const state = new EditorViewState(doc);
        expect(state.selections).toHaveLength(1);
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
        expect(state.scrollLeft).toBe(0);
        expect(state.scrollTop).toBe(0);
    });

    it("initializes with provided selections", () => {
        const doc = new TextDocument("hello");
        const state = new EditorViewState(doc, [createCursorSelection(0, 3)]);
        expect(state.selections[0].active).toEqual({ line: 0, character: 3 });
    });

    describe("onDidChangeCursorPosition", () => {
        it("fires on cursor movement, typing and direct assignment", () => {
            const doc = new TextDocument("hello");
            const state = new EditorViewState(doc, [createCursorSelection(0, 0)]);
            let count = 0;
            state.onDidChangeCursorPosition(() => count++);

            state.cursorRight();
            expect(count).toBe(1);

            state.type("x");
            expect(count).toBe(2);

            state.selections = [createCursorSelection(0, 0)];
            expect(count).toBe(3);
        });

        it("stops firing after the listener is disposed", () => {
            const doc = new TextDocument("hello");
            const state = new EditorViewState(doc, [createCursorSelection(0, 0)]);
            let count = 0;
            const sub = state.onDidChangeCursorPosition(() => count++);

            state.cursorRight();
            expect(count).toBe(1);

            sub.dispose();
            sub.dispose(); // idempotent — disposing again is a no-op
            state.cursorRight();
            expect(count).toBe(1);
        });
    });

    it("types a single character", () => {
        const doc = new TextDocument("hello");
        const state = new EditorViewState(doc, [createCursorSelection(0, 5)]);
        state.type("!");
        expect(doc.getText()).toBe("hello!");
        expect(state.selections[0].active).toEqual({ line: 0, character: 6 });
    });

    it("types text in the middle of a line", () => {
        const doc = new TextDocument("hllo");
        const state = new EditorViewState(doc, [createCursorSelection(0, 1)]);
        state.type("e");
        expect(doc.getText()).toBe("hello");
        expect(state.selections[0].active).toEqual({ line: 0, character: 2 });
    });

    it("types multi-character text", () => {
        const doc = new TextDocument("");
        const state = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        state.type("hello world");
        expect(doc.getText()).toBe("hello world");
        expect(state.selections[0].active).toEqual({ line: 0, character: 11 });
    });

    it("inserts a newline", () => {
        const doc = new TextDocument("helloworld");
        const state = new EditorViewState(doc, [createCursorSelection(0, 5)]);
        state.insertNewLine();
        expect(doc.getText()).toBe("hello\nworld");
        expect(state.selections[0].active).toEqual({ line: 1, character: 0 });
    });

    it("types multi-line text", () => {
        const doc = new TextDocument("");
        const state = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        state.type("aaa\nbbb\nccc");
        expect(doc.getText()).toBe("aaa\nbbb\nccc");
        expect(state.selections[0].active).toEqual({ line: 2, character: 3 });
    });

    it("replaces selected text with typed character", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc, [createSelection(0, 6, 0, 11)]);
        state.type("universe");
        expect(doc.getText()).toBe("hello universe");
        expect(state.selections[0].active).toEqual({ line: 0, character: 14 });
    });

    it("replaces multi-line selection with text", () => {
        const doc = new TextDocument("aaa\nbbb\nccc");
        const state = new EditorViewState(doc, [createSelection(0, 1, 2, 1)]);
        state.type("X");
        expect(doc.getText()).toBe("aXcc");
        expect(state.selections[0].active).toEqual({ line: 0, character: 2 });
    });

    it("types with two cursors on the same line", () => {
        const doc = new TextDocument("aabb");
        const state = new EditorViewState(doc, [createCursorSelection(0, 2), createCursorSelection(0, 0)]);
        state.type("X");
        expect(doc.getText()).toBe("XaaXbb");
        expect(state.selections).toHaveLength(2);
        expect(state.selections[0].active).toEqual({ line: 0, character: 1 });
        expect(state.selections[1].active).toEqual({ line: 0, character: 4 });
    });

    it("types with cursors on different lines", () => {
        const doc = new TextDocument("aaa\nbbb");
        const state = new EditorViewState(doc, [createCursorSelection(0, 3), createCursorSelection(1, 3)]);
        state.type("!");
        expect(doc.getText()).toBe("aaa!\nbbb!");
        expect(state.selections[0].active).toEqual({ line: 0, character: 4 });
        expect(state.selections[1].active).toEqual({ line: 1, character: 4 });
    });

    it("deletes one character to the left (backspace)", () => {
        const doc = new TextDocument("hello");
        const state = new EditorViewState(doc, [createCursorSelection(0, 5)]);
        state.deleteLeft();
        expect(doc.getText()).toBe("hell");
        expect(state.selections[0].active).toEqual({ line: 0, character: 4 });
    });

    it("merges lines on backspace at line start", () => {
        const doc = new TextDocument("hello\nworld");
        const state = new EditorViewState(doc, [createCursorSelection(1, 0)]);
        state.deleteLeft();
        expect(doc.getText()).toBe("helloworld");
        expect(state.selections[0].active).toEqual({ line: 0, character: 5 });
    });

    it("does nothing on backspace at document start", () => {
        const doc = new TextDocument("hello");
        const state = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        state.deleteLeft();
        expect(doc.getText()).toBe("hello");
    });

    it("deletes selection on backspace (non-collapsed)", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc, [createSelection(0, 0, 0, 5)]);
        state.deleteLeft();
        expect(doc.getText()).toBe(" world");
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("deletes one character to the right (delete)", () => {
        const doc = new TextDocument("hello");
        const state = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        state.deleteRight();
        expect(doc.getText()).toBe("ello");
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("merges lines on delete at line end", () => {
        const doc = new TextDocument("hello\nworld");
        const state = new EditorViewState(doc, [createCursorSelection(0, 5)]);
        state.deleteRight();
        expect(doc.getText()).toBe("helloworld");
        expect(state.selections[0].active).toEqual({ line: 0, character: 5 });
    });

    it("does nothing on delete at document end", () => {
        const doc = new TextDocument("hello");
        const state = new EditorViewState(doc, [createCursorSelection(0, 5)]);
        state.deleteRight();
        expect(doc.getText()).toBe("hello");
    });

    it("deletes selection on delete key (non-collapsed)", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc, [createSelection(0, 5, 0, 11)]);
        state.deleteRight();
        expect(doc.getText()).toBe("hello");
        expect(state.selections[0].active).toEqual({ line: 0, character: 5 });
    });

    it("multi-cursor deleteLeft", () => {
        const doc = new TextDocument("aXbX");
        const state = new EditorViewState(doc, [createCursorSelection(0, 2), createCursorSelection(0, 4)]);
        state.deleteLeft();
        // Deletes 'X' at index 1 (left of cursor@2) and 'X' at index 3 (left of cursor@4)
        expect(doc.getText()).toBe("ab");
    });

    it("moves cursor left within a line", () => {
        const doc = new TextDocument("hello");
        const state = new EditorViewState(doc, [createCursorSelection(0, 3)]);
        state.cursorLeft();
        expect(state.selections[0].active).toEqual({ line: 0, character: 2 });
    });

    it("wraps cursor left to end of previous line", () => {
        const doc = new TextDocument("hello\nworld");
        const state = new EditorViewState(doc, [createCursorSelection(1, 0)]);
        state.cursorLeft();
        expect(state.selections[0].active).toEqual({ line: 0, character: 5 });
    });

    it("does not move cursor left past document start", () => {
        const doc = new TextDocument("hello");
        const state = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        state.cursorLeft();
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("moves cursor right within a line", () => {
        const doc = new TextDocument("hello");
        const state = new EditorViewState(doc, [createCursorSelection(0, 2)]);
        state.cursorRight();
        expect(state.selections[0].active).toEqual({ line: 0, character: 3 });
    });

    it("wraps cursor right to start of next line", () => {
        const doc = new TextDocument("hello\nworld");
        const state = new EditorViewState(doc, [createCursorSelection(0, 5)]);
        state.cursorRight();
        expect(state.selections[0].active).toEqual({ line: 1, character: 0 });
    });

    it("does not move cursor right past document end", () => {
        const doc = new TextDocument("hello");
        const state = new EditorViewState(doc, [createCursorSelection(0, 5)]);
        state.cursorRight();
        expect(state.selections[0].active).toEqual({ line: 0, character: 5 });
    });

    it("moves cursor up one line", () => {
        const doc = new TextDocument("hello\nworld");
        const state = new EditorViewState(doc, [createCursorSelection(1, 3)]);
        state.cursorUp();
        expect(state.selections[0].active).toEqual({ line: 0, character: 3 });
    });

    it("clamps character when moving up to shorter line", () => {
        const doc = new TextDocument("hi\nhello");
        const state = new EditorViewState(doc, [createCursorSelection(1, 4)]);
        state.cursorUp();
        expect(state.selections[0].active).toEqual({ line: 0, character: 2 });
    });

    it("does not move cursor up past first line", () => {
        const doc = new TextDocument("hello\nworld");
        const state = new EditorViewState(doc, [createCursorSelection(0, 3)]);
        state.cursorUp();
        expect(state.selections[0].active).toEqual({ line: 0, character: 3 });
    });

    it("moves cursor down one line", () => {
        const doc = new TextDocument("hello\nworld");
        const state = new EditorViewState(doc, [createCursorSelection(0, 3)]);
        state.cursorDown();
        expect(state.selections[0].active).toEqual({ line: 1, character: 3 });
    });

    it("clamps character when moving down to shorter line", () => {
        const doc = new TextDocument("hello\nhi");
        const state = new EditorViewState(doc, [createCursorSelection(0, 4)]);
        state.cursorDown();
        expect(state.selections[0].active).toEqual({ line: 1, character: 2 });
    });

    it("does not move cursor down past last line", () => {
        const doc = new TextDocument("hello\nworld");
        const state = new EditorViewState(doc, [createCursorSelection(1, 3)]);
        state.cursorDown();
        expect(state.selections[0].active).toEqual({ line: 1, character: 3 });
    });

    it("moves multiple cursors left independently", () => {
        const doc = new TextDocument("abcdef");
        const state = new EditorViewState(doc, [createCursorSelection(0, 2), createCursorSelection(0, 5)]);
        state.cursorLeft();
        expect(state.selections[0].active).toEqual({ line: 0, character: 1 });
        expect(state.selections[1].active).toEqual({ line: 0, character: 4 });
    });
});
