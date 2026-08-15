import { describe, expect, it } from "vitest";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { createCursorSelection, createSelection } from "../common/core/iSelection.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

function createEditor(text: string): { editor: EditorElement; viewState: EditorViewState } {
    const doc = new TextDocument(text);
    const viewState = new EditorViewState(doc);
    const editor = new EditorElement(viewState);
    TestApp.createWithContent(editor, new Size(40, 8));
    return { editor, viewState };
}

describe("EditorElement.inspectState", () => {
    it("reports a collapsed cursor with no selection", () => {
        const { editor } = createEditor("const greeting = 42\nconst other = 7\n");
        editor.viewState.selections = [createCursorSelection(1, 3)];

        const state = editor.inspectState();
        expect(state.readOnly).toBe(false);
        expect(state.lineCount).toBe(3);
        expect(state.tabSize).toBe(4);
        expect(state.hasSelection).toBe(false);
        expect(state.selections).toEqual([
            {
                anchor: { line: 1, character: 3 },
                active: { line: 1, character: 3 },
                collapsed: true,
            },
        ]);
    });

    it("reports a non-collapsed selection and readOnly/fold/scroll state", () => {
        const { editor, viewState } = createEditor("a\nb\nc\nd\ne\nf\ng\nh\n");
        viewState.readOnly = true;
        viewState.selections = [createSelection(0, 0, 2, 1)];
        viewState.scrollTop = 2;
        viewState.foldedRegions = [{ startLine: 3, endLine: 5, isCollapsed: true }];

        const state = editor.inspectState();
        expect(state.readOnly).toBe(true);
        expect(state.hasSelection).toBe(true);
        expect(state.scrollTop).toBe(2);
        expect(state.foldedRegions).toEqual([{ startLine: 3, endLine: 5 }]);
        expect((state.selections as { collapsed: boolean }[])[0].collapsed).toBe(false);
    });
});
