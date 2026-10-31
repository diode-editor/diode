import { describe, expect, it } from "vitest";

import { EndOfLine } from "../core/endOfLine.ts";
import { createRange } from "../core/iRange.ts";
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

/** No text edit; the version doesn't change. */
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

    it("does not change line content; each change of the ending is a version", () => {
        const { doc, viewState, undoManager } = setup("a\nb");
        const versionBefore = doc.versionId;

        doc.setEol(EndOfLine.CRLF);
        undoManager.pushUndoElement(eolElement(doc, viewState, EndOfLine.LF, EndOfLine.CRLF));

        undoManager.undo(viewState);
        undoManager.redo(viewState);

        expect(doc.getText()).toBe("a\nb");
        expect(doc.versionId).toBe(versionBefore + 3);
    });

    it("stays consistent when interleaved with text edits", () => {
        const { doc, viewState, undoManager } = setup("hello");
        viewState.selections = [createCursorSelection(0, 5)];

        doc.setEol(EndOfLine.CRLF);
        undoManager.pushUndoElement(eolElement(doc, viewState, EndOfLine.LF, EndOfLine.CRLF));

        const typeElement = viewState.type(" world");
        undoManager.pushUndoElement(typeElement!);
        expect(doc.getText()).toBe("hello world");
        expect(doc.eol).toBe(EndOfLine.CRLF);

        expect(undoManager.undo(viewState)).toBe(true);
        expect(doc.getText()).toBe("hello");
        expect(doc.eol).toBe(EndOfLine.CRLF);

        expect(undoManager.undo(viewState)).toBe(true);
        expect(doc.eol).toBe(EndOfLine.LF);

        expect(undoManager.redo(viewState)).toBe(true);
        expect(doc.eol).toBe(EndOfLine.CRLF);

        expect(undoManager.redo(viewState)).toBe(true);
        expect(doc.getText()).toBe("hello world");
        expect(doc.eol).toBe(EndOfLine.CRLF);
    });
});

describe("UndoManager joined steps", () => {
    const edit = (doc: TextDocument, text: string): IUndoElement => {
        const versionBefore = doc.versionId;
        const forwardEdits = [{ range: createRange(0, 0, 0, 0), text }];
        const { appliedVersion, inverseEdits } = doc.applyEdits(forwardEdits);
        return {
            label: text,
            versionBefore,
            versionAfter: appliedVersion,
            forwardEdits,
            backwardEdits: inverseEdits,
            beforeSelections: [],
            afterSelections: [],
        };
    };

    it("one undo and one redo move the whole step, and only it", () => {
        const { doc, undoManager } = setup("x");
        undoManager.pushUndoElement(edit(doc, "0"));
        undoManager.pushUndoElement(edit(doc, "1"));
        undoManager.joinUndoElement(edit(doc, "2"));

        expect(undoManager.undo()).toBe(true);
        expect(doc.getText()).toBe("0x");
        expect(undoManager.redo()).toBe(true);
        expect(doc.getText()).toBe("210x");
        expect(undoManager.undo()).toBe(true);
        expect(undoManager.undo()).toBe(true);
        expect(doc.getText()).toBe("x");
    });

    it("the step's token answers for the joined element, a joined edit announces no step", () => {
        const { doc, undoManager } = setup("x");
        const announced: string[] = [];
        undoManager.onDidPush = (element) => announced.push(element.label);
        undoManager.pushUndoElement(edit(doc, "1"));
        const token = undoManager.peekUndoStep();
        undoManager.joinUndoElement(edit(doc, "2"));

        expect(announced).toEqual(["1"]);
        expect(undoManager.canUndoStep(token)).toBe(true);
    });

    it("joining on an empty stack is an ordinary step", () => {
        const { doc, undoManager } = setup("x");
        const announced: string[] = [];
        undoManager.onDidPush = (element) => announced.push(element.label);
        undoManager.joinUndoElement(edit(doc, "1"));

        expect(announced).toEqual(["1"]);
        expect(undoManager.undo()).toBe(true);
        expect(doc.getText()).toBe("x");
    });

    it("a new edit clears the redo stack of a joined step", () => {
        const { doc, undoManager } = setup("x");
        undoManager.pushUndoElement(edit(doc, "1"));
        undoManager.undo();
        undoManager.joinUndoElement(edit(doc, "2"));

        expect(undoManager.canRedo).toBe(false);
    });
});
