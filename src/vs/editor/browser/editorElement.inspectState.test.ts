import { Size } from "@tuidom/core/common/geometryPromitives";
import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";
import { describe, expect, it } from "vitest";

import { encodedResult } from "../../../TestUtils/encodedTokens.ts";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { createCursorSelection, createSelection } from "../common/core/iSelection.ts";
import type { EncodedTokenizationResult, ITokenizationSupport } from "../common/languages.ts";
import type { IState } from "../common/languages/iState.ts";
import { NullState } from "../common/languages/nullTokenize.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { DocumentTokenStore } from "../common/tokens/documentTokenStore.ts";
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
        expect(state.insertSpaces).toBe(false);
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

/** One `setImmediate` turn: the next slice of background work (tokenizer, width sweep) has run. */
function idleTick(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

/** Bounded wait: a mutant that never settles must fail the test, not hang the mutation run. */
async function until(condition: () => boolean): Promise<void> {
    for (let i = 0; i < 500 && !condition(); i++) await idleTick();
    if (!condition()) throw new Error("background work did not settle");
}

const nullTokenizer: ITokenizationSupport = {
    getInitialState: (): IState => NullState,
    tokenizeEncoded: (): EncodedTokenizationResult => encodedResult([[0, 0]], NullState),
};

describe("EditorElement.inspectState — background work after open (perf gate)", () => {
    it("tokenizationComplete follows the token store: false while the background tokenizer runs, true once it has finished", async () => {
        const { editor, viewState } = createEditor(new Array<string>(400).fill("x").join("\n"));
        expect(editor.inspectState().tokenizationComplete).toBe(true);

        viewState.tokenStore = new DocumentTokenStore(viewState.document, nullTokenizer);
        expect(editor.inspectState().tokenizationComplete).toBe(false);

        await until(() => editor.inspectState().tokenizationComplete === true);
        expect(viewState.tokenStore.isBackgroundTokenizationCompleted).toBe(true);
        viewState.tokenStore.dispose();
    });

    it("contentWidthFinal: false until the width sweep has measured every line, true after", async () => {
        const text = new Array<string>(1000).fill("0123456789").join("\n");
        const doc = new TextDocument(text);
        const viewState = new EditorViewState(doc);
        const editor = new EditorElement(viewState);
        editor.occurrenceHighlightEnabled = false;
        // Not rendered yet: nothing is measured.
        expect(editor.inspectState().contentWidthFinal).toBe(false);

        // The scrollbar reads `contentWidth` on the frame, which is what starts the sweep (as in the app).
        const app = TestApp.createWithContent(new ScrollBarDecorator(editor), new Size(40, 8));
        app.render();
        // The frame measures its own rows; the rest of the file is still pending.
        expect(editor.inspectState().contentWidthFinal).toBe(false);

        await until(() => editor.inspectState().contentWidthFinal === true);
    });

    it("contentWidthFinal is true under word wrap: the width is the viewport's, there is nothing to sweep", () => {
        const { editor, viewState } = createEditor(new Array<string>(1000).fill("0123456789").join("\n"));
        viewState.wordWrap = "on";
        expect(editor.inspectState().contentWidthFinal).toBe(true);
    });
});
