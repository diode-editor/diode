import { describe, expect, it } from "vitest";

import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

// Лампочка code actions в гуттере (#196, lightbulb): codicon в change-bar-
// колонке слева от fold-шеврона — ширина гуттера от неё не меняется.

const LIGHTBULB = ""; //  nf-cod-lightbulb
const BULB_FG = packRgb(0xff, 0xcc, 0x00);
const CHANGE_FG = packRgb(0x2e, 0xa0, 0x43);

const STYLE_VARS = {
    "editor.background": packRgb(0x1e, 0x1e, 0x1e),
    "editorLightBulb.foreground": BULB_FG,
};

function createEditor(text: string, wrap = false): { app: TestApp; editor: EditorElement } {
    const viewState = new EditorViewState(new TextDocument(text));
    if (wrap) viewState.wordWrap = "on";
    const editor = new EditorElement(viewState);
    editor.setStyleVars(STYLE_VARS);
    const app = TestApp.createWithContent(editor, new Size(24, 6));
    app.render();
    return { app, editor };
}

/** Колонка лампочки: change-bar-слот слева от fold-шеврона. */
function bulbColumn(editor: EditorElement): number {
    return editor.foldControlColumn - 1;
}

describe("EditorElement — лампочка code actions", () => {
    it("рисуется на своей строке цветом токена; ширина гуттера не меняется", () => {
        const { app, editor } = createEditor("alpha\nbravo\ncharlie");
        const widthBefore = editor.gutterWidth;

        editor.lightbulbLine = 1;
        editor.markDirty();
        app.render();

        expect(editor.gutterWidth).toBe(widthBefore);
        const col = bulbColumn(editor);
        expect(app.backend.getTextAt(new Point(col, 1), 1)).toBe(LIGHTBULB);
        expect(app.backend.getFgAt(new Point(col, 1))).toBe(BULB_FG);
        // Чужие строки чисты.
        expect(app.backend.getTextAt(new Point(col, 0), 1)).toBe(" ");
        expect(app.backend.getTextAt(new Point(col, 2), 1)).toBe(" ");

        editor.lightbulbLine = null;
        editor.markDirty();
        app.render();
        expect(app.backend.getTextAt(new Point(col, 1), 1)).toBe(" ");
    });

    it("на строке каретки перекрывает git change-bar (glyph margin важнее полоски)", () => {
        const { app, editor } = createEditor("alpha\nbravo\ncharlie");
        editor.gutterChangeDecorations = [
            { range: { start: { line: 1, character: 0 }, end: { line: 2, character: 0 } }, color: CHANGE_FG },
        ];
        editor.lightbulbLine = 1;
        editor.markDirty();
        app.render();

        const col = bulbColumn(editor);
        expect(app.backend.getTextAt(new Point(col, 1), 1)).toBe(LIGHTBULB);
        expect(app.backend.getFgAt(new Point(col, 1))).toBe(BULB_FG);
        // Строкой ниже change-bar остаётся как есть.
        expect(app.backend.getTextAt(new Point(col, 2), 1)).toBe("┃");
        expect(app.backend.getFgAt(new Point(col, 2))).toBe(CHANGE_FG);
    });

    it("на wrap-продолжениях строки не повторяется", () => {
        const { app, editor } = createEditor("first\na very long wrapped line body\nlast", true);
        editor.lightbulbLine = 1;
        editor.markDirty();
        app.render();

        const col = bulbColumn(editor);
        expect(app.backend.getTextAt(new Point(col, 1), 1)).toBe(LIGHTBULB);
        // Ряд-продолжение той же логической строки — без лампочки.
        expect(app.backend.getTextAt(new Point(col, 2), 1)).toBe(" ");
    });
});
