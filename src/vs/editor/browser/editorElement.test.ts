import { describe, expect, it } from "vitest";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { createCursorSelection } from "../common/core/iSelection.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

function createEditor(text: string, width = 30, height = 5): { app: TestApp; editor: EditorElement } {
    const doc = new TextDocument(text);
    const viewState = new EditorViewState(doc);
    const editor = new EditorElement(viewState);
    const app = TestApp.createWithContent(editor, new Size(width, height));
    editor.focus();
    return { app, editor };
}

function fireMouse(
    editor: EditorElement,
    type: "mousedown" | "mousemove" | "mouseup",
    localX: number,
    localY: number,
    button: "left" | "right" = "left",
): void {
    editor.dispatchEvent(
        new TUIMouseEvent(type, {
            button,
            screenX: localX,
            screenY: localY,
            localX,
            localY,
        }),
    );
}

// ─── Intrinsic size stubs ───────────────────────────────────

describe("EditorElement — intrinsic sizing", () => {
    it("getMinIntrinsicWidth is always 1", () => {
        const { editor } = createEditor("hello world this is a long line");
        expect(editor.getMinIntrinsicWidth(5)).toBe(1);
    });

    it("getMaxIntrinsicWidth equals content width", () => {
        const { editor } = createEditor("abcdef\nab");
        // contentWidth = display width of the widest line ("abcdef" = 6).
        expect(editor.getMaxIntrinsicWidth(5)).toBe(editor.contentWidth);
        expect(editor.getMaxIntrinsicWidth(5)).toBe(6);
    });

    it("getMinIntrinsicHeight is always 1", () => {
        const { editor } = createEditor("a\nb\nc\nd");
        expect(editor.getMinIntrinsicHeight(10)).toBe(1);
    });

    it("getMaxIntrinsicHeight equals content height (view line count)", () => {
        const { editor } = createEditor("a\nb\nc");
        expect(editor.getMaxIntrinsicHeight(10)).toBe(editor.contentHeight);
        expect(editor.getMaxIntrinsicHeight(10)).toBe(3);
    });
});

// ─── scrollLeft / scrollTop getters ─────────────────────────

describe("EditorElement — scroll offset getters", () => {
    it("scrollLeft reflects the view state's horizontal scroll", () => {
        const { editor } = createEditor("abcdefghijklmnop", 8, 3);
        editor.viewState.scrollLeft = 4;
        expect(editor.scrollLeft).toBe(4);
    });

    it("scrollTop reflects the view state's vertical scroll", () => {
        const { editor } = createEditor("a\nb\nc\nd\ne", 8, 2);
        editor.viewState.scrollTop = 2;
        expect(editor.scrollTop).toBe(2);
    });
});

// ─── Enter key inserts a newline ────────────────────────────

describe("EditorElement — Enter key", () => {
    it("inserts a newline at the cursor on keypress Enter", () => {
        const { editor } = createEditor("helloworld");
        editor.viewState.selections = [createCursorSelection(0, 5)];

        editor.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "Enter" }));

        expect(editor.viewState.document.getText()).toBe("hello\nworld");
        expect(editor.viewState.selections[0].active).toEqual({ line: 1, character: 0 });
    });

    it("Enter newline is undoable (an undo element was pushed)", () => {
        const { editor } = createEditor("ab");
        editor.viewState.selections = [createCursorSelection(0, 1)];

        editor.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "Enter" }));
        expect(editor.viewState.document.getText()).toBe("a\nb");

        editor.undoManager.undo();
        expect(editor.viewState.document.getText()).toBe("ab");
    });
});

// ─── Mouse-up resets the drag anchor ────────────────────────

describe("EditorElement — drag anchor reset on mouseup", () => {
    it("a mousemove after mouseup does not extend a selection", () => {
        const { editor } = createEditor("hello\nworld\nfoo", 30, 5);
        const gw = editor.gutterWidth;

        // Begin a drag: mousedown sets the anchor at line 0 char 0.
        fireMouse(editor, "mousedown", gw + 0, 0);
        // Drag to line 1 char 3 — selection extends.
        fireMouse(editor, "mousemove", gw + 3, 1);

        const duringDrag = editor.viewState.selections[0];
        expect(duringDrag.anchor).toEqual({ line: 0, character: 0 });
        expect(duringDrag.active).toEqual({ line: 1, character: 3 });

        // Release the mouse — drag anchor is cleared.
        fireMouse(editor, "mouseup", gw + 3, 1);

        // A further mousemove must be ignored (no anchor) — selection unchanged.
        fireMouse(editor, "mousemove", gw + 1, 2);

        const afterRelease = editor.viewState.selections[0];
        expect(afterRelease.active).toEqual({ line: 1, character: 3 });
    });
});

describe("EditorElement — getCaretScreenCell", () => {
    it("возвращает абсолютную ячейку каретки, когда она видима", () => {
        const { editor } = createEditor("hello\nworld", 30, 5);
        const cell = editor.getCaretScreenCell();
        expect(cell).not.toBeNull();
        // Каретка на строке 0 → y == globalPosition.y; x сдвинут на gutter.
        expect(cell!.y).toBe(editor.globalPosition.y);
        expect(cell!.x).toBe(editor.globalPosition.x + editor.gutterWidth);
    });

    it("следует за строкой курсора", () => {
        const { editor } = createEditor("hello\nworld", 30, 5);
        editor.viewState.selections = [createCursorSelection(1, 3)];
        const cell = editor.getCaretScreenCell();
        expect(cell!.y).toBe(editor.globalPosition.y + 1);
    });

    it("возвращает null, когда каретка проскроллена за пределы вьюпорта", () => {
        const { editor } = createEditor("hello\nworld", 30, 5);
        editor.viewState.scrollTop = 50;
        expect(editor.getCaretScreenCell()).toBeNull();
    });
});
