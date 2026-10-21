import { describe, expect, it } from "vitest";

import { createRange } from "../core/iRange.ts";
import { createCursorSelection } from "../core/iSelection.ts";
import { createTextEdit } from "../core/iTextEdit.ts";
import { EditorViewState } from "../viewModel/editorViewState.ts";

import { TextDocument } from "./textDocument.ts";
import { UndoManager } from "./undoManager.ts";

// Hermetic double of a quick fix from the stock typescript-language-server: two adjacent
// deletions on one line (shape captured from a live server,
// extensionHost.typescriptLsp.codeActions.test.ts).

const IMPORT_LINE = 'import { test, assert } from "./test.js";';
const FIXED_LINE = 'import { test } from "./test.js";';

const QUICK_FIX_EDITS = [createTextEdit(createRange(0, 13, 0, 15), ""), createTextEdit(createRange(0, 15, 0, 21), "")];

function setup(text: string) {
    const doc = new TextDocument(text);
    const viewState = new EditorViewState(doc);
    const undoManager = new UndoManager(doc);
    return { doc, viewState, undoManager };
}

/** Same path as applyExternalEdits. */
function applyExternal(
    viewState: EditorViewState,
    undoManager: UndoManager,
    edits: readonly ReturnType<typeof createTextEdit>[],
): void {
    const element = viewState.applyEdits(edits, "quick fix");
    expect(element).toBeDefined();
    undoManager.pushUndoElement(element!);
}

describe("UndoManager: external edit batch (quick fix)", () => {
    it("undo restores the import line verbatim", () => {
        const { doc, viewState, undoManager } = setup(IMPORT_LINE);

        applyExternal(viewState, undoManager, QUICK_FIX_EDITS);
        expect(doc.getText()).toBe(FIXED_LINE);

        expect(undoManager.undo(viewState)).toBe(true);
        expect(doc.getText()).toBe(IMPORT_LINE);
    });

    it("redo reapplies the fix, next undo restores the original line again", () => {
        const { doc, viewState, undoManager } = setup(IMPORT_LINE);

        applyExternal(viewState, undoManager, QUICK_FIX_EDITS);
        undoManager.undo(viewState);

        expect(undoManager.redo(viewState)).toBe(true);
        expect(doc.getText()).toBe(FIXED_LINE);

        expect(undoManager.undo(viewState)).toBe(true);
        expect(doc.getText()).toBe(IMPORT_LINE);
    });

    it("chain: typing after the fix undoes step by step back to the original", () => {
        const { doc, viewState, undoManager } = setup(IMPORT_LINE);

        applyExternal(viewState, undoManager, QUICK_FIX_EDITS);

        viewState.selections = [createCursorSelection(0, doc.getLineLength(0))];
        const typed = viewState.type("\ntest;");
        undoManager.pushUndoElement(typed!);
        expect(doc.getText()).toBe(`${FIXED_LINE}\ntest;`);

        expect(undoManager.undo(viewState)).toBe(true);
        expect(doc.getText()).toBe(FIXED_LINE);

        expect(undoManager.undo(viewState)).toBe(true);
        expect(doc.getText()).toBe(IMPORT_LINE);

        expect(undoManager.redo(viewState)).toBe(true);
        expect(doc.getText()).toBe(FIXED_LINE);

        expect(undoManager.redo(viewState)).toBe(true);
        expect(doc.getText()).toBe(`${FIXED_LINE}\ntest;`);
    });

    it("undo of a batch that joined lines restores the line breaks", () => {
        // The second inverse edit must shift by line AND by column.
        const text = 'import {\n    test, assert,\n} from "./test.js";';
        const { doc, viewState, undoManager } = setup(text);

        applyExternal(viewState, undoManager, [
            createTextEdit(createRange(0, 8, 1, 4), ""),
            createTextEdit(createRange(1, 8, 1, 16), ""),
        ]);
        expect(doc.getText()).toBe('import {test,\n} from "./test.js";');

        expect(undoManager.undo(viewState)).toBe(true);
        expect(doc.getText()).toBe(text);
    });
});
