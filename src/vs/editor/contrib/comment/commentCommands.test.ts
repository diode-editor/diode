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
    it("comments the cursor line and carries the cursor along with the text", () => {
        const state = makeState("const a = 1;", [createCursorSelection(0, 6)]);
        const element = toggleLineComment(state, TS);

        expect(state.document.getText()).toBe("// const a = 1;");
        expect(spans(state)).toEqual([[0, 9, 0, 9]]);
        expect(element?.label).toBe("toggleLineComment");
    });

    it("a repeated toggle restores the original text", () => {
        const state = makeState("const a = 1;", [createCursorSelection(0, 6)]);
        toggleLineComment(state, TS);
        toggleLineComment(state, TS);
        expect(state.document.getText()).toBe("const a = 1;");
        expect(spans(state)).toEqual([[0, 6, 0, 6]]);
    });

    it("a multi-line selection stays a selection after toggle", () => {
        const state = makeState("aaa\nbbb\nccc", [createSelection(0, 1, 2, 2)]);
        toggleLineComment(state, TS);

        expect(state.document.getText()).toBe("// aaa\n// bbb\n// ccc");
        expect(spans(state)).toEqual([[0, 4, 2, 5]]);
    });

    it("a selection tail at column 0 does not comment its line", () => {
        const state = makeState("aaa\nbbb\nccc", [createSelection(0, 0, 2, 0)]);
        toggleLineComment(state, TS);
        expect(state.document.getText()).toBe("// aaa\n// bbb\nccc");
    });

    it("multi-cursor: each selection toggles by ITS OWN state", () => {
        const state = makeState("// aaa\nbbb", [createCursorSelection(0, 0), createCursorSelection(1, 0)]);
        toggleLineComment(state, TS);
        expect(state.document.getText()).toBe("aaa\n// bbb");
    });

    it("two cursors on one line comment it once", () => {
        const state = makeState("const a = 1;", [createCursorSelection(0, 1), createCursorSelection(0, 5)]);
        toggleLineComment(state, TS);
        expect(state.document.getText()).toBe("// const a = 1;");
    });

    it("selections given in reverse document order are handled like forward ones", () => {
        // Alt+click bottom-up; without sorting, line dedup and shifts go wrong.
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

    it("a language without lineComment (CSS) wraps the line content in a block pair", () => {
        const state = makeState("    color: red;", [createCursorSelection(0, 6)]);
        const element = toggleLineComment(state, CSS);
        // The fallback stays a "toggle line comment" step, since that is what was invoked.
        expect(element?.label).toBe("toggleLineComment");
        expect(state.document.getText()).toBe("    /* color: red; */");

        toggleLineComment(state, CSS);
        expect(state.document.getText()).toBe("    color: red;");
    });

    it("a language with no comments section at all — no-op even for toggle", () => {
        const state = makeState("aaa");
        expect(toggleLineComment(state, {})).toBeUndefined();
        expect(state.document.getText()).toBe("aaa");
    });

    it("read-only: no edits and no undo element", () => {
        const state = makeState("aaa");
        state.readOnly = true;
        expect(toggleLineComment(state, TS)).toBeUndefined();
        expect(state.document.getText()).toBe("aaa");
    });

    it("undo restores both the text and the selections", () => {
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
    it("add on a commented line adds a second marker, remove removes one", () => {
        const state = makeState("// aaa");
        const added = addLineComment(state, TS);
        expect(state.document.getText()).toBe("// // aaa");
        const removed = removeLineComment(state, TS);
        expect(state.document.getText()).toBe("// aaa");
        expect(added?.label).toBe("addLineComment");
        expect(removed?.label).toBe("removeLineComment");
    });

    it("without lineComment both are no-ops (fallback is toggle-only)", () => {
        const state = makeState("aaa");
        expect(addLineComment(state, CSS)).toBeUndefined();
        expect(removeLineComment(state, CSS)).toBeUndefined();
        expect(state.document.getText()).toBe("aaa");
    });

    it("remove on uncommented lines — no-op", () => {
        const state = makeState("aaa");
        expect(removeLineComment(state, PYTHON)).toBeUndefined();
    });
});

describe("toggleBlockComment", () => {
    it("wraps the selection in a pair and keeps the selection on the text", () => {
        const state = makeState("const a = 1;", [createSelection(0, 6, 0, 7)]);
        const element = toggleBlockComment(state, TS);

        expect(element?.label).toBe("blockComment");
        expect(state.document.getText()).toBe("const /* a */ = 1;");
        expect(spans(state)).toEqual([[0, 9, 0, 10]]);
        expect(state.document.getTextInRange(selectionToRange(state.selections[0]))).toBe("a");
    });

    it("a repeated toggle removes the pair", () => {
        const state = makeState("const a = 1;", [createSelection(0, 6, 0, 7)]);
        toggleBlockComment(state, TS);
        toggleBlockComment(state, TS);
        expect(state.document.getText()).toBe("const a = 1;");
        expect(spans(state)).toEqual([[0, 6, 0, 7]]);
    });

    it("an empty selection inserts a pair with the cursor between the spaces", () => {
        const state = makeState("ab", [createCursorSelection(0, 1)]);
        toggleBlockComment(state, TS);
        expect(state.document.getText()).toBe("a/*  */b");
        expect(spans(state)).toEqual([[0, 4, 0, 4]]);
    });

    it("two selections on one line: edits of the first shift the second selection", () => {
        const state = makeState("aa bb", [createSelection(0, 0, 0, 2), createSelection(0, 3, 0, 5)]);
        toggleBlockComment(state, TS);
        expect(state.document.getText()).toBe("/* aa */ /* bb */");
        expect(state.document.getTextInRange(selectionToRange(state.selections[0]))).toBe("aa");
        expect(state.document.getTextInRange(selectionToRange(state.selections[1]))).toBe("bb");
    });

    it("removing two pairs on one line: edits of the first shift the second", () => {
        const state = makeState("/* aa */ /* bb */", [createSelection(0, 0, 0, 8), createSelection(0, 9, 0, 17)]);
        toggleBlockComment(state, TS);

        expect(state.document.getText()).toBe("aa bb");
        expect(state.document.getTextInRange(selectionToRange(state.selections[0]))).toBe("aa");
        expect(state.document.getTextInRange(selectionToRange(state.selections[1]))).toBe("bb");
    });

    it("selections of one line in reverse order give the same result as forward ones", () => {
        const state = makeState("aa bb", [createSelection(0, 3, 0, 5), createSelection(0, 0, 0, 2)]);
        toggleBlockComment(state, TS);

        expect(state.document.getText()).toBe("/* aa */ /* bb */");
        // Without sorting, the shift from the neighbor's edits would hit the wrong selection.
        const texts = state.selections.map((sel) => state.document.getTextInRange(selectionToRange(sel)));
        expect(texts).toEqual(["aa", "bb"]);
    });

    it("undo of a block comment restores the text and the selection", () => {
        const state = makeState("const a = 1;", [createSelection(0, 6, 0, 7)]);
        const undoManager = new UndoManager(state.document);
        const element = toggleBlockComment(state, TS);
        if (element) undoManager.pushUndoElement(element);

        undoManager.undo(state);
        expect(state.document.getText()).toBe("const a = 1;");
        expect(spans(state)).toEqual([[0, 6, 0, 7]]);
    });

    it("a language without a block pair — no-op", () => {
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
