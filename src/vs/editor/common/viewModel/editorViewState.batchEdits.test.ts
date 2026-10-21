import { describe, expect, it } from "vitest";

import { createFoldingRegion } from "../../contrib/folding/iFoldingRegion.ts";
import { createRange } from "../core/iRange.ts";
import { createCursorSelection } from "../core/iSelection.ts";
import { createTextEdit } from "../core/iTextEdit.ts";
import { TextDocument } from "../model/textDocument.ts";
import { UndoManager } from "../model/undoManager.ts";

import { EditorViewState } from "./editorViewState.ts";

/**
 * Like upstream `editor.executeEdits` without a cursor computer: cursors don't multiply per edit
 * and stay INSIDE the document — a column past the line end crashed rendering in occurrence highlight.
 */
describe("EditorViewState: cursors after an edit batch", () => {
    function carets(state: EditorViewState): [number, number][] {
        return state.selections.map((sel) => [sel.active.line, sel.active.character]);
    }

    function assertInsideDocument(state: EditorViewState, doc: TextDocument): void {
        for (const sel of state.selections) {
            for (const pos of [sel.anchor, sel.active]) {
                expect(pos.line).toBeGreaterThanOrEqual(0);
                expect(pos.line).toBeLessThan(doc.lineCount);
                expect(pos.character).toBeGreaterThanOrEqual(0);
                expect(pos.character).toBeLessThanOrEqual(doc.getLineLength(pos.line));
            }
        }
    }

    it("batch of several edits does not multiply cursors: one cursor stays one", () => {
        const doc = new TextDocument("import a;\n\nfoo");
        const state = new EditorViewState(doc);
        state.selections = [createCursorSelection(2, 3)];

        state.applyEdits(
            [createTextEdit(createRange(2, 0, 2, 3), "fooBar"), createTextEdit(createRange(0, 0, 0, 0), "import b;\n")],
            "batch",
        );

        expect(doc.getText()).toBe("import b;\nimport a;\n\nfooBar");
        expect(carets(state)).toEqual([[3, 6]]);
    });

    it("multiline edit and an edit to its right on the same line: cursors shift exactly", () => {
        const doc = new TextDocument("hello\nhello baz\nx");
        const state = new EditorViewState(doc);
        // Inside the replaced "el", at its end, at the end of the deleted "o", and below.
        state.selections = [
            createCursorSelection(0, 2),
            createCursorSelection(0, 3),
            createCursorSelection(0, 5),
            createCursorSelection(1, 9),
        ];

        state.applyEdits(
            [createTextEdit(createRange(0, 1, 0, 3), "x\ny\nz"), createTextEdit(createRange(0, 4, 0, 5), "")],
            "batch",
        );

        expect(doc.getText()).toBe("hx\ny\nzl\nhello baz\nx");
        expect(carets(state)).toEqual([
            [0, 2],
            [2, 1],
            [2, 2],
            [3, 9],
        ]);
        assertInsideDocument(state, doc);
    });

    it("edit below a multiline one: the cursor moves with its line", () => {
        const doc = new TextDocument("one\ntwo\nthree");
        const state = new EditorViewState(doc);
        state.selections = [createCursorSelection(1, 2), createCursorSelection(2, 0), createCursorSelection(2, 5)];

        state.applyEdits(
            [createTextEdit(createRange(0, 0, 0, 3), "1\n2"), createTextEdit(createRange(2, 0, 2, 5), "x")],
            "batch",
        );

        expect(doc.getText()).toBe("1\n2\ntwo\nx");
        expect(carets(state)).toEqual([
            [2, 2],
            [3, 0],
            [3, 1],
        ]);
        assertInsideDocument(state, doc);
    });

    it("computeCursorState assigns selections from inverse edits in batch order", () => {
        const doc = new TextDocument("x\nfoo");
        const state = new EditorViewState(doc);
        state.selections = [createCursorSelection(1, 3)];
        const seen: string[] = [];

        state.applyEdits(
            [createTextEdit(createRange(1, 0, 1, 3), "fooBar"), createTextEdit(createRange(0, 0, 0, 0), "a\n")],
            "batch",
            (inverse) => {
                seen.push(...inverse.map((edit) => doc.getTextInRange(edit.range)));
                return [createCursorSelection(inverse[0].range.end.line, inverse[0].range.end.character)];
            },
        );

        // The main insertion edit came first in the batch, so its inverse comes first too,
        // even though the document applied the import above earlier in order.
        expect(seen).toEqual(["fooBar", "a\n"]);
        expect(carets(state)).toEqual([[2, 6]]);
    });

    it("computeCursorState returned null: selections shift as without it", () => {
        const doc = new TextDocument("foo");
        const state = new EditorViewState(doc);
        state.selections = [createCursorSelection(0, 1)];

        state.applyEdits([createTextEdit(createRange(0, 0, 0, 0), "a\nb")], "batch", () => null);

        expect(carets(state)).toEqual([[1, 2]]);
    });

    it("undo of a batch restores both text and previous cursors", () => {
        const doc = new TextDocument("hello\nhello baz\nx");
        const state = new EditorViewState(doc);
        const undoManager = new UndoManager(doc);
        state.selections = [createCursorSelection(1, 2)];

        const element = state.applyEdits(
            [createTextEdit(createRange(0, 1, 0, 3), "x\ny\nz"), createTextEdit(createRange(0, 4, 0, 5), "")],
            "batch",
        );
        expect(element).toBeDefined();
        if (element) undoManager.pushUndoElement(element);

        expect(undoManager.undo(state)).toBe(true);
        expect(doc.getText()).toBe("hello\nhello baz\nx");
        expect(carets(state)).toEqual([[1, 2]]);
    });
});

