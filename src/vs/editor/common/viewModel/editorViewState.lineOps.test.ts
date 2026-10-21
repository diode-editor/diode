import { describe, expect, it } from "vitest";

import { createFoldingRegion } from "../../contrib/folding/iFoldingRegion.ts";
import { createRange } from "../core/iRange.ts";
import { createCursorSelection, createSelection } from "../core/iSelection.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

function state(text: string, selections: ReturnType<typeof createCursorSelection>[]): EditorViewState {
    return new EditorViewState(new TextDocument(text), selections);
}

describe("EditorViewState.copyLinesDown", () => {
    it("duplicates the cursor line, the cursor moves to the lower copy", () => {
        const s = state("alpha\nbeta\ngamma", [createCursorSelection(0, 3)]);
        const undo = s.copyLinesDown();
        expect(s.document.getText()).toBe("alpha\nalpha\nbeta\ngamma");
        expect(s.selections).toEqual([expect.objectContaining({ active: { line: 1, character: 3 } })]);
        expect(undo?.label).toBe("copyLinesDown");
    });

    it("duplicates all selected lines and keeps the selection on the lower copy", () => {
        const s = state("a\nb\nc\nd", [createSelection(0, 1, 1, 1)]);
        s.copyLinesDown();
        expect(s.document.getText()).toBe("a\nb\na\nb\nc\nd");
        expect(s.selections[0].anchor).toEqual({ line: 2, character: 1 });
        expect(s.selections[0].active).toEqual({ line: 3, character: 1 });
    });

    it("selection ending at column 0 of the next line does not duplicate it", () => {
        const s = state("a\nb\nc", [createSelection(0, 0, 1, 0)]);
        s.copyLinesDown();
        expect(s.document.getText()).toBe("a\na\nb\nc");
    });

    it("multi-cursor: each cursor duplicates its line", () => {
        const s = state("a\nb\nc", [createCursorSelection(0, 0), createCursorSelection(2, 0)]);
        s.copyLinesDown();
        expect(s.document.getText()).toBe("a\na\nb\nc\nc");
        expect(s.selections.map((sel) => sel.active.line)).toEqual([1, 4]);
    });

    it("two cursors on one line duplicate it once", () => {
        const s = state("alpha\nbeta", [createCursorSelection(0, 1), createCursorSelection(0, 3)]);
        s.copyLinesDown();
        expect(s.document.getText()).toBe("alpha\nalpha\nbeta");
        expect(s.selections.map((sel) => sel.active)).toEqual([
            { line: 1, character: 1 },
            { line: 1, character: 3 },
        ]);
    });

    it("duplicate works on the last line too", () => {
        const s = state("a\nb", [createCursorSelection(1, 0)]);
        s.copyLinesDown();
        expect(s.document.getText()).toBe("a\nb\nb");
        expect(s.selections[0].active.line).toBe(2);
    });

    it("read-only: no-op without undo", () => {
        const s = state("a\nb", [createCursorSelection(0, 0)]);
        s.readOnly = true;
        expect(s.copyLinesDown()).toBeUndefined();
        expect(s.document.getText()).toBe("a\nb");
    });

    it("three cursors, two on one line and one below, duplicate each line once", () => {
        const s = state("alpha\nbeta\ngamma", [
            createCursorSelection(0, 1),
            createCursorSelection(0, 3),
            createCursorSelection(2, 0),
        ]);
        s.copyLinesDown();
        expect(s.document.getText()).toBe("alpha\nalpha\nbeta\ngamma\ngamma");
        expect(s.selections.map((sel) => sel.active)).toEqual([
            { line: 1, character: 1 },
            { line: 1, character: 3 },
            { line: 4, character: 0 },
        ]);
    });

    it("multiline block not on line zero shifts the selection by exactly its size", () => {
        const s = state("a\nb\nc\nd\ne\nf", [createSelection(1, 0, 2, 1)]);
        s.copyLinesDown();
        expect(s.document.getText()).toBe("a\nb\nc\nb\nc\nd\ne\nf");
        expect(s.selections[0].anchor).toEqual({ line: 3, character: 0 });
        expect(s.selections[0].active).toEqual({ line: 4, character: 1 });
    });

    it("fold regions shift below the inserted duplicate", () => {
        const s = state("a\nb\nc\nd", [createCursorSelection(0, 0)]);
        s.setFoldingRegions([createFoldingRegion(2, 3)]);
        s.copyLinesDown();
        expect(s.foldedRegions).toEqual([createFoldingRegion(3, 4)]);
    });

    it("duplicate at end of file scrolls the viewport after the moved cursor", () => {
        const doc = Array.from({ length: 30 }, (_, i) => `line${String(i)}`).join("\n");
        const s = state(doc, [createCursorSelection(29, 0)]);
        s.scrollTop = 6; // cursor at the bottom edge of the 80x24 viewport
        s.copyLinesDown();
        expect(s.scrollTop).toBe(7);
    });

    it("edit shape: copy down inserts ABOVE the block, copy up BELOW it", () => {
        // The shape is the contract for undo/redo and fold shifting (forwardEdits replays
        // redo): the text is the same for both shapes, the side effects are not.
        const down = state("alpha\nbeta", [createCursorSelection(0, 2)]);
        expect(down.copyLinesDown()?.forwardEdits).toEqual([{ range: createRange(0, 0, 0, 0), text: "alpha\n" }]);

        const up = state("alpha\nbeta", [createCursorSelection(0, 2)]);
        expect(up.copyLinesUp()?.forwardEdits).toEqual([{ range: createRange(0, 5, 0, 5), text: "\nalpha" }]);
    });
});

