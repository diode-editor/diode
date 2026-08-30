import { describe, expect, it } from "vitest";

import { createCursorSelection } from "../core/iSelection.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

function makeState(lines: string, viewportWidth = 10): EditorViewState {
    const state = new EditorViewState(new TextDocument(lines), [createCursorSelection(0, 0)]);
    state.viewportWidth = viewportWidth;
    return state;
}

// ─── Проекция: фрагменты ────────────────────────────────────

describe("EditorViewState word wrap — проекция", () => {
    it("wordWrap=on разворачивает длинную строку в ряд на фрагмент", () => {
        const state = makeState("aaaa bbbb cccc\nshort");
        expect(state.getViewLineCount()).toBe(2);
        state.wordWrap = "on";
        // "aaaa bbbb " + "cccc" = 2 ряда, плюс "short".
        expect(state.getViewLineCount()).toBe(3);
    });

    it("оба фрагмента отдают одну и ту же логическую строку", () => {
        const state = makeState("aaaa bbbb cccc\nshort");
        state.wordWrap = "on";
        expect(state.visualToLogicalLine(0)).toBe(0);
        expect(state.visualToLogicalLine(1)).toBe(0);
        expect(state.visualToLogicalLine(2)).toBe(1);
        // logicalToVisualLine — ПЕРВЫЙ фрагмент строки.
        expect(state.logicalToVisualLine(0)).toBe(0);
        expect(state.logicalToVisualLine(1)).toBe(2);
    });

    it("getViewLine у фрагмента — целая логическая строка (окно режет рендер)", () => {
        const state = makeState("aaaa bbbb cccc");
        state.wordWrap = "on";
        expect(state.getViewLine(0)).toBe("aaaa bbbb cccc");
        expect(state.getViewLine(1)).toBe("aaaa bbbb cccc");
    });

    it("viewLineRange отдаёт offsets фрагмента, у последнего конец — длина строки", () => {
        const state = makeState("aaaa bbbb cccc");
        state.wordWrap = "on";
        expect(state.viewLineRange(0)).toEqual({ start: 0, end: 10 });
        expect(state.viewLineRange(1)).toEqual({ start: 10, end: 14 });
        // За границей вью — пустой диапазон.
        expect(state.viewLineRange(5)).toEqual({ start: 0, end: 0 });
        expect(state.viewLineRange(-1)).toEqual({ start: 0, end: 0 });
    });

    it("viewLineStartColumn — дисплейная колонка начала фрагмента (табы считаются)", () => {
        // Таб (4 колонки) + слова: offset и колонка начала фрагмента расходятся.
        const state = makeState("\taaaa bbb cc");
        state.wordWrap = "on";
        // "\taaaa bbb cc": таб=4 + aaaa=8, ws=9 → "bbb" не влезает → break offset 6.
        expect(state.viewLineRange(0)).toEqual({ start: 0, end: 6 });
        expect(state.viewLineStartColumn(0)).toBe(0);
        expect(state.viewLineStartColumn(1)).toBe(9);
    });

    it("viewLineForPosition сажает позицию на её фрагмент; граница уходит на следующий ряд", () => {
        const state = makeState("aaaa bbbb cccc\nshort");
        state.wordWrap = "on";
        expect(state.viewLineForPosition(0, 0)).toBe(0);
        expect(state.viewLineForPosition(0, 9)).toBe(0);
        // Offset ровно на границе фрагментов — следующий ряд (без affinity).
        expect(state.viewLineForPosition(0, 10)).toBe(1);
        expect(state.viewLineForPosition(0, 14)).toBe(1);
        expect(state.viewLineForPosition(1, 0)).toBe(2);
    });

    it("viewLineForPosition на скрытой свёрткой строке — -1", () => {
        const state = makeState("header\naaaa bbbb cccc");
        state.wordWrap = "on";
        state.setFoldingRegions([{ startLine: 0, endLine: 1, isCollapsed: true }]);
        expect(state.viewLineForPosition(1, 3)).toBe(-1);
    });

    it("wordWrap=off ведёт себя как раньше: один ряд на строку, диапазон — вся строка", () => {
        const state = makeState("aaaa bbbb cccc");
        expect(state.getViewLineCount()).toBe(1);
        expect(state.viewLineRange(0)).toEqual({ start: 0, end: 14 });
        expect(state.viewLineStartColumn(0)).toBe(0);
        expect(state.viewLineForPosition(0, 12)).toBe(0);
    });
});

