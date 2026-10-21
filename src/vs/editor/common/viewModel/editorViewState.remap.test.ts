import { describe, expect, it } from "vitest";

import { createRange } from "../core/iRange.ts";
import { createCursorSelection, createSelection } from "../core/iSelection.ts";
import { createTextEdit } from "../core/iTextEdit.ts";
import { TextDocument } from "../model/textDocument.ts";
import { UndoManager } from "../model/undoManager.ts";

import { EditorViewState } from "./editorViewState.ts";

/** The view's own edits aren't remapped — they recompute themselves exactly. */
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

        // Edit straight through the document (the undo/owner path) — view A is not involved.
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

        doc.applyEdits([createTextEdit(createRange(1, 0, 3, 3), "x")]);

        const active = b.selections[0].active;
        expect(active.line).toBe(1);
        expect(active.character).toBeLessThanOrEqual(doc.getLineLength(1));
    });

    it("собственная правка не ремапится вторым проходом", () => {
        const { a } = twoViews("hello");
        a.selections = [createCursorSelection(0, 5)];
        a.type(" world");

        // Exact recomputation by the mutator: cursor at the end of the insertion, no offsets.
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

    /**
     * Batch events are computed bottom-up but fire in document order: without shifting boundaries
     * the lower edit addressed lines past the document, and the cursor stayed past the line end.
     */
    it("батч из двух правок не оставляет каретку чужой вью за концом строки", () => {
        const { doc, b } = twoViews("aaa\nbbbbb");
        b.selections = [createCursorSelection(1, 5)];

        // The upper edit adds a line, the lower one shortens the line under the cursor.
        doc.applyEdits([createTextEdit(createRange(0, 0, 0, 0), "X\n"), createTextEdit(createRange(1, 1, 1, 5), "")]);

        expect(doc.getText()).toBe("X\naaa\nb");
        expect(b.selections[0].active).toEqual({ line: 2, character: 1 });
    });

    it("undo мультикурсорной многострочной вставки не роняет ремап", () => {
        const { doc, a } = twoViews("aaa\nbbb");
        const undoManager = new UndoManager(doc);
        a.selections = [createCursorSelection(0, 3), createCursorSelection(1, 3)];
        const element = a.insertText("X\nY");
        expect(element).toBeDefined();
        if (element) undoManager.pushUndoElement(element);
        expect(doc.getText()).toBe("aaaX\nY\nbbbX\nY");

        expect(undoManager.undo(a)).toBe(true);

        expect(doc.getText()).toBe("aaa\nbbb");
        expect(a.selections.map((sel) => sel.active)).toEqual([
            { line: 0, character: 3 },
            { line: 1, character: 3 },
        ]);
    });

    it("dispose останавливает ремап", () => {
        const { doc, b } = twoViews("one\ntwo\nthree");
        b.selections = [createCursorSelection(2, 1)];

        b.dispose();
        doc.applyEdits([createTextEdit(createRange(0, 0, 0, 0), "x\n")]);

        expect(b.selections[0].active).toEqual({ line: 2, character: 1 });
    });
});