describe("EditorViewState.copyLinesUp", () => {
    it("duplicates the line, the cursor stays on the upper copy", () => {
        const s = state("alpha\nbeta", [createCursorSelection(0, 2)]);
        const undo = s.copyLinesUp();
        expect(s.document.getText()).toBe("alpha\nalpha\nbeta");
        expect(s.selections[0].active).toEqual({ line: 0, character: 2 });
        expect(undo?.label).toBe("copyLinesUp");
    });

    it("selection stays on the upper original", () => {
        const s = state("a\nb\nc", [createSelection(1, 0, 2, 1)]);
        s.copyLinesUp();
        expect(s.document.getText()).toBe("a\nb\nc\nb\nc");
        expect(s.selections[0].anchor).toEqual({ line: 1, character: 0 });
        expect(s.selections[0].active).toEqual({ line: 2, character: 1 });
    });

    it("two cursors on one line duplicate it once and stay in place", () => {
        const s = state("alpha\nbeta", [createCursorSelection(0, 1), createCursorSelection(0, 3)]);
        s.copyLinesUp();
        expect(s.document.getText()).toBe("alpha\nalpha\nbeta");
        expect(s.selections.map((sel) => sel.active)).toEqual([
            { line: 0, character: 1 },
            { line: 0, character: 3 },
        ]);
    });

    it("cursor below the duplicated block shifts by its size", () => {
        const s = state("a\nb\nc", [createCursorSelection(0, 0), createCursorSelection(2, 0)]);
        s.copyLinesUp();
        expect(s.document.getText()).toBe("a\na\nb\nc\nc");
        expect(s.selections.map((sel) => sel.active.line)).toEqual([0, 3]);
    });

    it("undo element restores the document and selections", () => {
        const s = state("a\nb", [createCursorSelection(0, 0)]);
        const undo = s.copyLinesUp();
        expect(undo).toBeDefined();
        expect(undo?.beforeSelections[0].active).toEqual({ line: 0, character: 0 });
        s.document.applyEdits(undo?.backwardEdits ?? []);
        expect(s.document.getText()).toBe("a\nb");
    });
});

