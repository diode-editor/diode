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
        // Собственный фон, отличный от подложки body: пропуск заливки хвоста
        // был бы неотличим по глифам (подложка и так чистит кадр пробелами).
        const editorBg = packRgb(12, 34, 56);
        editor.style = { bg: editorBg };
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gw, 0), 10)).toBe("aaaaaaa   ");
        expect(app.backend.getTextAt(new Point(gw, 1), 10)).toBe("bbbbbb    ");
        expect(app.backend.getBgAt(new Point(gw + 8, 0))).toBe(editorBg);
        expect(app.backend.getBgAt(new Point(gw + 9, 0))).toBe(editorBg);
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

    it("выделение до конца строки не заливает ни хвост фрагмента, ни виртуальную ячейку перевода", () => {
        const { app, editor, vs } = createEditor("aaaaaaa bbbbbb\nzz"); // фрагменты 8 и 6 колонок
        vs.selections = [createSelection(0, 0, 0, 14)];
        app.render();
        const gw = editor.gutterWidth;
        // Ряд 0: подсветка кончается на границе фрагмента (кол. 7), хвост чист.
        expect(app.backend.getBgAt(new Point(gw + 7, 0))).toBe(SELECTION_BG);
        expect(app.backend.getBgAt(new Point(gw + 8, 0))).not.toBe(SELECTION_BG);
        // Ряд 1: текст залит, виртуальная ячейка перевода строки (кол. 6) — нет:
        // выделение кончается ровно на конце строки, не захватывая перевод.
        expect(app.backend.getBgAt(new Point(gw + 5, 1))).toBe(SELECTION_BG);
        expect(app.backend.getBgAt(new Point(gw + 6, 1))).not.toBe(SELECTION_BG);
    });

    it("межстрочное выделение заливает виртуальную ячейку перевода на ПОСЛЕДНЕМ фрагменте", () => {
        const { app, editor, vs } = createEditor("aaaaaaa bbbbbb\nzz");
        vs.selections = [createSelection(0, 2, 1, 1)];
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getBgAt(new Point(gw + 6, 1))).toBe(SELECTION_BG); // виртуальный перевод
        expect(app.backend.getBgAt(new Point(gw, 2))).toBe(SELECTION_BG); // "z"
    });

    it("contentWidth при wrap равен ширине вьюпорта — горизонтальному скроллу нечего катать", () => {
        const { app, editor, vs } = createEditor("aaaa bbbb cccc");
        app.render();
        expect(editor.contentWidth).toBe(vs.viewportWidth);
        vs.wordWrap = "off";
        expect(editor.contentWidth).toBe(14);
    });

    it("плашка Long line trimmed стоит ровно в точке обрыва короткого последнего фрагмента", () => {
        // contentCols 34: 10000 % 34 = 4 — последний фрагмент из 4 колонок.
        const { app, editor } = createEditor("x".repeat(STOP_RENDERING_LINE_AFTER + 500), 40, 4);
        const vs = editor.viewState;
        vs.scrollTop = vs.getViewLineCount() - 4;
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gw, 3), 4)).toBe("xxxx");
        expect(app.backend.getTextAt(new Point(gw + 4, 3), LONG_LINE_TRUNCATION_BADGE.length)).toBe(
            LONG_LINE_TRUNCATION_BADGE,
        );
    });

    it("плашка на полноширинном последнем фрагменте прижимается в видимую область", () => {
        // contentCols 25: 10000 % 25 = 0 — последний фрагмент занимает всю ширину,
        // без клампа плашка стояла бы ровно за краем.
        const { app, editor } = createEditor("x".repeat(STOP_RENDERING_LINE_AFTER + 500), 31, 4);
        const vs = editor.viewState;
        vs.scrollTop = vs.getViewLineCount() - 4;
        app.render();
        const gw = editor.gutterWidth;
        const contentCols = 31 - gw;
        const badgeCol = contentCols - LONG_LINE_TRUNCATION_BADGE.length;
        expect(app.backend.getTextAt(new Point(gw + badgeCol, 3), LONG_LINE_TRUNCATION_BADGE.length)).toBe(
            LONG_LINE_TRUNCATION_BADGE,
        );
        expect(app.backend.getTextAt(new Point(gw, 3), badgeCol)).toBe("x".repeat(badgeCol));
    });

    it("выключение и включение переноса перерисовывает и хвосты фрагментов, и гуттер продолжений", () => {
        const doc = new TextDocument("aaaaaaa bbbbbb\nsecond");
        const vs = new EditorViewState(doc);
        const editor = new EditorElement(vs);
        const app = TestApp.createWithContent(editor, new Size(16, 4));
        app.render(); // без переноса: row0 = "aaaaaaa bb", гуттер row1 несёт "2"
        const gw = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gw, 0), 10)).toBe("aaaaaaa bb");
        expect(app.backend.getTextAt(new Point(0, 1), gw)).toContain("2");

        vs.wordWrap = "on";
        editor.markDirty();
        app.render();
        // Хвост ряда 0 обязан быть перерисован фоном (не остатками "bb"), гуттер
        // продолжения — пробелами (не остатком "2").
        expect(app.backend.getTextAt(new Point(gw, 0), 10)).toBe("aaaaaaa   ");
        expect(app.backend.getTextAt(new Point(gw, 1), 10)).toBe("bbbbbb    ");
        expect(app.backend.getTextAt(new Point(0, 1), gw)).toBe(" ".repeat(gw));
    });

    it("внешний гуттер-маркер живёт на первом фрагменте и не повторяется на продолжении", () => {
        const { app, editor, vs } = createEditor("aaaa bbbb cccc\nzz");
        editor.decorations = { gutterMarkers: [{ line: 0, char: "+" }] };
        editor.markDirty();
        app.render();
        const markerCol = 3; // GUTTER_LEFT_PADDING + digitCount
        expect(app.backend.getTextAt(new Point(markerCol, 0), 1)).toBe("+");
        expect(app.backend.getTextAt(new Point(markerCol, 1), 1)).toBe(" ");
        expect(vs.getViewLineCount()).toBe(3);
    });

    it("indent guide рисуется на первом фрагменте тела и не наезжает на продолжение", () => {
        const { app, editor, vs } = createEditor("aaaa:\n    aaaa bbbb cc");
        vs.setFoldingRegions([{ startLine: 0, endLine: 1, isCollapsed: false }]);
        app.render();
        const gw = editor.gutterWidth;
        // Ряд 1 — первый фрагмент тела: гайд поверх отступа в колонке заголовка.
        expect(app.backend.getTextAt(new Point(gw, 1), 1)).toBe("│");
        // Ряд 2 — продолжение с колонки 0: текст, никакого гайда поверх.
        expect(app.backend.getTextAt(new Point(gw, 2), 1)).toBe("b");
    });
});

