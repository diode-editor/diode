import { describe, expect, it } from "vitest";

import { createCursorSelection, createSelection } from "../core/iSelection.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

type Sel = ReturnType<typeof createCursorSelection>;

// Детекция выключена: ведущие пробелы фикстуры не должны перещёлкнуть insertSpaces/tabSize.
function tabsState(text: string, selections: Sel[]): EditorViewState {
    const state = new EditorViewState(new TextDocument(text), selections);
    state.insertSpaces = false;
    state.tabSize = 4;
    state.detectIndentation = false;
    return state;
}

function spacesState(text: string, selections: Sel[], tabSize = 4): EditorViewState {
    const state = new EditorViewState(new TextDocument(text), selections);
    state.insertSpaces = true;
    state.tabSize = tabSize;
    state.detectIndentation = false;
    return state;
}

describe("EditorViewState.indentLines", () => {
    it("inserts a tab at a collapsed cursor", () => {
        const state = tabsState("hello", [createCursorSelection(0, 0)]);
        state.indentLines();
        expect(state.document.getText()).toBe("\thello");
        expect(state.selections[0].active).toEqual({ line: 0, character: 1 });
    });

    it("inserts spaces at a collapsed cursor when insertSpaces is on", () => {
        const state = spacesState("hello", [createCursorSelection(0, 0)], 2);
        state.indentLines();
        expect(state.document.getText()).toBe("  hello");
    });

    it("replaces a single-line selection with the indent unit", () => {
        const state = tabsState("abc", [createSelection(0, 0, 0, 2)]);
        state.indentLines();
        expect(state.document.getText()).toBe("\tc");
    });

    it("prepends the indent unit to every line of a multi-line selection", () => {
        const state = tabsState("aa\nbb\ncc", [createSelection(0, 1, 2, 1)]);
        state.indentLines();
        expect(state.document.getText()).toBe("\taa\n\tbb\n\tcc");
        // A line-start anchor stays anchored at column 0; other endpoints shift right.
        expect(state.selections[0].anchor).toEqual({ line: 0, character: 2 });
        expect(state.selections[0].active).toEqual({ line: 2, character: 2 });
    });

    it("keeps a column-0 anchor at column 0 across the indent", () => {
        const state = tabsState("aa\nbb", [createSelection(0, 0, 1, 2)]);
        state.indentLines();
        expect(state.document.getText()).toBe("\taa\n\tbb");
        expect(state.selections[0].anchor).toEqual({ line: 0, character: 0 });
        expect(state.selections[0].active).toEqual({ line: 1, character: 3 });
    });

    it("does not indent the trailing line when the selection ends at its column 0", () => {
        const state = tabsState("aa\nbb\ncc", [createSelection(0, 0, 1, 0)]);
        state.indentLines();
        // Only line 0 is touched; line 1 (the col-0 tail) is left alone.
        expect(state.document.getText()).toBe("\taa\nbb\ncc");
        // The active endpoint sits on the untouched line and is not remapped.
        expect(state.selections[0].active).toEqual({ line: 1, character: 0 });
    });
});

describe("EditorViewState.outdentLines", () => {
    it("removes a leading tab from the cursor's line", () => {
        const state = tabsState("\thello", [createCursorSelection(0, 3)]);
        state.outdentLines();
        expect(state.document.getText()).toBe("hello");
        expect(state.selections[0].active).toEqual({ line: 0, character: 2 });
    });

    it("removes up to tabSize leading spaces", () => {
        const state = spacesState("    hello", [createCursorSelection(0, 6)]);
        state.outdentLines();
        expect(state.document.getText()).toBe("hello");
        expect(state.selections[0].active).toEqual({ line: 0, character: 2 });
    });

    it("removes a partial indent shorter than tabSize", () => {
        const state = spacesState("  hi", [createCursorSelection(0, 3)]);
        state.outdentLines();
        expect(state.document.getText()).toBe("hi");
        expect(state.selections[0].active).toEqual({ line: 0, character: 1 });
    });

    it("clamps an endpoint that sits inside the removed run to the new line start", () => {
        const state = spacesState("    hello", [createCursorSelection(0, 2)]);
        state.outdentLines();
        expect(state.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("outdents every line touched by a multi-line selection", () => {
        const state = tabsState("\taa\n\tbb", [createSelection(0, 0, 1, 3)]);
        state.outdentLines();
        expect(state.document.getText()).toBe("aa\nbb");
        expect(state.selections[0].anchor).toEqual({ line: 0, character: 0 });
        expect(state.selections[0].active).toEqual({ line: 1, character: 2 });
    });

    it("outdents only the lines that have leading whitespace", () => {
        const state = tabsState("\taa\nbb", [createSelection(0, 0, 1, 2)]);
        state.outdentLines();
        expect(state.document.getText()).toBe("aa\nbb");
        // Line 1 was untouched, so its endpoint is not remapped.
        expect(state.selections[0].active).toEqual({ line: 1, character: 2 });
    });

    it("skips blank lines inside the selection", () => {
        const state = spacesState("  a\n\n  b", [createSelection(0, 0, 2, 3)], 2);
        state.outdentLines();
        expect(state.document.getText()).toBe("a\n\nb");
    });

    it("is a no-op that returns undefined when no line has leading whitespace", () => {
        const state = tabsState("aa\nbb", [createSelection(0, 0, 1, 2)]);
        const undo = state.outdentLines();
        expect(undo).toBeUndefined();
        expect(state.document.getText()).toBe("aa\nbb");
    });
});

describe("EditorViewState indent/outdent — undo round-trip", () => {
    it("outdent is reversible via its inverse edits", () => {
        const state = tabsState("\taa\n\tbb", [createSelection(0, 0, 1, 3)]);
        const undo = state.outdentLines();
        expect(undo).toBeDefined();
        state.document.applyEdits(undo!.backwardEdits);
        expect(state.document.getText()).toBe("\taa\n\tbb");
    });
});
