import { describe, expect, it } from "vitest";

import { createDeleteEdit, createInsertEdit } from "../core/iTextEdit.ts";

import type { IDocumentContentChange } from "./iDocumentContentChange.ts";
import { TextDocument } from "./textDocument.ts";

function recordChanges(doc: TextDocument): IDocumentContentChange[] {
    const changes: IDocumentContentChange[] = [];
    doc.onDidChangeContent((c) => changes.push(c));
    return changes;
}

describe("TextDocument change events", () => {
    it("setText fires a single full-replace change", () => {
        const doc = new TextDocument("a\nb\nc");
        const changes = recordChanges(doc);
        doc.setText("X\nY");
        expect(changes).toEqual([{ startLine: 0, oldEndLine: 2, newEndLine: 1, isFlush: true }]);
    });

    it("single-line insert reports unchanged line range", () => {
        const doc = new TextDocument("hello");
        const changes = recordChanges(doc);
        doc.applyEdits([createInsertEdit(0, 5, " world")]);
        expect(changes).toEqual([{ startLine: 0, oldEndLine: 0, newEndLine: 0 }]);
    });

    it("multi-line insert grows the line range", () => {
        const doc = new TextDocument("ab");
        const changes = recordChanges(doc);
        doc.applyEdits([createInsertEdit(0, 1, "X\nY\n")]);
        expect(changes).toEqual([{ startLine: 0, oldEndLine: 0, newEndLine: 2 }]);
    });

    it("multi-line delete shrinks the line range", () => {
        const doc = new TextDocument("a\nb\nc\nd");
        const changes = recordChanges(doc);
        doc.applyEdits([createDeleteEdit(1, 0, 3, 0)]);
        expect(changes).toEqual([{ startLine: 1, oldEndLine: 3, newEndLine: 1 }]);
    });

    it("applyEdits with multiple edits emits one change per edit", () => {
        const doc = new TextDocument("a\nb\nc");
        const changes = recordChanges(doc);
        doc.applyEdits([createInsertEdit(0, 0, "X"), createInsertEdit(2, 0, "Y")]);
        expect(changes.length).toBe(2);
    });

    it("in a batch, a lower event arrives in coordinates with the upper edits already applied", () => {
        const doc = new TextDocument("a\nb\nc");
        const changes = recordChanges(doc);
        doc.applyEdits([createInsertEdit(0, 0, "X\nY"), createInsertEdit(2, 0, "Z")]);
        expect(doc.getText()).toBe("X\nYa\nb\nZc");
        expect(changes).toEqual([
            { startLine: 0, oldEndLine: 0, newEndLine: 1 },
            { startLine: 3, oldEndLine: 3, newEndLine: 3 },
        ]);
    });

    it("deleting lines above shifts the boundaries of later batch events up", () => {
        const doc = new TextDocument("a\nb\nc\nd\ne");
        const changes = recordChanges(doc);
        doc.applyEdits([createDeleteEdit(0, 1, 1, 0), createInsertEdit(3, 0, "Z")]);
        expect(doc.getText()).toBe("ab\nc\nZd\ne");
        expect(changes).toEqual([
            { startLine: 0, oldEndLine: 1, newEndLine: 0 },
            { startLine: 2, oldEndLine: 2, newEndLine: 2 },
        ]);
    });

    it("returned IDisposable removes the listener", () => {
        const doc = new TextDocument("a");
        const changes: IDocumentContentChange[] = [];
        const handle = doc.onDidChangeContent((c) => changes.push(c));
        doc.applyEdits([createInsertEdit(0, 0, "X")]);
        handle.dispose();
        doc.applyEdits([createInsertEdit(0, 0, "Y")]);
        expect(changes.length).toBe(1);
    });

    it("disposing the same listener twice is a safe no-op", () => {
        const doc = new TextDocument("a");
        const changes: IDocumentContentChange[] = [];
        const handle = doc.onDidChangeContent((c) => changes.push(c));

        handle.dispose();
        expect(() => {
            handle.dispose();
        }).not.toThrow();

        doc.applyEdits([createInsertEdit(0, 0, "X")]);
        expect(changes.length).toBe(0);
    });
});
