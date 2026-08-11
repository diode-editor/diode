import { describe, expect, it } from "vitest";

import { createCursorSelection } from "../core/iSelection.ts";
import { EditorViewState } from "../viewModel/editorViewState.ts";

import { TextDocument } from "./textDocument.ts";
import { UndoManager } from "./undoManager.ts";

function setup(text: string) {
    const doc = new TextDocument(text);
    const viewState = new EditorViewState(doc);
    const undoManager = new UndoManager(doc);
    return { doc, viewState, undoManager };
}

describe("UndoManager redo guard and version bookkeeping", () => {
    it("redo returns false when the document version no longer matches the redo element", () => {
        const { doc, viewState, undoManager } = setup("hello");
        viewState.selections = [createCursorSelection(0, 5)];

        const element = viewState.type(" world");
        undoManager.pushUndoElement(element!);
        undoManager.undo(viewState);
        expect(undoManager.canRedo).toBe(true);

        // An external edit bumps the document version away from the redo element's
        // expected versionAfter → redo must refuse (UndoManager.ts:76).
        doc.applyEdits([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "!" }]);

        expect(undoManager.redo(viewState)).toBe(false);
        // Document is left untouched by the refused redo.
        expect(doc.getText()).toBe("!hello");
    });

    it("redo of the most recent change leaves a deeper redo entry replayable", () => {
        const { doc, viewState, undoManager } = setup("");

        const e1 = viewState.type("A");
        undoManager.pushUndoElement(e1!);
        const e2 = viewState.type("B");
        undoManager.pushUndoElement(e2!);
        expect(doc.getText()).toBe("AB");

        // Undo both → redo stack now holds two elements.
        undoManager.undo(viewState);
        undoManager.undo(viewState);
        expect(doc.getText()).toBe("");

        // First redo replays "A". Because the redo stack still has another entry,
        // its versionAfter is rewritten to the current doc version (UndoManager.ts:94),
        // which keeps the SECOND redo valid.
        expect(undoManager.redo(viewState)).toBe(true);
        expect(doc.getText()).toBe("A");

        expect(undoManager.redo(viewState)).toBe(true);
        expect(doc.getText()).toBe("AB");
        expect(undoManager.canRedo).toBe(false);
    });

    it("full undo/redo cycle round-trips text across two edits", () => {
        const { doc, viewState, undoManager } = setup("x");
        viewState.selections = [createCursorSelection(0, 1)];

        const e1 = viewState.type("1");
        undoManager.pushUndoElement(e1!);
        const e2 = viewState.type("2");
        undoManager.pushUndoElement(e2!);
        expect(doc.getText()).toBe("x12");

        undoManager.undo(viewState);
        undoManager.undo(viewState);
        expect(doc.getText()).toBe("x");

        undoManager.redo(viewState);
        undoManager.redo(viewState);
        expect(doc.getText()).toBe("x12");
    });
});
