import { describe, expect, it } from "vitest";

import { Size } from "../../../../tuidom/common/geometryPromitives.ts";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { createCursorSelection } from "../common/core/iSelection.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

// Кадр ввода рендерится только по dirty-флагу (dirty-гейт TuiApplication).
// Редактор помечает себя грязным на любое движение курсора/правку через
// подписку на onDidChangeCursorPosition — раньше перерисовку standalone-
// редактора спасала лишь побочная цепочка «selections → статус-бар».

describe("EditorElement — markDirty на смену курсора", () => {
    it("reassign selections (печать, мышь, undo, команды) помечает layout грязным", () => {
        const viewState = new EditorViewState(new TextDocument("hello\nworld\n"));
        const editor = new EditorElement(viewState);
        TestApp.createWithContent(editor, new Size(30, 5));
        expect(editor.isLayoutDirty).toBe(false);

        viewState.selections = [createCursorSelection(1, 2)];

        expect(editor.isLayoutDirty).toBe(true);
    });

    it("печать символа помечает layout грязным без участия статус-бара", () => {
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
