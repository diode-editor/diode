import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import { createCursorSelection, createSelection } from "../common/core/iSelection.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";
import { LONG_LINE_TRUNCATION_BADGE, STOP_RENDERING_LINE_AFTER } from "../common/viewModel/longLineRendering.ts";

import { EditorElement } from "./editorElement.ts";

/** Dark+ `editor.selectionBackground`; the TestApp palette puts it into the var scope. */
const SELECTION_BG = packRgb(38, 79, 120);
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
        // Wrap at a word boundary at column 8: the row is shorter than contentCols.
        const { app, editor } = createEditor("aaaaaaa bbbbbb");
        // A background of its own, distinct from the body's base: a skipped tail fill
        // would be indistinguishable by glyphs (the base already clears the frame with spaces).
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
        // Row 0: offsets 2..9 → columns 2..9.
        expect(app.backend.getBgAt(new Point(gw + 2, 0))).toBe(SELECTION_BG);
        expect(app.backend.getBgAt(new Point(gw + 9, 0))).toBe(SELECTION_BG);
        expect(app.backend.getBgAt(new Point(gw + 1, 0))).not.toBe(SELECTION_BG);
        // Row 1: offsets 10..11 → fragment columns 0..1.
        expect(app.backend.getBgAt(new Point(gw, 1))).toBe(SELECTION_BG);
        expect(app.backend.getBgAt(new Point(gw + 1, 1))).toBe(SELECTION_BG);
        expect(app.backend.getBgAt(new Point(gw + 2, 1))).not.toBe(SELECTION_BG);
    });

    it("выделение до конца строки не заливает ни хвост фрагмента, ни виртуальную ячейку перевода", () => {
        const { app, editor, vs } = createEditor("aaaaaaa bbbbbb\nzz"); // fragments of 8 and 6 columns
        vs.selections = [createSelection(0, 0, 0, 14)];
        app.render();
        const gw = editor.gutterWidth;
        // Row 0: the highlight ends at the fragment boundary (col. 7), the tail is clean.
        expect(app.backend.getBgAt(new Point(gw + 7, 0))).toBe(SELECTION_BG);
        expect(app.backend.getBgAt(new Point(gw + 8, 0))).not.toBe(SELECTION_BG);
        // Row 1: text is filled, the virtual line-break cell (col. 6) is not:
        // the selection ends exactly at end of line without covering the line break.
        expect(app.backend.getBgAt(new Point(gw + 5, 1))).toBe(SELECTION_BG);
        expect(app.backend.getBgAt(new Point(gw + 6, 1))).not.toBe(SELECTION_BG);
    });

    it("межстрочное выделение заливает виртуальную ячейку перевода на ПОСЛЕДНЕМ фрагменте", () => {
        const { app, editor, vs } = createEditor("aaaaaaa bbbbbb\nzz");
        vs.selections = [createSelection(0, 2, 1, 1)];
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getBgAt(new Point(gw + 6, 1))).toBe(SELECTION_BG); // virtual line break
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
        // contentCols 34: 10000 % 34 = 4, so the last fragment is 4 columns.
        const { app, editor } = createEditor("x".repeat(STOP_RENDERING_LINE_AFTER + 500), 40, 4);
        const vs = editor.viewState;
        vs.scrollTop = vs.getViewLineCount() - 4;
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gw, 3), 4)).toBe("xxxx");
        expect(app.backend.getTextAt(new Point(gw + 4, 3), LONG_LINE_TRUNCATION_BADGE.length)).toBe(
            LONG_LINE_TRUNCATION_BADGE,
        );
        expect(app.backend.getTextAt(new Point(gw, 0), 34)).not.toContain(BADGE_LABEL);
        expect(app.backend.getTextAt(new Point(gw, 2), 34)).not.toContain(BADGE_LABEL);
    });

    it("плашка на полноширинном последнем фрагменте прижимается в видимую область", () => {
        // contentCols 25: 10000 % 25 = 0, so the last fragment takes the full width;
        // without the clamp the badge would sit just past the edge.
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
        app.render(); // no wrap: row0 = "aaaaaaa bb", gutter row1 carries "2"
        const gw = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gw, 0), 10)).toBe("aaaaaaa bb");
        expect(app.backend.getTextAt(new Point(0, 1), gw)).toContain("2");

        vs.wordWrap = "on";
        editor.markDirty();
        app.render();
        // The row 0 tail must be repainted with background (not leftover "bb"), and the
        // continuation gutter with spaces (not leftover "2").
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
        // Row 1 is the first fragment of the body: the guide is over the indent at the header column.
        expect(app.backend.getTextAt(new Point(gw, 1), 1)).toBe("│");
        // Row 2 is a continuation from column 0: text, no guide over it.
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
        app.render(); // any follow-up frame request after the first layout is consumed
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
        expect(app.backend.getTextAt(new Point(foldCol, 0), 1)).toBe("");
        expect(app.backend.getTextAt(new Point(foldCol, 1), 1)).toBe(" ");
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
        const { editor } = createEditor("aaaaaaa bbbbbb"); // fragment 1 is 8 columns
        const gw = editor.gutterWidth;
        fireMouseDown(editor, gw + 9, 0);
        // The fragment's last grapheme is the space (offset 7), not the boundary offset (8).
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 7 });
    });

    it("клик ВНУТРИ не-последнего фрагмента ставит каретку в кликнутую колонку, без клампа", () => {
        const { editor } = createEditor("aaaaaaa bbbbbb");
        const gw = editor.gutterWidth;
        fireMouseDown(editor, gw + 2, 0);
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 2 });
    });

    it("клик РОВНО в колонку границы фрагмента остаётся на своём ряду", () => {
        const { editor } = createEditor("aaaaaaa bbbbbb"); // fragment boundary is offset 8, column 8
        const gw = editor.gutterWidth;
        fireMouseDown(editor, gw + 8, 0);
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 7 });
    });

    it("клик по ряду-зоны при wrap маппится в якорную строку по колонке клика", () => {
        const { editor, vs } = createEditor("aaaa bbbb cccc\nzz");
        vs.setViewZones([{ afterLine: 0, size: 1 }]);
        // Rows: 0-1 are line 0 fragments, 2 is the view zone, 3 is "zz".
        expect(editor.docPositionAt(editor.gutterWidth + 3, 2)).toEqual({ line: 0, character: 3 });
    });

    it("клик по гуттеру продолжения — колонка 0 РЯДА, то есть начало фрагмента", () => {
        const { editor } = createEditor("aaaa bbbb cccc");
        fireMouseDown(editor, 0, 1);
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 10 });
    });

    it("клик далеко за концом ПОСЛЕДНЕГО фрагмента даёт конец строки, без клампа", () => {
        const { editor } = createEditor("aaaaaaa bbbbbb"); // row 1 = "bbbbbb", end of line 14
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
        // Put a cursor on the hidden line, bypassing reconcileHiddenCursors.
        vs.selections = [createCursorSelection(0, 0), createCursorSelection(1, 2)];
        editor.focus();
        app.render();
        const gw = editor.gutterWidth;
        const caretBg = packRgb(0xae, 0xaf, 0xad); // editorCursor.foreground
        expect(app.backend.getBgAt(new Point(gw, 0))).toBe(caretBg);
        // Row 1 is already "tail"; the hidden line's cursor is not on it.
        expect(app.backend.getBgAt(new Point(gw + 2, 1))).not.toBe(caretBg);
    });

    it("клик по chevron-колонке на продолжении не фолдит регион", () => {
        const { editor, vs } = createEditor("aaaa bbbb cc\nbody\ntail");
        const region = { startLine: 0, endLine: 1, isCollapsed: false };
        vs.setFoldingRegions([region]);
        fireMouseDown(editor, editor.foldControlColumn, 1); // header continuation row
        expect(region.isCollapsed).toBe(false);
        // The click hit the continuation gutter → cursor to the fragment start.
        expect(vs.selections[0].active).toEqual({ line: 0, character: 10 });

        fireMouseDown(editor, editor.foldControlColumn, 0); // first fragment: folds
        expect(region.isCollapsed).toBe(true);
    });
});
