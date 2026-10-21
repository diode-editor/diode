import { describe, expect, it } from "vitest";

import { createRange } from "../core/iRange.ts";
import { createCursorSelection, createSelection } from "../core/iSelection.ts";
import { createTextEdit } from "../core/iTextEdit.ts";
import { TextDocument } from "../model/textDocument.ts";
import { UndoManager } from "../model/undoManager.ts";

import { EditorViewState } from "./editorViewState.ts";

/** The view's own edits aren't remapped — they recompute themselves exactly. */
describe("EditorViewState: remapping foreign edits", () => {
    function twoViews(text: string): { doc: TextDocument; a: EditorViewState; b: EditorViewState } {
        const doc = new TextDocument(text);
        return { doc, a: new EditorViewState(doc), b: new EditorViewState(doc) };
    }

    it("inserting lines above shifts the selection down", () => {
        const { a, b } = twoViews("one\ntwo\nthree");
        b.selections = [createSelection(1, 1, 2, 2)];

        a.selections = [createCursorSelection(0, 3)];
        a.type("\nx\ny");

        expect(b.selections[0].anchor).toEqual({ line: 3, character: 1 });
        expect(b.selections[0].active).toEqual({ line: 4, character: 2 });
    });

    it("deleting lines above shifts the selection up", () => {
        const { doc, b } = twoViews("one\ntwo\nthree\nfour");
        b.selections = [createCursorSelection(3, 2)];

        // Edit straight through the document (the undo/owner path) — view A is not involved.
        doc.applyEdits([createTextEdit(createRange(0, 0, 2, 0), "")]);

        expect(b.selections[0].active).toEqual({ line: 1, character: 2 });
    });

    it("an edit below the selection shifts nothing (and does not fire cursor-change)", () => {
        const { a, b } = twoViews("one\ntwo\nthree");
        b.selections = [createCursorSelection(0, 2)];
        let fired = 0;
        b.onDidChangeCursorPosition(() => {
            fired++;
        });

        a.selections = [createCursorSelection(2, 5)];
        a.type("\ntail");

        expect(b.selections[0].active).toEqual({ line: 0, character: 2 });
        expect(fired).toBe(0);
    });

    it("a position inside the replaced range clamps to its end", () => {
        const { doc, b } = twoViews("aaa\nbbb\nccc\nddd");
        b.selections = [createCursorSelection(2, 3)];

        doc.applyEdits([createTextEdit(createRange(1, 0, 3, 3), "x")]);

        const active = b.selections[0].active;
        expect(active.line).toBe(1);
        expect(active.character).toBeLessThanOrEqual(doc.getLineLength(1));
    });

    it("an own edit is not remapped by a second pass", () => {
        const { a } = twoViews("hello");
        a.selections = [createCursorSelection(0, 5)];
        a.type(" world");

        // Exact recomputation by the mutator: cursor at the end of the insertion, no offsets.
        expect(a.selections[0].active).toEqual({ line: 0, character: 11 });
    });

    it("folds of a foreign view shift, own ones are recomputed by the mutator", () => {
        const { a, b } = twoViews("h\nif {\n  x\n}\ntail");
        a.setFoldingRegions([{ startLine: 1, endLine: 3, isCollapsed: false }]);
        b.setFoldingRegions([{ startLine: 1, endLine: 3, isCollapsed: true }]);

        a.selections = [createCursorSelection(0, 1)];
        a.type("\nnew");

        expect(a.foldedRegions[0]).toMatchObject({ startLine: 2, endLine: 4 });
        expect(b.foldedRegions[0]).toMatchObject({ startLine: 2, endLine: 4, isCollapsed: true });
    });

    it("scroll of a foreign view follows an edit above the viewport", () => {
        const lines = Array.from({ length: 100 }, (_, i) => `l${i}`).join("\n");
        const { a, b } = twoViews(lines);
        b.scrollTop = 50;

        a.selections = [createCursorSelection(0, 2)];
        a.type("\nq\nw\ne");

        expect(b.scrollTop).toBe(53);
    });

    it("scroll is untouched with collapsed regions (logical shift ≠ visual)", () => {
        const lines = Array.from({ length: 100 }, (_, i) => `l${i}`).join("\n");
        const { a, b } = twoViews(lines);
        b.setFoldingRegions([{ startLine: 10, endLine: 20, isCollapsed: true }]);
        b.scrollTop = 50;

        a.selections = [createCursorSelection(0, 2)];
        a.type("\nq");

        expect(b.scrollTop).toBe(50);
    });

    /**
     * Batch events are computed bottom-up but fire in document order: without shifting boundaries
     * the lower edit addressed lines past the document, and the cursor stayed past the line end.
     */
    it("a batch of two edits does not leave a foreign view's cursor past line end", () => {
        const { doc, b } = twoViews("aaa\nbbbbb");
        b.selections = [createCursorSelection(1, 5)];

        // The upper edit adds a line, the lower one shortens the line under the cursor.
        doc.applyEdits([createTextEdit(createRange(0, 0, 0, 0), "X\n"), createTextEdit(createRange(1, 1, 1, 5), "")]);

        expect(doc.getText()).toBe("X\naaa\nb");
        expect(b.selections[0].active).toEqual({ line: 2, character: 1 });
    });

    it("undo of a multi-cursor multi-line insert does not break remapping", () => {
        const { doc, a } = twoViews("aaa\nbbb");
        const undoManager = new UndoManager(doc);
        a.selections = [createCursorSelection(0, 3), createCursorSelection(1, 3)];
        const element = a.insertText("X\nY");
        expect(element).toBeDefined();
        if (element) undoManager.pushUndoElement(element);
        expect(doc.getText()).toBe("aaaX\nY\nbbbX\nY");

        expect(undoManager.undo(a)).toBe(true);

        expect(doc.getText()).toBe("aaa\nbbb");
        expect(a.selections.map((sel) => sel.active)).toEqual([
            { line: 0, character: 3 },
            { line: 1, character: 3 },
        ]);
    });

    it("dispose stops remapping", () => {
        const { doc, b } = twoViews("one\ntwo\nthree");
        b.selections = [createCursorSelection(2, 1)];

        b.dispose();
        doc.applyEdits([createTextEdit(createRange(0, 0, 0, 0), "x\n")]);

        expect(b.selections[0].active).toEqual({ line: 2, character: 1 });
    });
});
