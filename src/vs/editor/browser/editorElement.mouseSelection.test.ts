import { describe, expect, it } from "vitest";

import { Size } from "@tuidom/all/common/geometryPromitives";
import { TUIMouseEvent } from "@tuidom/all/dom/events/tuiMouseEvent";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { isSelectionCollapsed } from "../common/core/iSelection.ts";
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

function fireMouseMove(editor: EditorElement, localX: number, localY: number): void {
    editor.dispatchEvent(
        new TUIMouseEvent("mousemove", {
            button: "none",
            screenX: localX,
            screenY: localY,
            localX,
            localY,
        }),
    );
}

function fireMouseUp(editor: EditorElement, localX: number, localY: number): void {
    editor.dispatchEvent(
        new TUIMouseEvent("mouseup", {
            button: "left",
            screenX: localX,
            screenY: localY,
            localX,
            localY,
        }),
    );
}

describe("EditorElement – drag selection", () => {
    it("click without drag produces collapsed cursor", () => {
        const { editor } = createEditor("hello\nworld\nfoo", 30, 5);
        const gw = editor.gutterWidth;

        fireMouseDown(editor, gw + 2, 1);

        const sel = editor.viewState.selections[0];
        expect(isSelectionCollapsed(sel)).toBe(true);
        expect(sel.active.line).toBe(1);
        expect(sel.active.character).toBe(2);
    });

    it("mousedown then mousemove expands selection with fixed anchor", () => {
        const { editor } = createEditor("hello\nworld\nfoo", 30, 5);
        const gw = editor.gutterWidth;

        // Press at line 0, char 1
        fireMouseDown(editor, gw + 1, 0);
        // Drag to line 1, char 3
        fireMouseMove(editor, gw + 3, 1);

        const sel = editor.viewState.selections[0];
        expect(sel.anchor.line).toBe(0);
        expect(sel.anchor.character).toBe(1);
        expect(sel.active.line).toBe(1);
        expect(sel.active.character).toBe(3);
        expect(isSelectionCollapsed(sel)).toBe(false);
    });

    it("multiple mousemoves update active position, anchor stays fixed", () => {
        const { editor } = createEditor("hello\nworld\nfoo", 30, 5);
        const gw = editor.gutterWidth;

        fireMouseDown(editor, gw + 0, 0);
        fireMouseMove(editor, gw + 2, 0);
        fireMouseMove(editor, gw + 4, 1);

        const sel = editor.viewState.selections[0];
        expect(sel.anchor.line).toBe(0);
        expect(sel.anchor.character).toBe(0);
        expect(sel.active.line).toBe(1);
        expect(sel.active.character).toBe(4);
    });

    it("mouseup clears drag anchor — subsequent mousemove does not change selection", () => {
        const { editor } = createEditor("hello\nworld\nfoo", 30, 5);
        const gw = editor.gutterWidth;

        fireMouseDown(editor, gw + 0, 0);
        fireMouseMove(editor, gw + 3, 0);
        fireMouseUp(editor, gw + 3, 0);

        // Selection frozen at this point
        const frozenActive = { ...editor.viewState.selections[0].active };

        // Move mouse without pressing — should NOT change selection
        fireMouseMove(editor, gw + 5, 1);

        const sel = editor.viewState.selections[0];
        expect(sel.active.line).toBe(frozenActive.line);
        expect(sel.active.character).toBe(frozenActive.character);
    });

    it("shift+mousedown sets anchor from existing selection, drag extends from that anchor", () => {
        const { editor } = createEditor("hello\nworld\nfoo", 30, 5);
        const gw = editor.gutterWidth;

        // Place cursor at line 0 char 2
        fireMouseDown(editor, gw + 2, 0);
        // Shift-click at line 1 char 1 — extends from char 2 of line 0
        fireMouseDown(editor, gw + 1, 1, true);

        const selAfterShift = editor.viewState.selections[0];
        expect(selAfterShift.anchor.line).toBe(0);
        expect(selAfterShift.anchor.character).toBe(2);
        expect(selAfterShift.active.line).toBe(1);
        expect(selAfterShift.active.character).toBe(1);

        // Continue dragging — anchor must stay at original position (0, 2)
        fireMouseMove(editor, gw + 4, 2);

        const selAfterDrag = editor.viewState.selections[0];
        expect(selAfterDrag.anchor.line).toBe(0);
        expect(selAfterDrag.anchor.character).toBe(2);
        expect(selAfterDrag.active.line).toBe(2);
        expect(selAfterDrag.active.character).toBe(3); // "foo" has 3 chars — clamp to end
    });

    it("dragging back toward anchor collapses selection", () => {
        const { editor } = createEditor("hello\nworld", 30, 5);
        const gw = editor.gutterWidth;

        fireMouseDown(editor, gw + 2, 0);
        fireMouseMove(editor, gw + 4, 0);

        const selExpanded = editor.viewState.selections[0];
        expect(isSelectionCollapsed(selExpanded)).toBe(false);

        // Move back to anchor
        fireMouseMove(editor, gw + 2, 0);

        const selCollapsed = editor.viewState.selections[0];
        expect(isSelectionCollapsed(selCollapsed)).toBe(true);
    });
});
