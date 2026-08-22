import { describe, expect, it } from "vitest";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { createRange } from "../common/core/iRange.ts";
import { isSelectionCollapsed, selectionToRange } from "../common/core/iSelection.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

function createEditor(text: string, width = 30, height = 5): EditorElement {
    const editor = new EditorElement(new EditorViewState(new TextDocument(text)));
    TestApp.createWithContent(editor, new Size(width, height));
    return editor;
}

function fireMouseDown(
    editor: EditorElement,
    localX: number,
    localY: number,
    modifiers: { shiftKey?: boolean; altKey?: boolean } = {},
): void {
    editor.dispatchEvent(
        new TUIMouseEvent("mousedown", {
            button: "left",
            screenX: localX,
            screenY: localY,
            localX,
            localY,
            ...modifiers,
        }),
    );
}

function actives(editor: EditorElement): number[][] {
    return editor.viewState.selections.map((sel) => [sel.active.line, sel.active.character]);
}

describe("EditorElement — Alt+клик ставит и снимает каретку", () => {
    it("добавляет вторую каретку", () => {
        const editor = createEditor("hello\nworld");
        const gw = editor.gutterWidth;

        fireMouseDown(editor, gw + 1, 0);
        fireMouseDown(editor, gw + 3, 1, { altKey: true });

        expect(actives(editor)).toEqual([
            [0, 1],
            [1, 3],
        ]);
    });

    it("повторный Alt+клик по той же точке каретку снимает", () => {
        const editor = createEditor("hello\nworld");
        const gw = editor.gutterWidth;

        fireMouseDown(editor, gw + 1, 0);
        fireMouseDown(editor, gw + 3, 1, { altKey: true });
        fireMouseDown(editor, gw + 3, 1, { altKey: true });

        expect(actives(editor)).toEqual([[0, 1]]);
    });

    it("обычный клик схлопывает мультикурсор в одну каретку", () => {
        const editor = createEditor("hello\nworld");
        const gw = editor.gutterWidth;

        fireMouseDown(editor, gw + 1, 0);
        fireMouseDown(editor, gw + 3, 1, { altKey: true });
        fireMouseDown(editor, gw + 2, 0);

        expect(actives(editor)).toEqual([[0, 2]]);
    });

    it("Alt+drag не тянет выделение", () => {
        const editor = createEditor("hello world");
        const gw = editor.gutterWidth;

        fireMouseDown(editor, gw + 2, 0, { altKey: true });
        editor.dispatchEvent(
            new TUIMouseEvent("mousemove", { button: "left", screenX: gw + 8, screenY: 0, localX: gw + 8, localY: 0 }),
        );

        expect(editor.viewState.selections.every((sel) => isSelectionCollapsed(sel))).toBe(true);
    });

    it("Shift+Alt+клик остаётся расширением выделения, а не мультикурсором", () => {
        const editor = createEditor("hello world");
        const gw = editor.gutterWidth;

        fireMouseDown(editor, gw + 2, 0);
        fireMouseDown(editor, gw + 8, 0, { shiftKey: true, altKey: true });

        expect(editor.viewState.selections).toHaveLength(1);
        expect(selectionToRange(editor.viewState.selections[0])).toEqual(createRange(0, 2, 0, 8));
    });
});
