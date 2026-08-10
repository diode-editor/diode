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

describe("UndoManager", () => {
    it("undo returns false when stack is empty", () => {
        const { undoManager } = setup("hello");
        expect(undoManager.undo()).toBe(false);
    });

    it("redo returns false when stack is empty", () => {
        const { undoManager } = setup("hello");
        expect(undoManager.redo()).toBe(false);
    });

    it("canUndo / canRedo reflect stack state", () => {
        const { viewState, undoManager } = setup("hello");
        expect(undoManager.canUndo).toBe(false);
        expect(undoManager.canRedo).toBe(false);

        const element = viewState.type(" world");
        undoManager.pushUndoElement(element!);
        expect(undoManager.canUndo).toBe(true);
        expect(undoManager.canRedo).toBe(false);
    });

    it("undoes a single type operation", () => {
        const { doc, viewState, undoManager } = setup("hello");
        const original = doc.getText();
        viewState.selections = [createCursorSelection(0, 5)];

        const element = viewState.type(" world");
        undoManager.pushUndoElement(element!);
        expect(doc.getText()).toBe("hello world");

        expect(undoManager.undo(viewState)).toBe(true);
        expect(doc.getText()).toBe(original);
    });

    it("undoes a deleteLeft operation", () => {
        const { doc, viewState, undoManager } = setup("hello");
        viewState.selections = [createCursorSelection(0, 5)];

        const element = viewState.deleteLeft();
        expect(element).toBeDefined();
        undoManager.pushUndoElement(element!);
        expect(doc.getText()).toBe("hell");

        expect(undoManager.undo(viewState)).toBe(true);
        expect(doc.getText()).toBe("hello");
    });

    it("restores selections after undo", () => {
        const { doc, viewState, undoManager } = setup("hello");
        const selectionsBefore = [...viewState.selections];

        const element = viewState.type("X");
        undoManager.pushUndoElement(element!);

        undoManager.undo(viewState);
        expect(viewState.selections).toEqual(selectionsBefore);
    });

    it("redo restores document after undo", () => {
        const { doc, viewState, undoManager } = setup("hello");

        const element = viewState.type(" world");
        undoManager.pushUndoElement(element!);
        const afterText = doc.getText();

        undoManager.undo(viewState);
        expect(doc.getText()).toBe("hello");

        expect(undoManager.redo(viewState)).toBe(true);
        expect(doc.getText()).toBe(afterText);
    });

    it("pushUndoElement clears redo stack", () => {
        const { doc, viewState, undoManager } = setup("hello");

        const e1 = viewState.type("A");
        undoManager.pushUndoElement(e1!);
        undoManager.undo(viewState);
        expect(undoManager.canRedo).toBe(true);

        const e2 = viewState.type("B");
        undoManager.pushUndoElement(e2!);
        expect(undoManager.canRedo).toBe(false);
    });

    it("handles multiple undos in sequence", () => {
        const { doc, viewState, undoManager } = setup("");
        const original = doc.getText();

        const e1 = viewState.type("A");
        undoManager.pushUndoElement(e1!);
        const afterA = doc.getText();

        const e2 = viewState.type("B");
        undoManager.pushUndoElement(e2!);

        expect(doc.getText()).toBe("AB");

        expect(undoManager.undo(viewState)).toBe(true);
        expect(doc.getText()).toBe(afterA);

        expect(undoManager.undo(viewState)).toBe(true);
        expect(doc.getText()).toBe(original);
    });

    it("undo fails when versionId does not match (external edit)", () => {
        const { doc, viewState, undoManager } = setup("hello");

        const element = viewState.type(" world");
        undoManager.pushUndoElement(element!);

        // External edit that changes versionId
        doc.applyEdits([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "!" }]);

        expect(undoManager.undo(viewState)).toBe(false);
    });

    it("versionId is correct through apply-undo-redo cycle", () => {
        const { doc, viewState, undoManager } = setup("hello");
        expect(doc.versionId).toBe(0);

        const element = viewState.type("X");
        undoManager.pushUndoElement(element!);
        expect(doc.versionId).toBe(1);

        undoManager.undo(viewState);
        expect(doc.versionId).toBe(2);

        undoManager.redo(viewState);
        expect(doc.versionId).toBe(3);
    });

    it("deep equality: document matches original after apply then undo", () => {
        const { doc, viewState, undoManager } = setup("line1\nline2\nline3");
        const originalText = doc.getText();
        const originalLineCount = doc.lineCount;

        viewState.selections = [createCursorSelection(1, 2)];
        const element = viewState.type("INSERTED");
        undoManager.pushUndoElement(element!);

        expect(doc.getText()).not.toBe(originalText);

        undoManager.undo(viewState);

        expect(doc.getText()).toBe(originalText);
        expect(doc.lineCount).toBe(originalLineCount);
        for (let i = 0; i < originalLineCount; i++) {
            expect(doc.getLineContent(i)).toBe(originalText.split("\n")[i]);
        }
    });
});
