import { describe, expect, it } from "vitest";

import { createFoldingRegion } from "../../contrib/folding/iFoldingRegion.ts";
import { createCursorSelection, createSelection } from "../core/iSelection.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

function state(text: string, selections: ReturnType<typeof createCursorSelection>[]): EditorViewState {
    return new EditorViewState(new TextDocument(text), selections);
}

describe("EditorViewState.getTextToCopy", () => {
    it("empty selection yields the whole line with \\n and the full-line marker", () => {
        const s = state("alpha\nbeta", [createCursorSelection(0, 3)]);
        expect(s.getTextToCopy(true)).toEqual({ text: "alpha\n", isFromEmptySelection: true });
    });

    it("with the setting off an empty selection yields nothing", () => {
        const s = state("alpha\nbeta", [createCursorSelection(0, 3)]);
        expect(s.getTextToCopy(false)).toEqual({ text: "", isFromEmptySelection: false });
    });

    it("non-empty selection yields its text without the marker", () => {
        const s = state("alpha\nbeta", [createSelection(0, 0, 0, 5)]);
        expect(s.getTextToCopy(true)).toEqual({ text: "alpha", isFromEmptySelection: false });
    });

    it("cursor not on the first line yields its line", () => {
        const s = state("alpha\nbeta", [createCursorSelection(1, 2)]);
        expect(s.getTextToCopy(true)).toEqual({ text: "beta\n", isFromEmptySelection: true });
    });

    it("mixed set: first cursor not on the first line carries its line", () => {
        const s = state("alpha\nbeta\ngamma", [createCursorSelection(1, 1), createSelection(2, 0, 2, 2)]);
        expect(s.getTextToCopy(true)).toEqual({ text: "beta\nga", isFromEmptySelection: false });
    });

    it("with the setting off a mixed set yields only the selected text", () => {
        const s = state("alpha\nbeta", [createCursorSelection(0, 1), createSelection(1, 0, 1, 2)]);
        expect(s.getTextToCopy(false)).toEqual({ text: "be", isFromEmptySelection: false });
    });

    it("several empty cursors yield their lines, no full-line marker", () => {
        const s = state("a\nb\nc", [createCursorSelection(0, 0), createCursorSelection(2, 0)]);
        expect(s.getTextToCopy(true)).toEqual({ text: "a\nc\n", isFromEmptySelection: false });
    });

    it("two cursors on one line carry it once, the marker only for a single one", () => {
        const s = state("alpha\nbeta", [createCursorSelection(0, 1), createCursorSelection(0, 4)]);
        expect(s.getTextToCopy(true)).toEqual({ text: "alpha\n", isFromEmptySelection: false });
    });

    it("mixed set: empty cursor on a selection line does not duplicate the line", () => {
        const s = state("hello world", [createSelection(0, 0, 0, 5), createCursorSelection(0, 8)]);
        expect(s.getTextToCopy(true)).toEqual({ text: "hello", isFromEmptySelection: false });
    });

    it("mixed set: empty cursors carry the line, non-empty ones the selected text", () => {
        const s = state("alpha\nbeta\ngamma", [createCursorSelection(0, 2), createSelection(2, 0, 2, 5)]);
        expect(s.getTextToCopy(true)).toEqual({ text: "alpha\ngamma", isFromEmptySelection: false });
    });
});