// ─── Режимы и инвалидация ───────────────────────────────────

describe("EditorViewState word wrap — режимы и инвалидация", () => {
    it("режимы wordWrapColumn/bounded ограничены и колонкой, и вьюпортом (v1)", () => {
        const state = makeState("aaaa bbbb cccc", 40);
        state.wordWrap = "wordWrapColumn";
        state.wordWrapColumn = 10;
        expect(state.getViewLineCount()).toBe(2);

        state.wordWrap = "bounded";
        expect(state.getViewLineCount()).toBe(2);

        // Колонка шире вьюпорта — перенос по вьюпорту (bounded-поведение).
        state.viewportWidth = 10;
        state.wordWrapColumn = 80;
        expect(state.getViewLineCount()).toBe(2);
    });

    it("смена ширины вьюпорта перестраивает проекцию (снапшот-инвалидация)", () => {
        const state = makeState("aaaa bbbb cccc");
        state.wordWrap = "on";
        expect(state.getViewLineCount()).toBe(2);
        state.viewportWidth = 40;
        expect(state.getViewLineCount()).toBe(1);
        state.viewportWidth = 10;
        expect(state.getViewLineCount()).toBe(2);
    });

    it("смена tabSize перестраивает проекцию: точки переноса зависят от табов", () => {
        const state = makeState("\t\taaaa bbbb");
        state.wordWrap = "on";
        // tabSize 4: 2 таба = 8 колонок → aaaa не влезает.
        const before = state.getViewLineCount();
        state.tabSize = 2;
        // tabSize 2: 2 таба = 4 колонки → "\t\taaaa " = 9… bbbb не влезает всё равно,
        // но раскладка иная — сравниваем диапазоны, а не только счётчик.
        const after = state.viewLineRange(0);
        state.tabSize = 4;
        expect(state.getViewLineCount()).toBe(before);
        expect(state.viewLineRange(0)).not.toEqual(after);
    });

    it("правка документа перестраивает фрагменты", () => {
        const state = makeState("aaaa bbbb cccc");
        state.wordWrap = "on";
        expect(state.getViewLineCount()).toBe(2);
        state.selections = [createCursorSelection(0, 14)];
        state.type(" dddd eeee");
        expect(state.getViewLineCount()).toBe(3);
    });
});

// ─── Взаимодействие с фолдингом и зонами ────────────────────

describe("EditorViewState word wrap — фолдинг и зоны", () => {
    it("свёрнутый регион прячет фрагменты скрытых строк целиком", () => {
        const state = makeState("header\naaaa bbbb cccc\ntail");
        state.wordWrap = "on";
        expect(state.getViewLineCount()).toBe(4); // header + 2 фрагмента + tail
        state.setFoldingRegions([{ startLine: 0, endLine: 1, isCollapsed: true }]);
        expect(state.getViewLineCount()).toBe(2); // header + tail
        expect(state.logicalToVisualLine(1)).toBe(-1);
    });

    it("зона встаёт после ПОСЛЕДНЕГО фрагмента своей строки", () => {
        const state = makeState("aaaa bbbb cccc\ntail");
        state.wordWrap = "on";
        state.setViewZones([{ afterLine: 0, size: 1 }]);
        // Ряды: фрагмент 1, фрагмент 2, зона, tail.
        expect(state.getViewLineCount()).toBe(4);
        expect(state.viewLineKind(0)).toBe("doc");
        expect(state.viewLineKind(1)).toBe("doc");
        expect(state.viewLineKind(2)).toBe("zone");
        expect(state.viewLineKind(3)).toBe("doc");
        expect(state.zoneAnchorForViewLine(2)).toBe(0);
        // Диапазон зоны пуст, стартовая колонка — 0.
        expect(state.viewLineRange(2)).toEqual({ start: 0, end: 0 });
        expect(state.viewLineStartColumn(2)).toBe(0);
    });
});

// ─── Инвариант scrollLeft ───────────────────────────────────

describe("EditorViewState word wrap — scrollLeft", () => {
    it("при активном wrap scrollLeft клампится к нулю, при off — снова свободен", () => {
        const state = makeState("aaaa bbbb cccc");
        state.scrollLeft = 5;
        expect(state.scrollLeft).toBe(5);
        state.wordWrap = "on";
        state.scrollLeft = 7;
        expect(state.scrollLeft).toBe(0);
        state.wordWrap = "off";
        state.scrollLeft = 7;
        expect(state.scrollLeft).toBe(7);
    });
});
