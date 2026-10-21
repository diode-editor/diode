import { describe, expect, it } from "vitest";

import { createCursorSelection, createSelection } from "../core/iSelection.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

describe("EditorViewState.selections — normalization in the setter", () => {
    it("getter returns selections in document order however they were assigned", () => {
        const state = new EditorViewState(new TextDocument("aaa\nbbb\nccc"));
        state.selections = [createCursorSelection(2, 0), createCursorSelection(0, 0), createCursorSelection(1, 0)];
        expect(state.selections.map((sel) => sel.active.line)).toEqual([0, 1, 2]);
    });

    it("constructor normalizes initial selections", () => {
        const state = new EditorViewState(new TextDocument("aaa\nbbb"), [
            createCursorSelection(1, 0),
            createCursorSelection(0, 0),
        ]);
        expect(state.selections.map((sel) => sel.active.line)).toEqual([0, 1]);
    });

    it("assignment fires cursor-change EXACTLY once, already with the final set", () => {
        const state = new EditorViewState(new TextDocument("abcdef"));
        const seen: number[] = [];
        state.onDidChangeCursorPosition(() => {
            seen.push(state.selections.length);
        });

        state.selections = [createCursorSelection(0, 3), createCursorSelection(0, 3), createCursorSelection(0, 5)];

        // One event, and the listener already sees the merged set — not an intermediate one.
        expect(seen).toEqual([2]);
    });

    it("duplicates collapse on assignment", () => {
        const state = new EditorViewState(new TextDocument("abcdef"));
        state.selections = [createCursorSelection(0, 2), createCursorSelection(0, 2)];
        expect(state.selections).toHaveLength(1);
    });

    it("a cursor inside a selection dissolves into it", () => {
        const state = new EditorViewState(new TextDocument("abcdef"));
        state.selections = [createSelection(0, 1, 0, 5), createCursorSelection(0, 3)];
        expect(state.selections).toHaveLength(1);
        expect(state.selections[0].anchor).toEqual({ line: 0, character: 1 });
        expect(state.selections[0].active).toEqual({ line: 0, character: 5 });
    });
});

describe("EditorViewState — merging during navigation and edits", () => {
    it("cursorTop merges all cursors into one", () => {
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

    it("cursorBottom merges all cursors into one", () => {
        const doc = new TextDocument("aaa\nbbb");
        const state = new EditorViewState(doc, [createCursorSelection(0, 0), createCursorSelection(1, 0)]);
        state.cursorBottom();
        expect(state.selections).toHaveLength(1);
        expect(state.selections[0].active).toEqual({ line: 1, character: 3 });
    });

    it("cursorHome merges two cursors on one line into one", () => {
        const doc = new TextDocument("hello");
        const state = new EditorViewState(doc, [createCursorSelection(0, 2), createCursorSelection(0, 4)]);
        state.cursorHome();
        expect(state.selections).toHaveLength(1);
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("cursorLeft collapses adjacent cursors when they meet", () => {
        const doc = new TextDocument("abc");
        const state = new EditorViewState(doc, [createCursorSelection(0, 0), createCursorSelection(0, 1)]);
        state.cursorLeft();
        // The left one hits the line start and stays, the right one arrives at the same point.
        expect(state.selections).toHaveLength(1);
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("an edit bringing cursors to one point leaves a single cursor", () => {
        const doc = new TextDocument("abc");
        const state = new EditorViewState(doc, [createCursorSelection(0, 1), createCursorSelection(0, 2)]);
        state.deleteLeft();
        expect(doc.getText()).toBe("c");
        expect(state.selections).toHaveLength(1);
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("undo element carries the already merged afterSelections — redo does not revive duplicates", () => {
        const doc = new TextDocument("abc");
        const state = new EditorViewState(doc, [createCursorSelection(0, 1), createCursorSelection(0, 2)]);
        const element = state.deleteLeft();
        expect(element?.beforeSelections).toHaveLength(2);
        expect(element?.afterSelections).toHaveLength(1);
    });

    it("restoreSelections normalizes the snapshot", () => {
        const doc = new TextDocument("abcdef");
        const state = new EditorViewState(doc);
        state.restoreSelections([createCursorSelection(0, 4), createCursorSelection(0, 4)]);
        expect(state.selections).toHaveLength(1);
    });
});
