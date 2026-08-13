import { describe, expect, it } from "vitest";

import { Size } from "@tuidom/all/common/geometryPromitives";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

function createEditor(text: string): { app: TestApp; editor: EditorElement; viewState: EditorViewState } {
    const doc = new TextDocument(text);
    const viewState = new EditorViewState(doc);
    const editor = new EditorElement(viewState);
    const app = TestApp.createWithContent(editor, new Size(80, 24));
    return { app, editor, viewState };
}

// ─── Basic correctness ───────────────────────────────────────

describe("EditorElement.contentWidth", () => {
    it("returns 0 for empty document", () => {
        const { editor } = createEditor("");
        expect(editor.contentWidth).toBe(0);
    });

    it("returns the display width of the widest line", () => {
        const { editor } = createEditor("ab\nabcde\nabc");
        // widest line is "abcde" = 5 columns
        expect(editor.contentWidth).toBe(5);
    });

    it("returns the same value on repeated calls (cache hit)", () => {
        const { editor } = createEditor("hello\nworld\nfoo");
        const first = editor.contentWidth;
        const second = editor.contentWidth;
        expect(second).toBe(first);
    });

    // ─── Cache invalidation ────────────────────────────────────

    it("reflects a newly inserted wider line after content change", () => {
        const { editor, viewState } = createEditor("ab\nabc");
        const before = editor.contentWidth;
        expect(before).toBe(3);

        // Insert a line much wider than any existing line
        viewState.cursorBottom();
        viewState.type("\n" + "x".repeat(20));

        const after = editor.contentWidth;
        expect(after).toBe(20);
        expect(after).toBeGreaterThan(before);
    });

    it("reflects shortened width if wide line is deleted", () => {
        const { editor, viewState } = createEditor("abc\n" + "x".repeat(20) + "\nab");
        expect(editor.contentWidth).toBe(20);

        // Delete the wide line (line 1)
        viewState.selections = [
            { anchor: { line: 1, character: 0 }, active: { line: 2, character: 0 }, idealColumn: undefined },
        ];
        viewState.deleteLeft();

        expect(editor.contentWidth).toBeLessThan(20);
    });
});
