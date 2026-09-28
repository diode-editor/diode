import { describe, expect, it } from "vitest";

import { createFoldingRegion } from "../../contrib/folding/iFoldingRegion.ts";
import { createRange } from "../core/iRange.ts";
import { createCursorSelection } from "../core/iSelection.ts";
import { createTextEdit } from "../core/iTextEdit.ts";
import { TextDocument } from "../model/textDocument.ts";
import { UndoManager } from "../model/undoManager.ts";

import { EditorViewState } from "./editorViewState.ts";

/**
 * Каретки после БАТЧА правок — там, где батч приходит целиком: от расширения
 * (WorkspaceEdit, quick fix), от save-участника, от мультикурсорной команды.
 * Каждая каретка обязана встать в конец своего вставленного текста и остаться
 * ВНУТРИ документа: колонка за концом строки роняла рендер на highlight
 * вхождений (`isWordChar` читал `undefined`), а отрицательная — тем же местом.
 */
describe("EditorViewState: каретки после батча правок", () => {
    function carets(state: EditorViewState): [number, number][] {
        return state.selections.map((sel) => [sel.active.line, sel.active.character]);
    }

    function assertInsideDocument(state: EditorViewState, doc: TextDocument): void {
        for (const sel of state.selections) {
            for (const pos of [sel.anchor, sel.active]) {
                expect(pos.line).toBeGreaterThanOrEqual(0);
                expect(pos.line).toBeLessThan(doc.lineCount);
                expect(pos.character).toBeGreaterThanOrEqual(0);
                expect(pos.character).toBeLessThanOrEqual(doc.getLineLength(pos.line));
            }
        }
    }

    it("многострочная правка и правка правее неё на той же строке: обе каретки точны", () => {
        const doc = new TextDocument("hello\nhello baz\nx");
        const state = new EditorViewState(doc);

        // Батч в исходных координатах: замена «el» многострочным текстом и
        // удаление «o» правее неё. Прежний расчёт по накопленным сдвигам сажал
        // вторую каретку на строку 2 в колонку 4 — за конец строки «zl».
        state.applyEdits(
            [createTextEdit(createRange(0, 1, 0, 3), "x\ny\nz"), createTextEdit(createRange(0, 4, 0, 5), "")],
            "batch",
        );

        expect(doc.getText()).toBe("hx\ny\nzl\nhello baz\nx");
        expect(carets(state)).toEqual([
            [2, 1],
            [2, 2],
        ]);
        assertInsideDocument(state, doc);
    });

    it("правка ниже многострочной: каретка едет вместе со своей строкой", () => {
        const doc = new TextDocument("one\ntwo\nthree");
        const state = new EditorViewState(doc);

        state.applyEdits(
            [createTextEdit(createRange(0, 0, 0, 3), "1\n2"), createTextEdit(createRange(2, 0, 2, 5), "x")],
            "batch",
        );

        expect(doc.getText()).toBe("1\n2\ntwo\nx");
        expect(carets(state)).toEqual([
            [1, 1],
            [3, 1],
        ]);
        assertInsideDocument(state, doc);
    });

    it("undo батча возвращает и текст, и прежние каретки", () => {
        const doc = new TextDocument("hello\nhello baz\nx");
        const state = new EditorViewState(doc);
        const undoManager = new UndoManager(doc);
        state.selections = [createCursorSelection(1, 2)];

        const element = state.applyEdits(
            [createTextEdit(createRange(0, 1, 0, 3), "x\ny\nz"), createTextEdit(createRange(0, 4, 0, 5), "")],
            "batch",
        );
        expect(element).toBeDefined();
        if (element) undoManager.pushUndoElement(element);

        expect(undoManager.undo(state)).toBe(true);
        expect(doc.getText()).toBe("hello\nhello baz\nx");
        expect(carets(state)).toEqual([[1, 2]]);
    });
});

/**
 * Мультикурсорное удаление по границе слова: две каретки внутри одного слова
 * просят удалить до одного и того же его начала, и диапазоны накладываются.
 * Перекрытые правки документ применял снизу вверх по уже съеденному тексту
 * (в «hello world» пропадало «hello wo») и считал по ним обратные правки с
 * отрицательными колонками. Диапазоны объединяются — как в vscode.
 */