describe("EditorViewState.cutSelections", () => {
    it("empty cursor cuts the whole line with its line break", () => {
        const s = state("alpha\nbeta\ngamma", [createCursorSelection(1, 2)]);
        const undo = s.cutSelections(true);
        expect(s.document.getText()).toBe("alpha\ngamma");
        expect(s.selections[0].active).toEqual({ line: 1, character: 0 });
        expect(undo?.label).toBe("cut");
    });

    it("with the setting off an empty cursor cuts nothing", () => {
        const s = state("alpha\nbeta", [createCursorSelection(0, 2)]);
        expect(s.cutSelections(false)).toBeUndefined();
        expect(s.document.getText()).toBe("alpha\nbeta");
    });

    it("non-empty selection cuts only the range", () => {
        const s = state("hello world", [createSelection(0, 0, 0, 6)]);
        s.cutSelections(true);
        expect(s.document.getText()).toBe("world");
        expect(s.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("last line is cut together with the preceding line break", () => {
        const s = state("a\nb\nc", [createCursorSelection(2, 1)]);
        s.cutSelections(true);
        expect(s.document.getText()).toBe("a\nb");
    });

    it("the only line of the document is cleared", () => {
        const s = state("alpha", [createCursorSelection(0, 2)]);
        s.cutSelections(true);
        expect(s.document.getText()).toBe("");
    });

    it("multi-cursor: each empty cursor cuts its line, cursors stay", () => {
        const s = state("a\nb\nc\nd", [createCursorSelection(0, 0), createCursorSelection(2, 0)]);
        s.cutSelections(true);
        expect(s.document.getText()).toBe("b\nd");
        expect(s.selections.map((sel) => sel.active.line)).toEqual([0, 1]);
    });

    it("cursors on adjacent lines mid-document each cut their own line", () => {
        const s = state("a\nb\nc\nd", [createCursorSelection(0, 0), createCursorSelection(1, 0)]);
        s.cutSelections(true);
        expect(s.document.getText()).toBe("c\nd");
        expect(s.selections.map((sel) => sel.active.line)).toEqual([0]);
    });

    it("cursors on adjacent lines near the end of document cut without edit conflicts", () => {
        const s = state("a\nb\nc", [createCursorSelection(1, 0), createCursorSelection(2, 0)]);
        s.cutSelections(true);
        expect(s.document.getText()).toBe("a");
    });

    it("mixed set: empty cursor cuts the line, non-empty selection the range", () => {
        const s = state("alpha\nbeta\ngamma", [createCursorSelection(0, 2), createSelection(2, 0, 2, 3)]);
        s.cutSelections(true);
        expect(s.document.getText()).toBe("beta\nma");
    });

    it("empty cursor on a non-empty selection line does not cut the line a second time", () => {
        const s = state("hello world", [createCursorSelection(0, 8), createSelection(0, 0, 0, 5)]);
        s.cutSelections(true);
        // A selection already touches the line, so the cursor doesn't add a whole-line delete.
        expect(s.document.getText()).toBe(" world");
    });

    it("two cursors on one line cut it once", () => {
        const s = state("alpha\nbeta", [createCursorSelection(0, 1), createCursorSelection(0, 4)]);
        s.cutSelections(true);
        expect(s.document.getText()).toBe("beta");
    });

    it("cursor below a selection cuts its line", () => {
        const s = state("alpha\nbeta\ngamma", [createSelection(0, 0, 0, 3), createCursorSelection(2, 1)]);
        s.cutSelections(true);
        expect(s.document.getText()).toBe("ha\nbeta");
    });

    it("read-only: cut is a no-op without undo", () => {
        const s = state("alpha", [createCursorSelection(0, 0)]);
        s.readOnly = true;
        expect(s.cutSelections(true)).toBeUndefined();
        expect(s.document.getText()).toBe("alpha");
    });

    it("cut scrolls the viewport to the cursor if it left the screen", () => {
        // The user scrolled away from the cursor with the wheel and hit Ctrl+X: the edit happens
        // at the cursor, so that is what must be revealed (as in VS Code).
        const doc = Array.from({ length: 40 }, (_, i) => `line${String(i)}`).join("\n");
        const s = state(doc, [createCursorSelection(0, 0)]);
        s.scrollTop = 15;
        s.cutSelections(true);
        expect(s.document.getText().startsWith("line1\n")).toBe(true);
        expect(s.scrollTop).toBe(0);
    });

    it("line cut shifts fold regions below", () => {
        const s = state("a\nb\nc\nd", [createCursorSelection(0, 0)]);
        s.setFoldingRegions([createFoldingRegion(2, 3)]);
        s.cutSelections(true);
        expect(s.foldedRegions).toEqual([createFoldingRegion(1, 2)]);
    });
});

describe("EditorViewState.pasteText", () => {
    it("full-line paste puts the line above the cursor line, the cursor stays at its text", () => {
        const s = state("alpha\nbeta", [createCursorSelection(1, 2)]);
        const undo = s.pasteText("copied\n", true);
        expect(s.document.getText()).toBe("alpha\ncopied\nbeta");
        expect(s.selections[0].active).toEqual({ line: 2, character: 2 });
        expect(undo?.label).toBe("paste");
    });

    it("without the full-line marker pastes at the cursor position", () => {
        const s = state("alpha\nbeta", [createCursorSelection(1, 2)]);
        s.pasteText("copied\n", false);
        expect(s.document.getText()).toBe("alpha\nbecopied\nta");
    });

    it("full-line mode applies only to single-line text with a trailing \\n", () => {
        const s = state("ab", [createCursorSelection(0, 1)]);
        s.pasteText("x\ny\n", true);
        expect(s.document.getText()).toBe("ax\ny\nb");
    });

    it("non-empty selection is replaced by the text even on full-line paste", () => {
        const s = state("alpha\nbeta", [createSelection(0, 0, 0, 5)]);
        s.pasteText("copied\n", true);
        expect(s.document.getText()).toBe("copied\n\nbeta");
    });

    it("multi-cursor: each empty cursor gets a line above itself", () => {
        const s = state("a\nb", [createCursorSelection(0, 1), createCursorSelection(1, 1)]);
        s.pasteText("x\n", true);
        expect(s.document.getText()).toBe("x\na\nx\nb");
        expect(s.selections.map((sel) => sel.active)).toEqual([
            { line: 1, character: 1 },
            { line: 3, character: 1 },
        ]);
    });

    it("read-only: full-line paste is a no-op without undo", () => {
        const s = state("alpha", [createCursorSelection(0, 0)]);
        s.readOnly = true;
        expect(s.pasteText("copied\n", true)).toBeUndefined();
        expect(s.document.getText()).toBe("alpha");
    });

    it("pasting an empty line (just \\n) in full-line mode puts an empty line above", () => {
        const s = state("alpha", [createCursorSelection(0, 3)]);
        s.pasteText("\n", true);
        expect(s.document.getText()).toBe("\nalpha");
        expect(s.selections[0].active).toEqual({ line: 1, character: 3 });
    });

    it("full-line paste shifts fold regions below", () => {
        const s = state("a\nb\nc\nd", [createCursorSelection(0, 0)]);
        s.setFoldingRegions([createFoldingRegion(2, 3)]);
        s.pasteText("x\n", true);
        expect(s.foldedRegions).toEqual([createFoldingRegion(3, 4)]);
    });

    it("full-line paste at end of file scrolls the viewport after the cursor", () => {
        const doc = Array.from({ length: 30 }, (_, i) => `line${String(i)}`).join("\n");
        const s = state(doc, [createCursorSelection(29, 0)]);
        s.scrollTop = 6; // cursor at the bottom edge of the 80x24 viewport
        s.pasteText("x\n", true);
        expect(s.scrollTop).toBe(7);
    });
});
