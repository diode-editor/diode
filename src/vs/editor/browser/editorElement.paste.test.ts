import { describe, expect, it } from "vitest";

import { Size } from "@tuidom/all/common/geometryPromitives";
import { TUIPasteEvent } from "@tuidom/all/dom/events/tuiPasteEvent";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { createCursorSelection } from "../common/core/iSelection.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

function createEditor(text: string): { app: TestApp; editor: EditorElement } {
    const doc = new TextDocument(text);
    const viewState = new EditorViewState(doc);
    const editor = new EditorElement(viewState);
    const app = TestApp.createWithContent(editor, new Size(40, 6));
    editor.focus();
    return { app, editor };
}

describe("EditorElement — bracketed paste", () => {
    it("inserts a multi-line paste at the cursor in one edit", () => {
        const { editor } = createEditor("ab");
        editor.viewState.selections = [createCursorSelection(0, 1)]; // between a and b

        editor.dispatchEvent(new TUIPasteEvent("X\nY"));

        expect(editor.viewState.document.getText()).toBe("aX\nYb");
    });

    it("a pasted block is a single undo step", () => {
        const { editor } = createEditor("");
        editor.viewState.selections = [createCursorSelection(0, 0)];

        editor.dispatchEvent(new TUIPasteEvent("one\ntwo\nthree"));
        expect(editor.viewState.document.getText()).toBe("one\ntwo\nthree");

        editor.undoManager.undo();
        expect(editor.viewState.document.getText()).toBe("");
    });
});
