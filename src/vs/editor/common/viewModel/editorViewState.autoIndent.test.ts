import { describe, expect, it } from "vitest";

import { createCursorSelection } from "../core/iSelection.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

// Пробелы — ради читаемых ассертов; дефолт редактора — табы.
function spacesState(text: string, selections: ReturnType<typeof createCursorSelection>[]): EditorViewState {
    const state = new EditorViewState(new TextDocument(text), selections);
    state.insertSpaces = true;
    state.tabSize = 4;
    state.detectIndentation = false;
    return state;
}

describe("EditorViewState.insertNewLine — auto-indent", () => {
    it("carries the current line's indentation to the new line", () => {
        const state = spacesState("    foo", [createCursorSelection(0, 7)]);
        state.insertNewLine();
        expect(state.document.getText()).toBe("    foo\n    ");
        expect(state.selections[0].active).toEqual({ line: 1, character: 4 });
    });

    it("adds no indentation on an unindented line", () => {
        const state = spacesState("foo", [createCursorSelection(0, 3)]);
        state.insertNewLine();
        expect(state.document.getText()).toBe("foo\n");
        expect(state.selections[0].active).toEqual({ line: 1, character: 0 });
    });

    it("splits a line, carrying indentation and moving the suffix down", () => {
        const state = spacesState("    foobar", [createCursorSelection(0, 7)]);
        state.insertNewLine();
        expect(state.document.getText()).toBe("    foo\n    bar");
        expect(state.selections[0].active).toEqual({ line: 1, character: 4 });
    });

    it("increases indent one level after an opening brace", () => {
        const state = spacesState("    if (x) {", [createCursorSelection(0, 12)]);
        state.insertNewLine();
        expect(state.document.getText()).toBe("    if (x) {\n        ");
        expect(state.selections[0].active).toEqual({ line: 1, character: 8 });
    });

    it("expands a block when the cursor sits between a bracket pair", () => {
        const state = spacesState("    foo() {}", [createCursorSelection(0, 11)]);
        state.insertNewLine();
        expect(state.document.getText()).toBe("    foo() {\n        \n    }");
        expect(state.selections[0].active).toEqual({ line: 1, character: 8 });
    });

    it("uses a tab when insertSpaces is false", () => {
        const state = new EditorViewState(new TextDocument("\tfoo {"), [createCursorSelection(0, 6)]);
        state.insertSpaces = false;
        state.detectIndentation = false;
        state.insertNewLine();
        expect(state.document.getText()).toBe("\tfoo {\n\t\t");
        expect(state.selections[0].active).toEqual({ line: 1, character: 2 });
    });

    it("indents each cursor by its own line in a multi-cursor edit", () => {
        const state = spacesState("    foo\n  bar", [createCursorSelection(0, 7), createCursorSelection(1, 5)]);
        state.insertNewLine();
        expect(state.document.getText()).toBe("    foo\n    \n  bar\n  ");
        expect(state.selections.map((s) => s.active)).toEqual([
            { line: 1, character: 4 },
            { line: 3, character: 2 },
        ]);
    });

    it("is undoable back to the original text and selection", () => {
        const doc = new TextDocument("    foo");
        const state = new EditorViewState(doc, [createCursorSelection(0, 7)]);
        state.insertSpaces = true;
        state.detectIndentation = false;
        const undo = state.insertNewLine();
        expect(doc.getText()).toBe("    foo\n    ");
        doc.applyEdits(undo!.backwardEdits);
        expect(doc.getText()).toBe("    foo");
    });
});
