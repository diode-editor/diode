import { Size } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import { createCursorSelection } from "../common/core/iSelection.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

// An input frame renders only on the dirty flag: a standalone editor has no side
// "selections → status bar" chain, so it must mark itself.

describe("EditorElement — markDirty on cursor change", () => {
    it("reassigning selections (typing, mouse, undo, commands) marks layout dirty", () => {
        const viewState = new EditorViewState(new TextDocument("hello\nworld\n"));
        const editor = new EditorElement(viewState);
        TestApp.createWithContent(editor, new Size(30, 5));
        expect(editor.isLayoutDirty).toBe(false);

        viewState.selections = [createCursorSelection(1, 2)];

        expect(editor.isLayoutDirty).toBe(true);
    });

    it("typing a character marks layout dirty without the status bar", () => {
        const viewState = new EditorViewState(new TextDocument("hello\n"));
        const editor = new EditorElement(viewState);
        const app = TestApp.createWithContent(editor, new Size(30, 5));
        editor.focus();
        app.render();
        expect(editor.isLayoutDirty).toBe(false);

        viewState.type("x");

        expect(editor.isLayoutDirty).toBe(true);
    });
});