/** The document applied overlapping edits to already-consumed text: "hello world" lost "hello wo". */
describe("EditorViewState: overlapping multi-cursor deletes", () => {
    it("two cursors inside a word delete it once and merge into one", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc);
        state.selections = [createCursorSelection(0, 3), createCursorSelection(0, 5)];

        state.deleteWordLeft();

        expect(doc.getText()).toBe(" world");
        expect(state.selections.map((sel) => sel.active)).toEqual([{ line: 0, character: 0 }]);
    });

    it("undo/redo of an overlapping delete works on the merged range", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc);
        const undoManager = new UndoManager(doc);
        state.selections = [createCursorSelection(0, 3), createCursorSelection(0, 5)];

        const element = state.deleteWordLeft();
        expect(element).toBeDefined();
        if (element) undoManager.pushUndoElement(element);

        expect(undoManager.undo(state)).toBe(true);
        expect(doc.getText()).toBe("hello world");

        expect(undoManager.redo(state)).toBe(true);
        expect(doc.getText()).toBe(" world");
    });

    it("cursors in different words each delete their own", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc);
        state.selections = [createCursorSelection(0, 5), createCursorSelection(0, 11)];

        state.deleteWordLeft();

        expect(doc.getText()).toBe(" ");
        expect(state.selections.map((sel) => sel.active)).toEqual([
            { line: 0, character: 0 },
            { line: 0, character: 1 },
        ]);
    });

    it("edit fully covered by the previous one is dropped", () => {
        // Both cursors inside the only word: both have the line end as the right boundary,
        // so the second edit lies entirely within the first.
        const doc = new TextDocument("hello");
        const state = new EditorViewState(doc);
        state.selections = [createCursorSelection(0, 1), createCursorSelection(0, 3)];
        const changes: unknown[] = [];
        doc.onDidChangeContent((change) => changes.push(change));

        state.deleteWordRight();

        expect(doc.getText()).toBe("h");
        expect(state.selections.map((sel) => sel.active)).toEqual([{ line: 0, character: 1 }]);
        // The covered edit is dropped, not turned into a no-op: subscribers got one event.
        expect(changes).toHaveLength(1);
    });

    it("overlap to the right collapses the same way", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc);
        state.selections = [createCursorSelection(0, 1), createCursorSelection(0, 3)];

        state.deleteWordRight();

        // Cursor at 1 eats "ello", cursor at 3 eats "lo " up to the start of "world":
        // the ranges join into one, and so do the cursors.
        expect(doc.getText()).toBe("hworld");
        expect(state.selections.map((sel) => sel.active)).toEqual([{ line: 0, character: 1 }]);
    });
});

/** Deleting a word joins lines — without shifting folds a collapsed region would hide other lines. */
describe("EditorViewState: folds under word delete", () => {
    const sixLines = (): TextDocument => new TextDocument("aa\nbb\ncc\ndd\nee\nff");

    it("deleteWordLeft at column 0 joins lines and moves the region up", () => {
        const doc = sixLines();
        const state = new EditorViewState(doc);
        state.setFoldingRegions([createFoldingRegion(3, 5, false)]);
        state.selections = [createCursorSelection(2, 0)];

        state.deleteWordLeft();

        expect(doc.getText()).toBe("aa\nbbcc\ndd\nee\nff");
        expect(state.foldedRegions.map((region) => [region.startLine, region.endLine])).toEqual([[2, 4]]);
    });

    it("deleteWordRight at end of line joins lines and moves the region up", () => {
        const doc = sixLines();
        const state = new EditorViewState(doc);
        state.setFoldingRegions([createFoldingRegion(3, 5, false)]);
        state.selections = [createCursorSelection(1, 2)];

        state.deleteWordRight();

        expect(doc.getText()).toBe("aa\nbbcc\ndd\nee\nff");
        expect(state.foldedRegions.map((region) => [region.startLine, region.endLine])).toEqual([[2, 4]]);
    });
});