describe("EditorViewState.duplicateSelection", () => {
    it("collapsed cursor duplicates the line down", () => {
        const s = state("alpha\nbeta", [createCursorSelection(0, 2)]);
        const undo = s.duplicateSelection();
        expect(s.document.getText()).toBe("alpha\nalpha\nbeta");
        expect(s.selections[0].active).toEqual({ line: 1, character: 2 });
        expect(undo?.label).toBe("duplicateSelection");
    });

    it("collapsed cursor above a selection: lines below shift by the duplicated line", () => {
        // Trailing lines below the selection, so a shift bug isn't masked by clamping
        // selections to the document end.
        const s = state("ab\ncd\nef\ngh\nij", [createCursorSelection(0, 1), createSelection(2, 0, 2, 2)]);
        s.duplicateSelection();
        expect(s.document.getText()).toBe("ab\nab\ncd\nefef\ngh\nij");
        expect(s.selections[0].active).toEqual({ line: 1, character: 1 });
        expect(s.selections[1].anchor).toEqual({ line: 3, character: 2 });
        expect(s.selections[1].active).toEqual({ line: 3, character: 4 });
    });

    it("selections on different lines do not inherit each other's column shift", () => {
        const s = state("ab\ncd", [createSelection(0, 0, 0, 2), createSelection(1, 0, 1, 2)]);
        s.duplicateSelection();
        expect(s.document.getText()).toBe("abab\ncdcd");
        expect(s.selections[1].anchor).toEqual({ line: 1, character: 2 });
        expect(s.selections[1].active).toEqual({ line: 1, character: 4 });
    });

    it("line duplicate by a cursor does not shift the column count of a selection on the same line", () => {
        const s = state("abcdef", [createCursorSelection(0, 0), createSelection(0, 2, 0, 4)]);
        s.duplicateSelection();
        expect(s.document.getText()).toBe("abcdef\nabcdcdef");
        expect(s.selections[0].active).toEqual({ line: 1, character: 0 });
        expect(s.selections[1].anchor).toEqual({ line: 1, character: 4 });
        expect(s.selections[1].active).toEqual({ line: 1, character: 6 });
    });

    it("three selections on one line: column shift accumulates across all", () => {
        const s = state("ab cd ef", [
            createSelection(0, 0, 0, 2),
            createSelection(0, 3, 0, 5),
            createSelection(0, 6, 0, 8),
        ]);
        s.duplicateSelection();
        expect(s.document.getText()).toBe("abab cdcd efef");
        expect(s.selections[2].anchor).toEqual({ line: 0, character: 12 });
        expect(s.selections[2].active).toEqual({ line: 0, character: 14 });
    });

    it("cursor between two selections on one line does not lose their column shift", () => {
        // The cursor's edit lands at the START of the line, i.e. left of the first selection's
        // edit: the cumulative "last line delta" didn't model that order and misplaced
        // the third selection.
        const s = state("ab cd ef", [
            createSelection(0, 0, 0, 2),
            createCursorSelection(0, 3),
            createSelection(0, 6, 0, 8),
        ]);
        s.duplicateSelection();
        expect(s.document.getText()).toBe("ab cd ef\nabab cd efef");
        expect(s.selections[0].anchor).toEqual({ line: 1, character: 2 });
        expect(s.selections[0].active).toEqual({ line: 1, character: 4 });
        // The cursor was before `c`; in the line with two inserted copies `c` is now
        // at column 5 — the cursor sticks to its character, not to the column.
        expect(s.selections[1].active).toEqual({ line: 1, character: 5 });
        expect(s.selections[2].anchor).toEqual({ line: 1, character: 10 });
        expect(s.selections[2].active).toEqual({ line: 1, character: 12 });
    });

    it("multiline selection and a selection to its right on its last line", () => {
        // The copy of a multi-line selection does NOT end at column zero: the line tail
        // moves past it, and the next edit's position is computed from it.
        const s = state("ab\ncd ef", [createSelection(0, 0, 1, 2), createSelection(1, 3, 1, 5)]);
        s.duplicateSelection();
        expect(s.document.getText()).toBe("ab\ncdab\ncd efef");
        expect(s.selections[1].anchor).toEqual({ line: 2, character: 5 });
        expect(s.selections[1].active).toEqual({ line: 2, character: 7 });
    });

    it("column shift does not carry across a line boundary", () => {
        const s = state("ab\ncd ef", [
            createSelection(0, 0, 0, 2),
            createSelection(1, 0, 1, 2),
            createSelection(1, 3, 1, 5),
        ]);
        s.duplicateSelection();
        expect(s.document.getText()).toBe("abab\ncdcd efef");
        expect(s.selections[2].anchor).toEqual({ line: 1, character: 7 });
        expect(s.selections[2].active).toEqual({ line: 1, character: 9 });
    });

    it("non-empty selection is duplicated right after itself and selects the copy", () => {
        const s = state("hello world", [createSelection(0, 0, 0, 5)]);
        s.duplicateSelection();
        expect(s.document.getText()).toBe("hellohello world");
        expect(s.selections[0].anchor).toEqual({ line: 0, character: 5 });
        expect(s.selections[0].active).toEqual({ line: 0, character: 10 });
    });

    it("multiline selection is duplicated keeping its line structure", () => {
        const s = state("ab\ncd\nef", [createSelection(0, 1, 1, 1)]);
        s.duplicateSelection();
        expect(s.document.getText()).toBe("ab\ncb\ncd\nef");
        expect(s.selections[0].anchor).toEqual({ line: 1, character: 1 });
        expect(s.selections[0].active).toEqual({ line: 2, character: 1 });
    });

    it("multi-cursor: two selections on one line are each duplicated", () => {
        const s = state("ab cd", [createSelection(0, 0, 0, 2), createSelection(0, 3, 0, 5)]);
        s.duplicateSelection();
        expect(s.document.getText()).toBe("abab cdcd");
        expect(s.selections[0].anchor).toEqual({ line: 0, character: 2 });
        expect(s.selections[0].active).toEqual({ line: 0, character: 4 });
        expect(s.selections[1].anchor).toEqual({ line: 0, character: 7 });
        expect(s.selections[1].active).toEqual({ line: 0, character: 9 });
    });
});