describe("EditorElement word wrap — performLayout и ширина вьюпорта", () => {
    async function flushMicrotasks(): Promise<void> {
        await Promise.resolve();
        await Promise.resolve();
    }

    it("смена ширины дозаказывает кадр: проекция зависит от ширины", async () => {
        const { app, editor, vs } = createEditor("aaaa bbbb cccc");
        app.render();
        await flushMicrotasks();
        app.render();
        await flushMicrotasks();
        expect(editor.isLayoutDirty).toBe(false);

        app.backend.resize(new Size(20, 4));
        app.render();
        expect(vs.viewportWidth).toBe(20 - editor.gutterWidth);
        await flushMicrotasks();
        expect(editor.isLayoutDirty).toBe(true);
    });

    it("смена высоты тоже дозаказывает кадр", async () => {
        const { app, editor } = createEditor("aaaa bbbb cccc");
        app.render();
        await flushMicrotasks();
        app.render();
        await flushMicrotasks();
        expect(editor.isLayoutDirty).toBe(false);

        app.backend.resize(new Size(16, 6));
        app.render();
        expect(editor.viewState.viewportHeight).toBe(6);
        await flushMicrotasks();
        expect(editor.isLayoutDirty).toBe(true);
    });

    it("layout той же геометрии кадр не дозаказывает", async () => {
        const { app, editor } = createEditor("aaaa bbbb cccc");
        app.render();
        await flushMicrotasks();
        app.render(); // возможный дозаказ после первого layout уже съеден
        await flushMicrotasks();
        app.render();
        await flushMicrotasks();
        expect(editor.isLayoutDirty).toBe(false);
    });
});

describe("EditorElement word wrap — фолдинг", () => {
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

    it("клик РОВНО в колонку границы фрагмента остаётся на своём ряду", () => {
        const { editor } = createEditor("aaaaaaa bbbbbb"); // граница фрагмента — offset 8, колонка 8
        const gw = editor.gutterWidth;
        fireMouseDown(editor, gw + 8, 0);
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 7 });
    });

    it("клик по ряду-зоны при wrap маппится в якорную строку по колонке клика", () => {
        const { editor, vs } = createEditor("aaaa bbbb cccc\nzz");
        vs.setViewZones([{ afterLine: 0, size: 1 }]);
        // Ряды: 0-1 — фрагменты строки 0, 2 — зона, 3 — "zz".
        expect(editor.docPositionAt(editor.gutterWidth + 3, 2)).toEqual({ line: 0, character: 3 });
    });

    it("клик по гуттеру продолжения — колонка 0 РЯДА, то есть начало фрагмента", () => {
        const { editor } = createEditor("aaaa bbbb cccc");
        fireMouseDown(editor, 0, 1);
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 10 });
    });

    it("клик далеко за концом ПОСЛЕДНЕГО фрагмента даёт конец строки, без клампа", () => {
        const { editor } = createEditor("aaaaaaa bbbbbb"); // ряд 1 = "bbbbbb", конец строки 14
        const gw = editor.gutterWidth;
        fireMouseDown(editor, gw + 9, 1);
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 14 });
    });

    it("аппаратная каретка при горизонтальном скролле (wrap off) учитывает scrollLeft", () => {
        const { app, editor, vs } = createEditor("aaaa bbbb cccc");
        vs.wordWrap = "off";
        vs.selections = [createCursorSelection(0, 10)];
        vs.scrollLeft = 4;
        editor.focus();
        app.render();
        const gw = editor.gutterWidth;
        expect(editor.getCaretScreenCell()).toEqual(new Point(gw + 10 - 4, 0));
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
