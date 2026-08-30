import { describe, expect, it } from "vitest";

import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { createCursorSelection, createSelection } from "../common/core/iSelection.ts";
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

function fireMouseDown(editor: EditorElement, localX: number, localY: number): void {
    editor.dispatchEvent(
        new TUIMouseEvent("mousedown", {
            button: "left",
            screenX: localX,
            screenY: localY,
            localX,
            localY,
        }),
    );
}

describe("EditorElement word wrap — мышь и каретки", () => {
    it("клик по ряду-продолжению ставит каретку внутрь фрагмента", () => {
        const { editor } = createEditor("aaaa bbbb cccc");
        const gw = editor.gutterWidth;
        fireMouseDown(editor, gw + 2, 1);
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 12 });
    });

    it("клик правее конца не-последнего фрагмента не утаскивает каретку на следующий ряд", () => {
        const { editor } = createEditor("aaaaaaa bbbbbb"); // фрагмент 1 — 8 колонок
        const gw = editor.gutterWidth;
        fireMouseDown(editor, gw + 9, 0);
        // Последняя графема фрагмента — пробел (offset 7), не offset границы (8).
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 7 });
    });

    it("клик по гуттеру продолжения — колонка 0 РЯДА, то есть начало фрагмента", () => {
        const { editor } = createEditor("aaaa bbbb cccc");
        fireMouseDown(editor, 0, 1);
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 10 });
    });

    it("аппаратная каретка на продолжении встаёт в свой ряд и колонку фрагмента", () => {
        const { app, editor, vs } = createEditor("aaaa bbbb cccc");
        vs.selections = [createCursorSelection(0, 12)];
        editor.focus();
        app.render();
        const gw = editor.gutterWidth;
        const cell = editor.getCaretScreenCell();
        expect(cell).toEqual(new Point(gw + 2, 1));
    });

    it("мультикаретки на фрагментах одной строки рисуются каждая в своём ряду", () => {
        const { app, editor, vs } = createEditor("aaaa bbbb cccc");
        vs.selections = [createCursorSelection(0, 2), createCursorSelection(0, 12)];
        editor.focus();
        app.render();
        const gw = editor.gutterWidth;
        const caretBg = packRgb(0xae, 0xaf, 0xad); // editorCursor.foreground
        expect(app.backend.getBgAt(new Point(gw + 2, 0))).toBe(caretBg);
        expect(app.backend.getBgAt(new Point(gw + 2, 1))).toBe(caretBg);
    });

    it("каретка на строке, скрытой свёрткой, не рисуется", () => {
        const { app, editor, vs } = createEditor("head\nhidden line here\ntail");
        vs.setFoldingRegions([{ startLine: 0, endLine: 1, isCollapsed: true }]);
        // Каретку на скрытую строку кладём в обход reconcileHiddenCursors.
        vs.selections = [createCursorSelection(0, 0), createCursorSelection(1, 2)];
        editor.focus();
        app.render();
        const gw = editor.gutterWidth;
        const caretBg = packRgb(0xae, 0xaf, 0xad); // editorCursor.foreground
        expect(app.backend.getBgAt(new Point(gw, 0))).toBe(caretBg);
        // Ряд 1 — уже "tail", каретки скрытой строки на нём нет.
        expect(app.backend.getBgAt(new Point(gw + 2, 1))).not.toBe(caretBg);
    });

    it("клик по chevron-колонке на продолжении не фолдит регион", () => {
        const { editor, vs } = createEditor("aaaa bbbb cc\nbody\ntail");
        const region = { startLine: 0, endLine: 1, isCollapsed: false };
        vs.setFoldingRegions([region]);
        fireMouseDown(editor, editor.foldControlColumn, 1); // ряд-продолжение заголовка
        expect(region.isCollapsed).toBe(false);
        // Клик упал в гуттер продолжения → каретка в начало фрагмента.
        expect(vs.selections[0].active).toEqual({ line: 0, character: 10 });

        fireMouseDown(editor, editor.foldControlColumn, 0); // первый фрагмент — фолдит
        expect(region.isCollapsed).toBe(true);
    });
});
