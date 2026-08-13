import { describe, expect, it } from "vitest";

import { Size } from "@tuidom/all/common/geometryPromitives";
import { TUIMouseEvent } from "@tuidom/all/dom/events/tuiMouseEvent";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { createRange } from "../common/core/iRange.ts";
import { isSelectionCollapsed, selectionToRange } from "../common/core/iSelection.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

function createEditor(text: string, width = 30, height = 5): { app: TestApp; editor: EditorElement } {
    const doc = new TextDocument(text);
    const viewState = new EditorViewState(doc);
    const editor = new EditorElement(viewState);
    const app = TestApp.createWithContent(editor, new Size(width, height));
    return { app, editor };
}

function fireMouseDown(editor: EditorElement, localX: number, localY: number, shiftKey = false): void {
    editor.dispatchEvent(
        new TUIMouseEvent("mousedown", {
            button: "left",
            screenX: localX,
            screenY: localY,
            localX,
            localY,
            shiftKey,
        }),
    );
}

function fireDoubleClick(
    editor: EditorElement,
    localX: number,
    localY: number,
    button: "left" | "right" = "left",
): void {
    editor.dispatchEvent(
        new TUIMouseEvent("dblclick", {
            button,
            screenX: localX,
            screenY: localY,
            localX,
            localY,
        }),
    );
}

describe("EditorElement – mouse click cursor placement", () => {
    it("click in content area places cursor at correct line and character", () => {
        const { editor } = createEditor("hello\nworld\nfoo", 30, 5);
        const gw = editor.gutterWidth;

        // Click on row 1 (second line), after "wo" (2 chars into content)
        fireMouseDown(editor, gw + 2, 1);

        const sel = editor.viewState.selections[0];
        expect(sel.active.line).toBe(1);
        expect(sel.active.character).toBe(2);
    });

    it("click at start of line places cursor at character 0", () => {
        const { editor } = createEditor("hello\nworld", 30, 5);
        const gw = editor.gutterWidth;

        fireMouseDown(editor, gw + 0, 0);

        const sel = editor.viewState.selections[0];
        expect(sel.active.line).toBe(0);
        expect(sel.active.character).toBe(0);
    });

    it("click in gutter places cursor at beginning of that line", () => {
        const { editor } = createEditor("hello\nworld", 30, 5);

        // Click in gutter (x=0)
        fireMouseDown(editor, 0, 1);

        const sel = editor.viewState.selections[0];
        expect(sel.active.line).toBe(1);
        expect(sel.active.character).toBe(0);
    });

    it("click past end of line places cursor at end of line", () => {
        const { editor } = createEditor("hi\nworld", 30, 5);
        const gw = editor.gutterWidth;

        // "hi" is 2 chars; click at column 100 far past end
        fireMouseDown(editor, gw + 100, 0);

        const sel = editor.viewState.selections[0];
        expect(sel.active.line).toBe(0);
        expect(sel.active.character).toBe(2); // end of "hi"
    });

    it("click past last line places cursor on last line", () => {
        const { editor } = createEditor("hello\nworld", 30, 3);
        const gw = editor.gutterWidth;

        // Click on row 10, far beyond document (only 2 lines)
        fireMouseDown(editor, gw + 0, 10);

        const sel = editor.viewState.selections[0];
        expect(sel.active.line).toBe(1); // last line
    });

    it("shift+click extends selection from existing anchor", () => {
        const { editor } = createEditor("hello\nworld\nfoo", 30, 5);
        const gw = editor.gutterWidth;

        // Place cursor at line 0, char 0
        fireMouseDown(editor, gw + 0, 0);
        // Shift-click at line 1, char 3
        fireMouseDown(editor, gw + 3, 1, true);

        const sel = editor.viewState.selections[0];
        expect(sel.anchor.line).toBe(0);
        expect(sel.anchor.character).toBe(0);
        expect(sel.active.line).toBe(1);
        expect(sel.active.character).toBe(3);
    });

    it("click with scrollTop > 0 accounts for scroll offset (correct logical line)", () => {
        const { editor } = createEditor("line0\nline1\nline2\nline3\nline4", 30, 3);
        const gw = editor.gutterWidth;

        // Manually scroll down by 2 lines
        editor.viewState.scrollTop = 2;

        // Click on screen row 0 now corresponds to logical line 2
        fireMouseDown(editor, gw + 0, 0);

        const sel = editor.viewState.selections[0];
        expect(sel.active.line).toBe(2);
    });

    it("click with scrollLeft > 0 accounts for horizontal scroll offset", () => {
        const { editor } = createEditor("abcdefghij", 15, 3);
        const gw = editor.gutterWidth;

        // Scroll right by 5 columns
        editor.viewState.scrollLeft = 5;

        // Click at screen column 0 in content area → display column 5 → char offset 5
        fireMouseDown(editor, gw + 0, 0);

        const sel = editor.viewState.selections[0];
        expect(sel.active.line).toBe(0);
        expect(sel.active.character).toBe(5);
    });
});

