import { describe, expect, it } from "vitest";

import { createCursorSelection, createSelection } from "../core/iSelection.ts";
import { createRange } from "../core/iRange.ts";
import { createTextEdit } from "../core/iTextEdit.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

/**
 * Ремап «чужих» правок: несколько EditorViewState на один TextDocument
 * (сплит-вью). Правка через вью A (или напрямую через документ — undo, владелец
 * буфера) обязана строчно сдвинуть выделения/фолды/скролл остальных вью, а
 * собственные правки вью ремапиться не должны — они пересчитывают себя точно.
 */
describe("EditorViewState: ремап чужих правок", () => {
    function twoViews(text: string): { doc: TextDocument; a: EditorViewState; b: EditorViewState } {
        const doc = new TextDocument(text);
        return { doc, a: new EditorViewState(doc), b: new EditorViewState(doc) };
    }

    it("вставка строк выше сдвигает выделение вниз", () => {
        const { a, b } = twoViews("one\ntwo\nthree");
        b.selections = [createSelection(1, 1, 2, 2)];

        a.selections = [createCursorSelection(0, 3)];
        a.type("\nx\ny");

        expect(b.selections[0].anchor).toEqual({ line: 3, character: 1 });
        expect(b.selections[0].active).toEqual({ line: 4, character: 2 });
    });

    it("удаление строк выше сдвигает выделение вверх", () => {
        const { doc, b } = twoViews("one\ntwo\nthree\nfour");
        b.selections = [createCursorSelection(3, 2)];

        // Правка напрямую через документ (путь undo/владельца) — вью A не участвует.
        doc.applyEdits([createTextEdit(createRange(0, 0, 2, 0), "")]);

        expect(b.selections[0].active).toEqual({ line: 1, character: 2 });
    });

    it("правка ниже выделения ничего не сдвигает (и не файрит cursor-change)", () => {
        const { a, b } = twoViews("one\ntwo\nthree");
        b.selections = [createCursorSelection(0, 2)];
        let fired = 0;
        b.onDidChangeCursorPosition(() => {
            fired++;
        });

        a.selections = [createCursorSelection(2, 5)];
        a.type("\ntail");

        expect(b.selections[0].active).toEqual({ line: 0, character: 2 });
        expect(fired).toBe(0);
    });

    it("позиция внутри заменённого диапазона клампится к его концу", () => {
        const { doc, b } = twoViews("aaa\nbbb\nccc\nddd");
        b.selections = [createCursorSelection(2, 3)];

        // Замена строк 1..3 одной строкой.
        doc.applyEdits([createTextEdit(createRange(1, 0, 3, 3), "x")]);

        const active = b.selections[0].active;
        expect(active.line).toBe(1);
        expect(active.character).toBeLessThanOrEqual(doc.getLineLength(1));
    });

    it("собственная правка не ремапится вторым проходом", () => {
        const { a } = twoViews("hello");
        a.selections = [createCursorSelection(0, 5)];
        a.type(" world");

        // Точный пересчёт мутатора: каретка в конце вставки, без смещений.
        expect(a.selections[0].active).toEqual({ line: 0, character: 11 });
    });

    it("фолды чужой вью сдвигаются, свои пересчитаны мутатором", () => {
        const { a, b } = twoViews("h\nif {\n  x\n}\ntail");
        a.setFoldingRegions([{ startLine: 1, endLine: 3, isCollapsed: false }]);
        b.setFoldingRegions([{ startLine: 1, endLine: 3, isCollapsed: true }]);

        a.selections = [createCursorSelection(0, 1)];
        a.type("\nnew");

        expect(a.foldedRegions[0]).toMatchObject({ startLine: 2, endLine: 4 });
        expect(b.foldedRegions[0]).toMatchObject({ startLine: 2, endLine: 4, isCollapsed: true });
    });

    it("скролл чужой вью следует за правкой выше вьюпорта", () => {
        const lines = Array.from({ length: 100 }, (_, i) => `l${i}`).join("\n");
        const { a, b } = twoViews(lines);
        b.scrollTop = 50;

        a.selections = [createCursorSelection(0, 2)];
        a.type("\nq\nw\ne");

        expect(b.scrollTop).toBe(53);
    });

    it("скролл не трогается при свёрнутых регионах (логический сдвиг ≠ визуальному)", () => {
        const lines = Array.from({ length: 100 }, (_, i) => `l${i}`).join("\n");
        const { a, b } = twoViews(lines);
        b.setFoldingRegions([{ startLine: 10, endLine: 20, isCollapsed: true }]);
        b.scrollTop = 50;

        a.selections = [createCursorSelection(0, 2)];
        a.type("\nq");

        expect(b.scrollTop).toBe(50);
    });

    it("dispose останавливает ремап", () => {
        const { doc, b } = twoViews("one\ntwo\nthree");
        b.selections = [createCursorSelection(2, 1)];

        b.dispose();
        doc.applyEdits([createTextEdit(createRange(0, 0, 0, 0), "x\n")]);

        expect(b.selections[0].active).toEqual({ line: 2, character: 1 });
    });
});
