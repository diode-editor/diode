import { describe, expect, it } from "vitest";

import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { createSelection } from "../common/core/iSelection.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";
import { LONG_LINE_TRUNCATION_BADGE, STOP_RENDERING_LINE_AFTER } from "../common/viewModel/longLineRendering.ts";

import { EditorElement } from "./editorElement.ts";
import { SELECTION_BG } from "./textViewRendering.ts";

const BADGE_LABEL = LONG_LINE_TRUNCATION_BADGE.trim();

function createEditor(
    text: string,
    width = 16,
    height = 4,
): { app: TestApp; editor: EditorElement; vs: EditorViewState } {
    const doc = new TextDocument(text);
    const vs = new EditorViewState(doc);
    vs.wordWrap = "on";
    const editor = new EditorElement(vs);
    const app = TestApp.createWithContent(editor, new Size(width, height));
    return { app, editor, vs };
}

describe("EditorElement word wrap — отрисовка фрагментов", () => {
    it("длинная строка разворачивается в несколько экранных рядов", () => {
        const { app, editor } = createEditor("aaaa bbbb cccc\nshort");
        app.render();
        const gw = editor.gutterWidth; // contentCols = 16 - 6 = 10
        expect(app.backend.getTextAt(new Point(gw, 0), 10)).toBe("aaaa bbbb ");
        expect(app.backend.getTextAt(new Point(gw, 1), 10)).toBe("cccc      ");
        expect(app.backend.getTextAt(new Point(gw, 2), 10)).toBe("short     ");
    });

    it("performLayout прописывает во view-state ширину текстовой области до render", () => {
        const { app, editor, vs } = createEditor("aaaa bbbb cccc");
        app.render();
        expect(vs.viewportWidth).toBe(16 - editor.gutterWidth);
        expect(vs.viewportHeight).toBe(4);
    });

    it("ряд-продолжение не повторяет номер строки, следующая строка нумеруется дальше", () => {
        const { app, editor } = createEditor("aaaa bbbb cccc\nshort");
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(0, 0), gw)).toContain("1");
        expect(app.backend.getTextAt(new Point(0, 1), gw).trim()).toBe("");
        expect(app.backend.getTextAt(new Point(0, 2), gw)).toContain("2");
    });

    it("хвост фрагмента после точки переноса — фон, а не текст следующего фрагмента", () => {
        // Перенос по слову на 8-й колонке: ряд короче contentCols.
        const { app, editor } = createEditor("aaaaaaa bbbbbb");
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gw, 0), 10)).toBe("aaaaaaa   ");
        expect(app.backend.getTextAt(new Point(gw, 1), 10)).toBe("bbbbbb    ");
    });

    it("выделение, пересекающее перенос, подсвечивает оба фрагмента в своих колонках", () => {
        const { app, editor, vs } = createEditor("aaaa bbbb cccc");
        vs.selections = [createSelection(0, 2, 0, 12)];
        app.render();
        const gw = editor.gutterWidth;
        // Ряд 0: offsets 2..9 → колонки 2..9.
        expect(app.backend.getBgAt(new Point(gw + 2, 0))).toBe(SELECTION_BG);
        expect(app.backend.getBgAt(new Point(gw + 9, 0))).toBe(SELECTION_BG);
        expect(app.backend.getBgAt(new Point(gw + 1, 0))).not.toBe(SELECTION_BG);
        // Ряд 1: offsets 10..11 → колонки 0..1 фрагмента.
        expect(app.backend.getBgAt(new Point(gw, 1))).toBe(SELECTION_BG);
        expect(app.backend.getBgAt(new Point(gw + 1, 1))).toBe(SELECTION_BG);
        expect(app.backend.getBgAt(new Point(gw + 2, 1))).not.toBe(SELECTION_BG);
    });

    it("contentWidth при wrap равен ширине вьюпорта — горизонтальному скроллу нечего катать", () => {
        const { app, editor, vs } = createEditor("aaaa bbbb cccc");
        app.render();
        expect(editor.contentWidth).toBe(vs.viewportWidth);
        vs.wordWrap = "off";
        expect(editor.contentWidth).toBe(14);
    });

    it("плашка Long line trimmed прижимается в видимую область последнего фрагмента", () => {
        const { app, editor } = createEditor("x".repeat(STOP_RENDERING_LINE_AFTER + 500), 40, 4);
        const vs = editor.viewState;
        vs.scrollTop = vs.getViewLineCount() - 4;
        app.render();
        const lastRowY = 3;
        const gw = editor.gutterWidth;
        const contentCols = 40 - gw;
        const row = app.backend.getTextAt(new Point(gw, lastRowY), contentCols);
        expect(row).toContain(BADGE_LABEL);
    });

    it("chevron и маркер «⋯» свёрнутого региона живут на первом и последнем фрагментах заголовка", () => {
        const { app, editor, vs } = createEditor("aaaa bbbb cc\nhidden\ntail");
        vs.setFoldingRegions([{ startLine: 0, endLine: 1, isCollapsed: true }]);
        app.render();
        const gw = editor.gutterWidth;
        const foldCol = editor.foldControlColumn;
        // Chevron свёрнутого региона — на первом фрагменте, не на продолжении.
        expect(app.backend.getTextAt(new Point(foldCol, 0), 1)).toBe("");
        expect(app.backend.getTextAt(new Point(foldCol, 1), 1)).toBe(" ");
        // Маркер скрытого тела — после конца текста, на последнем фрагменте.
        expect(app.backend.getTextAt(new Point(gw, 1), 10)).toContain("⋯");
        expect(app.backend.getTextAt(new Point(gw, 0), 10)).not.toContain("⋯");
    });
});