describe("EditorElement – double click word selection", () => {
    it("selects the word under the cursor", () => {
        const { editor } = createEditor("hello world\nfoo", 30, 5);
        const gw = editor.gutterWidth;

        // Land inside "world" (starts at char 6)
        fireDoubleClick(editor, gw + 8, 0);

        const sel = editor.viewState.selections[0];
        expect(selectionToRange(sel)).toEqual(createRange(0, 6, 0, 11));
    });

    it("selects the word when clicking its first character", () => {
        const { editor } = createEditor("hello world", 30, 5);
        const gw = editor.gutterWidth;

        fireDoubleClick(editor, gw + 6, 0);

        expect(selectionToRange(editor.viewState.selections[0])).toEqual(createRange(0, 6, 0, 11));
    });

    it("selects the word to the left when the caret lands just past its end", () => {
        const { editor } = createEditor("hello world", 30, 5);
        const gw = editor.gutterWidth;

        // Column 5 is the space; VS Code treats a caret right after a word as on it.
        fireDoubleClick(editor, gw + 5, 0);

        expect(selectionToRange(editor.viewState.selections[0])).toEqual(createRange(0, 0, 0, 5));
    });

    it("stops at punctuation rather than swallowing the whole expression", () => {
        const { editor } = createEditor("foo.barBaz(1)", 30, 5);
        const gw = editor.gutterWidth;

        fireDoubleClick(editor, gw + 5, 0); // inside "barBaz"

        expect(selectionToRange(editor.viewState.selections[0])).toEqual(createRange(0, 4, 0, 10));
    });

    it("leaves the caret alone when double clicking whitespace", () => {
        const { editor } = createEditor("a    b", 30, 5);
        const gw = editor.gutterWidth;

        fireMouseDown(editor, gw + 3, 0); // caret into the run of spaces
        fireDoubleClick(editor, gw + 3, 0);

        const sel = editor.viewState.selections[0];
        expect(isSelectionCollapsed(sel)).toBe(true);
        expect(sel.active.character).toBe(3);
    });

    it("selects on the correct line when scrolled vertically", () => {
        const { editor } = createEditor("one\ntwo\nthree\nfour\nfive\nsix seven", 30, 3);
        const gw = editor.gutterWidth;
        editor.viewState.scrollTop = 5;

        // Row 0 on screen is now line 5 ("six seven"); land inside "seven".
        fireDoubleClick(editor, gw + 5, 0);

        expect(selectionToRange(editor.viewState.selections[0])).toEqual(createRange(5, 4, 5, 9));
    });

    it("ignores double clicks on the gutter", () => {
        const { editor } = createEditor("hello world", 30, 5);

        fireMouseDown(editor, 0, 0);
        fireDoubleClick(editor, 0, 0);

        // Gutter is not text — must not select the line's first word.
        expect(isSelectionCollapsed(editor.viewState.selections[0])).toBe(true);
    });

    it("ignores right-button double clicks", () => {
        const { editor } = createEditor("hello world", 30, 5);
        const gw = editor.gutterWidth;

        fireMouseDown(editor, gw + 8, 0);
        fireDoubleClick(editor, gw + 8, 0, "right");

        expect(isSelectionCollapsed(editor.viewState.selections[0])).toBe(true);
    });

    it("clears the drag anchor so a stale mousedown cannot re-drag the selection", () => {
        const { editor } = createEditor("hello world", 30, 5);
        const gw = editor.gutterWidth;

        fireMouseDown(editor, gw + 8, 0);
        fireDoubleClick(editor, gw + 8, 0);
        // A move with no button held must not collapse the word selection.
        editor.dispatchEvent(
            new TUIMouseEvent("mousemove", { button: "none", screenX: gw + 2, screenY: 0, localX: gw + 2, localY: 0 }),
        );

        expect(selectionToRange(editor.viewState.selections[0])).toEqual(createRange(0, 6, 0, 11));
    });
});