describe("EditorViewState.moveLinesDown", () => {
    it("swaps the cursor line with the line below", () => {
        const s = state("a\nb\nc", [createCursorSelection(0, 1)]);
        const undo = s.moveLinesDown();
        expect(s.document.getText()).toBe("b\na\nc");
        expect(s.selections[0].active).toEqual({ line: 1, character: 1 });
        expect(undo?.label).toBe("moveLinesDown");
    });

    it("moves all selected lines as one block", () => {
        const s = state("a\nb\nc\nd", [createSelection(0, 0, 1, 1)]);
        s.moveLinesDown();
        expect(s.document.getText()).toBe("c\na\nb\nd");
        expect(s.selections[0].anchor).toEqual({ line: 1, character: 0 });
        expect(s.selections[0].active).toEqual({ line: 2, character: 1 });
    });

    it("on the last line: no-op without undo", () => {
        const s = state("a\nb", [createCursorSelection(1, 0)]);
        expect(s.moveLinesDown()).toBeUndefined();
        expect(s.document.getText()).toBe("a\nb");
    });

    it("cursors on adjacent lines move as one block", () => {
        const s = state("a\nb\nc\nd", [createCursorSelection(0, 0), createCursorSelection(1, 0)]);
        s.moveLinesDown();
        expect(s.document.getText()).toBe("c\na\nb\nd");
        expect(s.selections.map((sel) => sel.active.line)).toEqual([1, 2]);
    });

    it("separate cursors move independently", () => {
        const s = state("a\nb\nc\nd\ne", [createCursorSelection(0, 0), createCursorSelection(3, 0)]);
        s.moveLinesDown();
        expect(s.document.getText()).toBe("b\na\nc\ne\nd");
        expect(s.selections.map((sel) => sel.active.line)).toEqual([1, 4]);
    });

    it("block at the bottom edge stays, others move", () => {
        const s = state("a\nb\nc\nd", [createCursorSelection(0, 0), createCursorSelection(3, 0)]);
        s.moveLinesDown();
        expect(s.document.getText()).toBe("b\na\nc\nd");
        expect(s.selections.map((sel) => sel.active.line)).toEqual([1, 3]);
    });
});