describe("EditorViewState: перекрывающиеся удаления мультикурсора", () => {
    it("две каретки внутри слова удаляют его один раз и сливаются в одну", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc);
        state.selections = [createCursorSelection(0, 3), createCursorSelection(0, 5)];

        state.deleteWordLeft();

        expect(doc.getText()).toBe(" world");
        expect(state.selections.map((sel) => sel.active)).toEqual([{ line: 0, character: 0 }]);
    });

    it("undo/redo перекрывшегося удаления ходит по объединённому диапазону", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc);
        const undoManager = new UndoManager(doc);
        state.selections = [createCursorSelection(0, 3), createCursorSelection(0, 5)];

        const element = state.deleteWordLeft();
        expect(element).toBeDefined();
        if (element) undoManager.pushUndoElement(element);

        expect(undoManager.undo(state)).toBe(true);
        expect(doc.getText()).toBe("hello world");

        expect(undoManager.redo(state)).toBe(true);
        expect(doc.getText()).toBe(" world");
    });

    it("каретки в разных словах удаляют каждая своё", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc);
        state.selections = [createCursorSelection(0, 5), createCursorSelection(0, 11)];

        state.deleteWordLeft();

        expect(doc.getText()).toBe(" ");
        expect(state.selections.map((sel) => sel.active)).toEqual([
            { line: 0, character: 0 },
            { line: 0, character: 1 },
        ]);
    });

    it("правка, полностью накрытая предыдущей, выбрасывается", () => {
        // Обе каретки внутри единственного слова: у обеих граница справа —
        // конец строки, поэтому вторая правка целиком лежит в первой.
        const doc = new TextDocument("hello");
        const state = new EditorViewState(doc);
        state.selections = [createCursorSelection(0, 1), createCursorSelection(0, 3)];
        const changes: unknown[] = [];
        doc.onDidChangeContent((change) => changes.push(change));

        state.deleteWordRight();

        expect(doc.getText()).toBe("h");
        expect(state.selections.map((sel) => sel.active)).toEqual([{ line: 0, character: 1 }]);
        // Накрытая правка выброшена, а не превращена в пустышку: в документ
        // уехала ровно одна правка, и подписчики (другая вью, кеш токенов)
        // получили одно событие, а не два, второе из которых ничего не меняет.
        expect(changes).toHaveLength(1);
    });

    it("вправо перекрытие схлопывается так же", () => {
        const doc = new TextDocument("hello world");
        const state = new EditorViewState(doc);
        state.selections = [createCursorSelection(0, 1), createCursorSelection(0, 3)];

        state.deleteWordRight();

        // Каретка на 1 съедает «ello», каретка на 3 — «lo » до начала слова
        // «world»: диапазоны стыкуются в один, каретки — в одну.
        expect(doc.getText()).toBe("hworld");
        expect(state.selections.map((sel) => sel.active)).toEqual([{ line: 0, character: 1 }]);
    });
});

/**
 * Удаление слова умеет склеивать строки (Ctrl+Backspace в колонке 0,
 * Ctrl+Delete в конце строки), а значит меняет нумерацию — границы фолдов ниже
 * обязаны уехать вместе с текстом, иначе свёрнутый регион после правки
 * скрывает чужие строки.
 */
describe("EditorViewState: фолды под удалением слова", () => {
    const sixLines = (): TextDocument => new TextDocument("aa\nbb\ncc\ndd\nee\nff");

    it("deleteWordLeft в колонке 0 склеивает строки и поднимает регион", () => {
        const doc = sixLines();
        const state = new EditorViewState(doc);
        state.setFoldingRegions([createFoldingRegion(3, 5, false)]);
        state.selections = [createCursorSelection(2, 0)];

        state.deleteWordLeft();

        expect(doc.getText()).toBe("aa\nbbcc\ndd\nee\nff");
        expect(state.foldedRegions.map((region) => [region.startLine, region.endLine])).toEqual([[2, 4]]);
    });

    it("deleteWordRight в конце строки склеивает строки и поднимает регион", () => {
        const doc = sixLines();
        const state = new EditorViewState(doc);
        state.setFoldingRegions([createFoldingRegion(3, 5, false)]);
        state.selections = [createCursorSelection(1, 2)];

        state.deleteWordRight();

        expect(doc.getText()).toBe("aa\nbbcc\ndd\nee\nff");
        expect(state.foldedRegions.map((region) => [region.startLine, region.endLine])).toEqual([[2, 4]]);
    });
});
