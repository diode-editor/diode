import { describe, expect, it } from "vitest";

import { createCursorSelection, createSelection } from "../core/iSelection.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

type Sel = ReturnType<typeof createCursorSelection>;

/** The symptom was the cursor column in the status bar: `Ln 1, Col 7` instead of `Col 5`. */
function spacesState(text: string, selections: Sel[], tabSize = 4): EditorViewState {
    const state = new EditorViewState(new TextDocument(text), selections);
    state.insertSpaces = true;
    state.tabSize = tabSize;
    state.detectIndentation = false;
    return state;
}

function tabsState(text: string, selections: Sel[], tabSize = 4): EditorViewState {
    const state = new EditorViewState(new TextDocument(text), selections);
    state.insertSpaces = false;
    state.tabSize = tabSize;
    state.detectIndentation = false;
    return state;
}

describe("Tab aligns the cursor to tab stops (insertSpaces, tabSize=4)", () => {
    const cases: { from: number; text: string; to: number }[] = [
        { from: 0, text: "    abcdefgh", to: 4 },
        { from: 1, text: "a   bcdefgh", to: 4 },
        { from: 3, text: "abc defgh", to: 4 },
        { from: 4, text: "abcd    efgh", to: 8 },
        { from: 5, text: "abcde   fgh", to: 8 },
    ];

    for (const { from, text, to } of cases) {
        it(`moves from column ${from} to ${to}`, () => {
            const state = spacesState("abcdefgh", [createCursorSelection(0, from)]);
            state.indentLines();
            expect(state.document.getText()).toBe(text);
            expect(state.selections[0].active).toEqual({ line: 0, character: to });
        });
    }

    it("on a tab stop inserts a full level", () => {
        const state = spacesState("abcdefgh", [createCursorSelection(0, 8)]);
        state.indentLines();
        expect(state.document.getText()).toBe("abcdefgh    ");
        expect(state.selections[0].active).toEqual({ line: 0, character: 12 });
    });

    it("tabSize=2: cursor moves from column 1 to 2", () => {
        const state = spacesState("abcd", [createCursorSelection(0, 1)], 2);
        state.indentLines();
        expect(state.document.getText()).toBe("a bcd");
        expect(state.selections[0].active).toEqual({ line: 0, character: 2 });
    });

    it("tabSize=3: cursor moves from column 4 to 6", () => {
        const state = spacesState("abcdef", [createCursorSelection(0, 4)], 3);
        state.indentLines();
        expect(state.document.getText()).toBe("abcd  ef");
        expect(state.selections[0].active).toEqual({ line: 0, character: 6 });
    });
});

describe("Tab computes the tab stop by VISIBLE column", () => {
    it("a tab left of the cursor takes its own distance to the tab stop", () => {
        // "\ta|b": the tab is columns 0..3, "a" is column 4, cursor at 5.
        // By character offset (2) it would be 2 spaces instead of 3.
        const state = spacesState("\tab", [createCursorSelection(0, 2)]);
        state.indentLines();
        expect(state.document.getText()).toBe("\ta   b");
        expect(state.selections[0].active).toEqual({ line: 0, character: 5 });
    });

    it("a wide grapheme takes two columns", () => {
        // "你a|b": 你 is columns 0..1, "a" is column 2, cursor at 3.
        const state = spacesState("你ab", [createCursorSelection(0, 2)]);
        state.indentLines();
        expect(state.document.getText()).toBe("你a b");
        expect(state.selections[0].active).toEqual({ line: 0, character: 3 });
    });
});

describe("Tab with multiple cursors — own padding per cursor", () => {
    it("cursors at different columns of one line get different numbers of spaces", () => {
        const state = spacesState("abcdefgh", [createCursorSelection(0, 1), createCursorSelection(0, 6)]);
        state.indentLines();
        // Column 1 → 3 spaces (to 4), column 6 → 2 spaces (to 8).
        expect(state.document.getText()).toBe("a   bcdef  gh");
        expect(state.selections.map((sel) => sel.active)).toEqual([
            { line: 0, character: 4 },
            { line: 0, character: 11 },
        ]);
    });

    it("cursors on different lines compute the tab stop by their own line", () => {
        const state = spacesState("ab\nabcdef", [createCursorSelection(0, 1), createCursorSelection(1, 2)]);
        state.indentLines();
        expect(state.document.getText()).toBe("a   b\nab  cdef");
        expect(state.selections.map((sel) => sel.active)).toEqual([
            { line: 0, character: 4 },
            { line: 1, character: 4 },
        ]);
    });

    it("one line with a tab, another without — each by its own visible column", () => {
        const state = spacesState("\tab\nab", [createCursorSelection(0, 2), createCursorSelection(1, 2)]);
        state.indentLines();
        // Line 0: visible column 5 → 3 spaces. Line 1: column 2 → 2 spaces.
        expect(state.document.getText()).toBe("\ta   b\nab  ");
        expect(state.selections.map((sel) => sel.active)).toEqual([
            { line: 0, character: 5 },
            { line: 1, character: 4 },
        ]);
    });
});

describe("Tab with a selection within a line", () => {
    it("replaces the selection with padding to the tab stop from its START", () => {
        const state = spacesState("abcdefgh", [createSelection(0, 1, 0, 3)]);
        state.indentLines();
        // Selection "bc" is erased, 3 spaces inserted: cursor on tab stop 4.
        expect(state.document.getText()).toBe("a   defgh");
        expect(state.selections[0].active).toEqual({ line: 0, character: 4 });
    });
});

describe("Tab with tabs does not compute tab stops", () => {
    it("inserts a single \\t from any column", () => {
        const state = tabsState("abcdefgh", [createCursorSelection(0, 5)]);
        state.indentLines();
        expect(state.document.getText()).toBe("abcde\tfgh");
        expect(state.selections[0].active).toEqual({ line: 0, character: 6 });
    });

    it("multi-cursor gets one \\t per cursor", () => {
        const state = tabsState("abcdefgh", [createCursorSelection(0, 1), createCursorSelection(0, 6)]);
        state.indentLines();
        expect(state.document.getText()).toBe("a\tbcdef\tgh");
    });
});

describe("Tab/Shift+Tab stay reversible on line indentation", () => {
    it("Tab from column 0 and Shift+Tab restore the line as it was", () => {
        const state = spacesState("ab", [createCursorSelection(0, 0)]);
        state.indentLines();
        expect(state.document.getText()).toBe("    ab");
        state.outdentLines();
        expect(state.document.getText()).toBe("ab");
    });

    it("Tab's undo step is reversible by its own inverse edits", () => {
        const state = spacesState("abcdefgh", [createCursorSelection(0, 5)]);
        const undo = state.indentLines();
        expect(undo).toBeDefined();
        expect(state.document.getText()).toBe("abcde   fgh");
        state.document.applyEdits(undo!.backwardEdits);
        expect(state.document.getText()).toBe("abcdefgh");
    });
});
