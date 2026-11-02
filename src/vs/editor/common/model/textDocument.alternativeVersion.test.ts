import { describe, expect, it } from "vitest";

import { EndOfLine } from "../core/endOfLine.ts";
import { createInsertEdit } from "../core/iTextEdit.ts";

import { TextDocument } from "./textDocument.ts";
import { UndoManager } from "./undoManager.ts";

function typed(doc: TextDocument, undo: UndoManager, text: string): void {
    const versionBefore = doc.versionId;
    const forwardEdits = [createInsertEdit(0, 0, text)];
    const { appliedVersion, inverseEdits } = doc.applyEdits(forwardEdits);
    undo.pushUndoElement({
        label: text,
        versionBefore,
        versionAfter: appliedVersion,
        forwardEdits,
        backwardEdits: inverseEdits,
        beforeSelections: [],
        afterSelections: [],
    });
}

describe("TextDocument — alternative version", () => {
    it("an edit and setText move it to the new version; setEol and a language change do not", () => {
        const doc = new TextDocument("a");
        expect(doc.alternativeVersionId).toBe(0);

        doc.applyEdits([createInsertEdit(0, 0, "x")]);
        expect(doc.alternativeVersionId).toBe(doc.versionId);

        doc.setEol(EndOfLine.CRLF);
        doc.setLanguage("typescript");
        expect(doc.versionId).toBe(2);
        expect(doc.alternativeVersionId).toBe(1);

        doc.setText("b");
        expect(doc.alternativeVersionId).toBe(3);
    });

    it("alternativeVersionIdAt: the current version's value, otherwise the value before the last bump", () => {
        const doc = new TextDocument("a");
        doc.applyEdits([createInsertEdit(0, 0, "x")]);
        doc.setEol(EndOfLine.CRLF);

        expect(doc.alternativeVersionIdAt(doc.versionId)).toBe(1);
        expect(doc.alternativeVersionIdAt(doc.versionId - 1)).toBe(1);

        doc.applyEdits([createInsertEdit(0, 0, "y")]);
        expect(doc.alternativeVersionIdAt(doc.versionId)).toBe(3);
        expect(doc.alternativeVersionIdAt(doc.versionId - 1)).toBe(1);
    });

    it("undo restores the value of the state before the step, redo the one after; versionId only grows", () => {
        const doc = new TextDocument("a");
        const undo = new UndoManager(doc);
        typed(doc, undo, "x");
        typed(doc, undo, "y");

        undo.undo();
        expect(doc.alternativeVersionId).toBe(1);
        undo.undo();
        expect(doc.alternativeVersionId).toBe(0);
        undo.redo();
        expect(doc.alternativeVersionId).toBe(1);
        undo.redo();
        expect(doc.alternativeVersionId).toBe(2);
        expect(doc.versionId).toBe(6);
    });

    it("the content event of an undo already sees the restored value", () => {
        const doc = new TextDocument("a");
        const undo = new UndoManager(doc);
        typed(doc, undo, "x");
        const seen: number[] = [];
        doc.onDidChangeModelContent(() => seen.push(doc.alternativeVersionId));
        doc.onDidChangeContent(() => seen.push(doc.alternativeVersionId));

        undo.undo();

        expect(seen).toEqual([0, 0]);
    });
});
