import { Size } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import { createRange } from "../common/core/iRange.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";
import { LONG_LINE_TRUNCATION_BADGE_WIDTH, STOP_RENDERING_LINE_AFTER } from "../common/viewModel/longLineRendering.ts";

import { EditorElement } from "./editorElement.ts";

function createEditor(
    text: string,
    size = new Size(80, 24),
): { app: TestApp; editor: EditorElement; viewState: EditorViewState } {
    const doc = new TextDocument(text);
    const viewState = new EditorViewState(doc);
    const editor = new EditorElement(viewState);
    const app = TestApp.createWithContent(editor, size);
    return { app, editor, viewState };
}

describe("EditorElement.contentWidth", () => {
    it("returns 0 for empty document", () => {
        const { editor } = createEditor("");
        expect(editor.contentWidth).toBe(0);
    });

    it("returns the display width of the widest line", () => {
        const { editor } = createEditor("ab\nabcde\nabc");
        expect(editor.contentWidth).toBe(5);
    });

    it("returns the same value on repeated calls (cache hit)", () => {
        const { editor } = createEditor("hello\nworld\nfoo");
        const first = editor.contentWidth;
        const second = editor.contentWidth;
        expect(second).toBe(first);
    });

    it("reflects a newly inserted wider line after content change", () => {
        const { editor, viewState } = createEditor("ab\nabc");
        const before = editor.contentWidth;
        expect(before).toBe(3);

        viewState.cursorBottom();
        viewState.type("\n" + "x".repeat(20));

        const after = editor.contentWidth;
        expect(after).toBe(20);
        expect(after).toBeGreaterThan(before);
    });

    it("reflects shortened width if wide line is deleted", () => {
        const { editor, viewState } = createEditor("abc\n" + "x".repeat(20) + "\nab");
        expect(editor.contentWidth).toBe(20);

        viewState.selections = [
            { anchor: { line: 1, character: 0 }, active: { line: 2, character: 0 }, idealColumn: undefined },
        ];
        viewState.deleteLeft();

        expect(editor.contentWidth).toBeLessThan(20);
    });

    describe("the large-file mode", () => {
        it("has no width cache: the width is the widest line painted so far, never the file's", () => {
            // One row: the 40-wide line is below the viewport and never measured.
            const { app, editor, viewState } = createEditor(
                "ab\n" + "x".repeat(40) + "\n" + "y".repeat(10),
                new Size(80, 1),
            );
            viewState.isTooLargeForTokenization = true;
            app.render();
            expect(editor.contentWidth).toBe(2);
            expect(editor.inspectState().contentWidthFinal).toBe(true);

            viewState.scrollTop = 1;
            app.render();
            expect(editor.contentWidth).toBe(40);
            // The maximum is of what was seen: scrolling on does not shrink it.
            viewState.scrollTop = 2;
            app.render();
            expect(editor.contentWidth).toBe(40);

            // A reload starts over.
            viewState.document.setText("short");
            app.render();
            expect(editor.contentWidth).toBe(5);
        });

        it("never sweeps the file in idle: a wide line below the viewport stays unmeasured", async () => {
            const { app, editor, viewState } = createEditor("ab\n" + "x".repeat(40), new Size(80, 1));
            viewState.isTooLargeForTokenization = true;
            app.render();
            expect(editor.contentWidth).toBe(2);
            // The cache's sweep would run its slices on the next macrotasks.
            await new Promise((resolve) => setImmediate(resolve));
            await new Promise((resolve) => setImmediate(resolve));
            expect(editor.contentWidth).toBe(2);
        });

        it("a line cut at STOP_RENDERING_LINE_AFTER counts the badge; one exactly that long does not", () => {
            const cut = createEditor("x".repeat(STOP_RENDERING_LINE_AFTER + 1), new Size(80, 1));
            cut.viewState.isTooLargeForTokenization = true;
            cut.app.render();
            expect(cut.editor.contentWidth).toBe(STOP_RENDERING_LINE_AFTER + LONG_LINE_TRUNCATION_BADGE_WIDTH);

            const exact = createEditor("y".repeat(STOP_RENDERING_LINE_AFTER), new Size(80, 1));
            exact.viewState.isTooLargeForTokenization = true;
            exact.app.render();
            expect(exact.editor.contentWidth).toBe(STOP_RENDERING_LINE_AFTER);
        });

        it("an edit that is not a reload keeps the widest width seen, as upstream's _maxLineWidth", () => {
            const { app, editor, viewState } = createEditor("x".repeat(40) + "\nab", new Size(80, 2));
            viewState.isTooLargeForTokenization = true;
            app.render();
            expect(editor.contentWidth).toBe(40);
            // The wide line goes; the scrollbar does not shrink until a reload.
            viewState.document.applyEdits([{ range: createRange(0, 0, 1, 0), text: "" }]);
            app.render();
            expect(viewState.document.getText()).toBe("ab");
            expect(editor.contentWidth).toBe(40);
        });

        it("leaving the mode switches to the cache, which measures the whole document", () => {
            const { app, editor, viewState } = createEditor("ab\n" + "x".repeat(40) + "\nabc", new Size(80, 1));
            viewState.isTooLargeForTokenization = true;
            app.render();
            expect(editor.contentWidth).toBe(2);
            viewState.isTooLargeForTokenization = false;
            app.render();
            // The cache measures the viewport on the frame and the rest in idle slices; here the viewport alone.
            expect(editor.contentWidth).toBeGreaterThanOrEqual(2);
            expect(editor.inspectState().contentWidthFinal).toBe(false);
        });
    });
});
