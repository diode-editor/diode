import { describe, expect, it } from "vitest";

import { EndOfLine } from "../core/endOfLine.ts";
import { createCursorSelection } from "../core/iSelection.ts";
import { EditorViewState } from "../viewModel/editorViewState.ts";

import type { IUndoElement } from "./iUndoElement.ts";
import { TextDocument } from "./textDocument.ts";
import { UndoManager } from "./undoManager.ts";

function setup(text: string) {
    const doc = new TextDocument(text);
    const viewState = new EditorViewState(doc);
    const undoManager = new UndoManager(doc);
    return { doc, viewState, undoManager };
}

/** Builds a pure-EOL undo element (no text change, version unchanged). */
function eolElement(doc: TextDocument, viewState: EditorViewState, before: EndOfLine, after: EndOfLine): IUndoElement {
    const selections = [...viewState.selections];
    return {
        label: "Change End of Line Sequence",
        versionBefore: doc.versionId,
        versionAfter: doc.versionId,
        forwardEdits: [],
        backwardEdits: [],
        beforeSelections: selections,
        afterSelections: selections,
        eolBefore: before,
        eolAfter: after,
    };
}

describe("UndoManager EOL changes", () => {
    it("undo restores the previous eol, redo re-applies it", () => {
        const { doc, viewState, undoManager } = setup("a\nb");
        expect(doc.eol).toBe(EndOfLine.LF);

        doc.setEol(EndOfLine.CRLF);
        undoManager.pushUndoElement(eolElement(doc, viewState, EndOfLine.LF, EndOfLine.CRLF));
        expect(doc.eol).toBe(EndOfLine.CRLF);

        expect(undoManager.undo(viewState)).toBe(true);
        expect(doc.eol).toBe(EndOfLine.LF);

        expect(undoManager.redo(viewState)).toBe(true);
        expect(doc.eol).toBe(EndOfLine.CRLF);
    });

    it("does not change line content or versionId", () => {
        const { doc, viewState, undoManager } = setup("a\nb");
        const versionBefore = doc.versionId;

        doc.setEol(EndOfLine.CRLF);
        undoManager.pushUndoElement(eolElement(doc, viewState, EndOfLine.LF, EndOfLine.CRLF));

        undoManager.undo(viewState);
        undoManager.redo(viewState);

        expect(doc.getText()).toBe("a\nb");
        expect(doc.versionId).toBe(versionBefore);
    });

    it("stays consistent when interleaved with text edits", () => {
        const { doc, viewState, undoManager } = setup("hello");
        viewState.selections = [createCursorSelection(0, 5)];

        // 1) eol change LF -> CRLF
        doc.setEol(EndOfLine.CRLF);
        undoManager.pushUndoElement(eolElement(doc, viewState, EndOfLine.LF, EndOfLine.CRLF));

        // 2) text edit
        const typeElement = viewState.type(" world");
        undoManager.pushUndoElement(typeElement!);
        expect(doc.getText()).toBe("hello world");
        expect(doc.eol).toBe(EndOfLine.CRLF);

        // undo text edit -> content back, eol untouched
        expect(undoManager.undo(viewState)).toBe(true);
        expect(doc.getText()).toBe("hello");
        expect(doc.eol).toBe(EndOfLine.CRLF);

        // undo eol change -> eol back to LF
        expect(undoManager.undo(viewState)).toBe(true);
        expect(doc.eol).toBe(EndOfLine.LF);

        // redo eol change
        expect(undoManager.redo(viewState)).toBe(true);
        expect(doc.eol).toBe(EndOfLine.CRLF);

        // redo text edit
        expect(undoManager.redo(viewState)).toBe(true);
        expect(doc.getText()).toBe("hello world");
        expect(doc.eol).toBe(EndOfLine.CRLF);
    });
});