describe("EditorViewState.moveLinesUp", () => {
    it("swaps the cursor line with the line above", () => {
        const s = state("a\nb\nc", [createCursorSelection(1, 0)]);
        const undo = s.moveLinesUp();
        expect(s.document.getText()).toBe("b\na\nc");
        expect(s.selections[0].active).toEqual({ line: 0, character: 0 });
        expect(undo?.label).toBe("moveLinesUp");
    });

    it("on the first line: no-op", () => {
        const s = state("a\nb", [createCursorSelection(0, 0)]);
        expect(s.moveLinesUp()).toBeUndefined();
        expect(s.document.getText()).toBe("a\nb");
    });

    it("selection ending at column 0 does not drag its last line", () => {
        const s = state("a\nb\nc", [createSelection(1, 0, 2, 0)]);
        s.moveLinesUp();
        expect(s.document.getText()).toBe("b\na\nc");
        expect(s.selections[0].anchor).toEqual({ line: 0, character: 0 });
        expect(s.selections[0].active).toEqual({ line: 1, character: 0 });
    });
});

describe("EditorViewState.deleteLines", () => {
    it("deletes the whole cursor line, the cursor keeps its column", () => {
        const s = state("alpha\nbeta\ngamma", [createCursorSelection(1, 2)]);
        const undo = s.deleteLines();
        expect(s.document.getText()).toBe("alpha\ngamma");
        expect(s.selections[0].active).toEqual({ line: 1, character: 2 });
        expect(undo?.label).toBe("deleteLines");
    });

    it("column is clamped to the new line length", () => {
        const s = state("alpha\nb", [createCursorSelection(0, 4)]);
        s.deleteLines();
        expect(s.document.getText()).toBe("b");
        expect(s.selections[0].active).toEqual({ line: 0, character: 1 });
    });

    it("deletes all selected lines", () => {
        const s = state("a\nb\nc\nd", [createSelection(1, 0, 2, 1)]);
        s.deleteLines();
        expect(s.document.getText()).toBe("a\nd");
        expect(s.selections[0].active.line).toBe(1);
    });

    it("last line is deleted together with the preceding line break", () => {
        const s = state("a\nb\nc", [createCursorSelection(2, 0)]);
        s.deleteLines();
        expect(s.document.getText()).toBe("a\nb");
        expect(s.selections[0].active).toEqual({ line: 1, character: 0 });
    });

    it("the only line of the document is cleared, not deleted", () => {
        const s = state("alpha", [createCursorSelection(0, 3)]);
        s.deleteLines();
        expect(s.document.getText()).toBe("");
        expect(s.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("multi-cursor: adjacent lines merge into one block with one cursor", () => {
        const s = state("a\nb\nc\nd", [createCursorSelection(0, 0), createCursorSelection(1, 0)]);
        s.deleteLines();
        expect(s.document.getText()).toBe("c\nd");
        expect(s.selections).toHaveLength(1);
        expect(s.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("separate cursors each delete their own line", () => {
        const s = state("a\nb\nc\nd\ne", [createCursorSelection(0, 0), createCursorSelection(2, 0)]);
        s.deleteLines();
        expect(s.document.getText()).toBe("b\nd\ne");
        expect(s.selections.map((sel) => sel.active.line)).toEqual([0, 1]);
    });

    it("lines deleted above move up the cursor landing of the next block", () => {
        const s = state("a\nb\nc\nd\ne\nf", [createCursorSelection(1, 0), createCursorSelection(3, 0)]);
        s.deleteLines();
        expect(s.document.getText()).toBe("a\nc\ne\nf");
        expect(s.selections.map((sel) => sel.active.line)).toEqual([1, 2]);
    });

    it("selection ending at column 0 does not delete its last line", () => {
        const s = state("a\nb\nc", [createSelection(0, 0, 1, 0)]);
        s.deleteLines();
        expect(s.document.getText()).toBe("b\nc");
    });
});
