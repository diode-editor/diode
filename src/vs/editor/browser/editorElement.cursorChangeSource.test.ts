import { Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { TUIPasteEvent } from "@tuidom/core/dom/events/tuiPasteEvent";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import { currentCursorChangeSource, type CursorChangeSource } from "../common/core/cursorChangeSource.ts";
import { createSelection } from "../common/core/iSelection.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

// Продюсер источника жеста: обработчики ввода редактора обязаны объявить его на
// время своей работы — мост расширений снимает источник СИНХРОННО из слушателя
// смены каретки и отдаёт расширению как `TextEditorSelectionChangeKind`.
// Без разметки любое движение каретки приезжало бы с `kind === undefined`.

/** Редактор + журнал источников, снятых в момент каждой смены каретки. */
function createEditor(text = "hello world\nsecond line\nthird") {
    const viewState = new EditorViewState(new TextDocument(text));
    const editor = new EditorElement(viewState);
    const app = TestApp.createWithContent(editor, new Size(40, 6));
    const sources: (CursorChangeSource | undefined)[] = [];
    viewState.onDidChangeCursorPosition(() => sources.push(currentCursorChangeSource()));
    return { app, editor, viewState, sources };
}

function fireMouse(editor: EditorElement, type: "mousedown" | "dblclick" | "mousemove", localX: number): void {
    editor.dispatchEvent(
        new TUIMouseEvent(type, {
            button: "left",
            screenX: localX,
            screenY: 0,
            localX,
            localY: 0,
        }),
    );
}

describe("EditorElement — источник смены каретки", () => {
    it("набор символа объявляет источник keyboard", () => {
        const { editor, sources } = createEditor();
        editor.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "x" }));
        expect(sources.length).toBeGreaterThan(0);
        expect(new Set(sources)).toEqual(new Set(["keyboard"]));
    });

    it("Enter объявляет источник keyboard", () => {
        const { editor, sources } = createEditor();
        editor.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "Enter" }));
        expect(new Set(sources)).toEqual(new Set(["keyboard"]));
    });

    it("вставка объявляет источник keyboard", () => {
        const { editor, sources } = createEditor();
        editor.dispatchEvent(new TUIPasteEvent("pasted text"));
        expect(new Set(sources)).toEqual(new Set(["keyboard"]));
    });

    it("клик мышью объявляет источник mouse", () => {
        const { editor, sources } = createEditor();
        fireMouse(editor, "mousedown", editor.gutterWidth + 3);
        expect(sources.length).toBeGreaterThan(0);
        expect(new Set(sources)).toEqual(new Set(["mouse"]));
    });

    it("двойной клик (выделение слова) объявляет источник mouse", () => {
        const { editor, sources } = createEditor();
        fireMouse(editor, "dblclick", editor.gutterWidth + 2);
        expect(new Set(sources)).toEqual(new Set(["mouse"]));
    });

    it("протяжка мышью объявляет источник mouse", () => {
        const { editor, sources } = createEditor();
        fireMouse(editor, "mousedown", editor.gutterWidth + 1);
        sources.length = 0;
        fireMouse(editor, "mousemove", editor.gutterWidth + 6);
        expect(sources.length).toBeGreaterThan(0);
        expect(new Set(sources)).toEqual(new Set(["mouse"]));
    });

    it("после обработчика источник не остаётся взведённым", () => {
        const { editor } = createEditor();
        fireMouse(editor, "mousedown", editor.gutterWidth + 1);
        expect(currentCursorChangeSource()).toBeUndefined();
    });

    it("программная правка выделения мимо жестов источника не объявляет", () => {
        const { viewState, sources } = createEditor();
        viewState.selections = [createSelection(1, 0, 1, 4)];
        expect(sources).toEqual([undefined]);
    });
});
