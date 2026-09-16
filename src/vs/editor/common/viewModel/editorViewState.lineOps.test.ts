import { describe, expect, it } from "vitest";

import { createFoldingRegion } from "../../contrib/folding/iFoldingRegion.ts";
import { createRange } from "../core/iRange.ts";
import { createCursorSelection, createSelection } from "../core/iSelection.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

function state(text: string, selections: ReturnType<typeof createCursorSelection>[]): EditorViewState {
    return new EditorViewState(new TextDocument(text), selections);
}

describe("EditorViewState.copyLinesDown", () => {
    it("дублирует строку каретки, каретка уезжает на нижнюю копию", () => {
        const s = state("alpha\nbeta\ngamma", [createCursorSelection(0, 3)]);
        const undo = s.copyLinesDown();
        expect(s.document.getText()).toBe("alpha\nalpha\nbeta\ngamma");
        expect(s.selections).toEqual([expect.objectContaining({ active: { line: 1, character: 3 } })]);
        expect(undo?.label).toBe("copyLinesDown");
    });

    it("дублирует все строки выделения и сохраняет выделение на нижней копии", () => {
        const s = state("a\nb\nc\nd", [createSelection(0, 1, 1, 1)]);
        s.copyLinesDown();
        expect(s.document.getText()).toBe("a\nb\na\nb\nc\nd");
        expect(s.selections[0].anchor).toEqual({ line: 2, character: 1 });
        expect(s.selections[0].active).toEqual({ line: 3, character: 1 });
    });

    it("выделение до колонки 0 следующей строки её не дублирует", () => {
        const s = state("a\nb\nc", [createSelection(0, 0, 1, 0)]);
        s.copyLinesDown();
        expect(s.document.getText()).toBe("a\na\nb\nc");
    });

    it("мультикурсор: каждая каретка дублирует свою строку", () => {
        const s = state("a\nb\nc", [createCursorSelection(0, 0), createCursorSelection(2, 0)]);
        s.copyLinesDown();
        expect(s.document.getText()).toBe("a\na\nb\nc\nc");
        expect(s.selections.map((sel) => sel.active.line)).toEqual([1, 4]);
    });

    it("две каретки на одной строке дублируют её один раз", () => {
        const s = state("alpha\nbeta", [createCursorSelection(0, 1), createCursorSelection(0, 3)]);
        s.copyLinesDown();
        expect(s.document.getText()).toBe("alpha\nalpha\nbeta");
        expect(s.selections.map((sel) => sel.active)).toEqual([
            { line: 1, character: 1 },
            { line: 1, character: 3 },
        ]);
    });

    it("на последней строке дубль тоже работает", () => {
        const s = state("a\nb", [createCursorSelection(1, 0)]);
        s.copyLinesDown();
        expect(s.document.getText()).toBe("a\nb\nb");
        expect(s.selections[0].active.line).toBe(2);
    });

    it("read-only: no-op без undo", () => {
        const s = state("a\nb", [createCursorSelection(0, 0)]);
        s.readOnly = true;
        expect(s.copyLinesDown()).toBeUndefined();
        expect(s.document.getText()).toBe("a\nb");
    });

    it("три каретки — две на одной строке и одна ниже — дублируют каждую строку по разу", () => {
        const s = state("alpha\nbeta\ngamma", [
            createCursorSelection(0, 1),
            createCursorSelection(0, 3),
            createCursorSelection(2, 0),
        ]);
        s.copyLinesDown();
        expect(s.document.getText()).toBe("alpha\nalpha\nbeta\ngamma\ngamma");
        expect(s.selections.map((sel) => sel.active)).toEqual([
            { line: 1, character: 1 },
            { line: 1, character: 3 },
            { line: 4, character: 0 },
        ]);
    });

    it("многострочный блок не на нулевой строке сдвигает выделение ровно на свой размер", () => {
        const s = state("a\nb\nc\nd\ne\nf", [createSelection(1, 0, 2, 1)]);
        s.copyLinesDown();
        expect(s.document.getText()).toBe("a\nb\nc\nb\nc\nd\ne\nf");
        expect(s.selections[0].anchor).toEqual({ line: 3, character: 0 });
        expect(s.selections[0].active).toEqual({ line: 4, character: 1 });
    });

    it("фолд-регионы съезжают под вставленным дублем", () => {
        const s = state("a\nb\nc\nd", [createCursorSelection(0, 0)]);
        s.setFoldingRegions([createFoldingRegion(2, 3)]);
        s.copyLinesDown();
        expect(s.foldedRegions).toEqual([createFoldingRegion(3, 4)]);
    });

    it("дубль в конце файла прокручивает вьюпорт за уехавшей кареткой", () => {
        const doc = Array.from({ length: 30 }, (_, i) => `line${String(i)}`).join("\n");
        const s = state(doc, [createCursorSelection(29, 0)]);
        s.scrollTop = 6; // каретка у нижнего края вьюпорта 80x24
        s.copyLinesDown();
        expect(s.scrollTop).toBe(7);
    });

    it("форма правки: дубль вниз вставляется НАД блоком, дубль вверх — ПОД ним", () => {
        // Форма — контракт undo/redo и сдвига фолдов (forwardEdits переигрывает
        // redo): текст совпадает у обеих форм, а side-эффекты — нет.
        const down = state("alpha\nbeta", [createCursorSelection(0, 2)]);
        expect(down.copyLinesDown()?.forwardEdits).toEqual([{ range: createRange(0, 0, 0, 0), text: "alpha\n" }]);

        const up = state("alpha\nbeta", [createCursorSelection(0, 2)]);
        expect(up.copyLinesUp()?.forwardEdits).toEqual([{ range: createRange(0, 5, 0, 5), text: "\nalpha" }]);
    });
});

describe("EditorViewState.copyLinesUp", () => {
    it("дублирует строку, каретка остаётся на верхней копии", () => {
        const s = state("alpha\nbeta", [createCursorSelection(0, 2)]);
        const undo = s.copyLinesUp();
        expect(s.document.getText()).toBe("alpha\nalpha\nbeta");
        expect(s.selections[0].active).toEqual({ line: 0, character: 2 });
        expect(undo?.label).toBe("copyLinesUp");
    });

    it("выделение остаётся на верхнем оригинале", () => {
        const s = state("a\nb\nc", [createSelection(1, 0, 2, 1)]);
        s.copyLinesUp();
        expect(s.document.getText()).toBe("a\nb\nc\nb\nc");
        expect(s.selections[0].anchor).toEqual({ line: 1, character: 0 });
        expect(s.selections[0].active).toEqual({ line: 2, character: 1 });
    });

    it("две каретки на одной строке дублируют её один раз и остаются на месте", () => {
        const s = state("alpha\nbeta", [createCursorSelection(0, 1), createCursorSelection(0, 3)]);
        s.copyLinesUp();
        expect(s.document.getText()).toBe("alpha\nalpha\nbeta");
        expect(s.selections.map((sel) => sel.active)).toEqual([
            { line: 0, character: 1 },
            { line: 0, character: 3 },
        ]);
    });

    it("каретка ниже дублируемого блока съезжает на его размер", () => {
        const s = state("a\nb\nc", [createCursorSelection(0, 0), createCursorSelection(2, 0)]);
        s.copyLinesUp();
        expect(s.document.getText()).toBe("a\na\nb\nc\nc");
        expect(s.selections.map((sel) => sel.active.line)).toEqual([0, 3]);
    });

    it("undo-элемент возвращает документ и выделения назад", () => {
        const s = state("a\nb", [createCursorSelection(0, 0)]);
        const undo = s.copyLinesUp();
        expect(undo).toBeDefined();
        expect(undo?.beforeSelections[0].active).toEqual({ line: 0, character: 0 });
        s.document.applyEdits(undo?.backwardEdits ?? []);
        expect(s.document.getText()).toBe("a\nb");
    });
});

describe("EditorViewState.duplicateSelection", () => {
    it("схлопнутая каретка дублирует строку вниз", () => {
        const s = state("alpha\nbeta", [createCursorSelection(0, 2)]);
        const undo = s.duplicateSelection();
        expect(s.document.getText()).toBe("alpha\nalpha\nbeta");
        expect(s.selections[0].active).toEqual({ line: 1, character: 2 });
        expect(undo?.label).toBe("duplicateSelection");
    });

    it("схлопнутая каретка над выделением: строки ниже съезжают на строку дубля", () => {
        const s = state("ab\ncd\nef", [createCursorSelection(0, 1), createSelection(2, 0, 2, 2)]);
        s.duplicateSelection();
        expect(s.document.getText()).toBe("ab\nab\ncd\nefef");
        expect(s.selections[0].active).toEqual({ line: 1, character: 1 });
        expect(s.selections[1].anchor).toEqual({ line: 3, character: 2 });
        expect(s.selections[1].active).toEqual({ line: 3, character: 4 });
    });

    it("выделения на разных строках не наследуют колоночный сдвиг друг друга", () => {
        const s = state("ab\ncd", [createSelection(0, 0, 0, 2), createSelection(1, 0, 1, 2)]);
        s.duplicateSelection();
        expect(s.document.getText()).toBe("abab\ncdcd");
        expect(s.selections[1].anchor).toEqual({ line: 1, character: 2 });
        expect(s.selections[1].active).toEqual({ line: 1, character: 4 });
    });

    it("дубль строки кареткой не сдвигает колоночный счёт выделения той же строки", () => {
        const s = state("abcdef", [createCursorSelection(0, 0), createSelection(0, 2, 0, 4)]);
        s.duplicateSelection();
        expect(s.document.getText()).toBe("abcdef\nabcdcdef");
        expect(s.selections[0].active).toEqual({ line: 1, character: 0 });
        expect(s.selections[1].anchor).toEqual({ line: 1, character: 4 });
        expect(s.selections[1].active).toEqual({ line: 1, character: 6 });
    });

    it("три выделения на одной строке: колоночный сдвиг копится по всем", () => {
        const s = state("ab cd ef", [
            createSelection(0, 0, 0, 2),
            createSelection(0, 3, 0, 5),
            createSelection(0, 6, 0, 8),
        ]);
        s.duplicateSelection();
        expect(s.document.getText()).toBe("abab cdcd efef");
        expect(s.selections[2].anchor).toEqual({ line: 0, character: 12 });
        expect(s.selections[2].active).toEqual({ line: 0, character: 14 });
    });

    it("колоночный сдвиг не переносится через границу строки", () => {
        const s = state("ab\ncd ef", [
            createSelection(0, 0, 0, 2),
            createSelection(1, 0, 1, 2),
            createSelection(1, 3, 1, 5),
        ]);
        s.duplicateSelection();
        expect(s.document.getText()).toBe("abab\ncdcd efef");
        expect(s.selections[2].anchor).toEqual({ line: 1, character: 7 });
        expect(s.selections[2].active).toEqual({ line: 1, character: 9 });
    });

    it("непустое выделение дублируется вплотную и выделяет копию", () => {
        const s = state("hello world", [createSelection(0, 0, 0, 5)]);
        s.duplicateSelection();
        expect(s.document.getText()).toBe("hellohello world");
        expect(s.selections[0].anchor).toEqual({ line: 0, character: 5 });
        expect(s.selections[0].active).toEqual({ line: 0, character: 10 });
    });

    it("многострочное выделение дублируется с сохранением структуры строк", () => {
        const s = state("ab\ncd\nef", [createSelection(0, 1, 1, 1)]);
        s.duplicateSelection();
        expect(s.document.getText()).toBe("ab\ncb\ncd\nef");
        expect(s.selections[0].anchor).toEqual({ line: 1, character: 1 });
        expect(s.selections[0].active).toEqual({ line: 2, character: 1 });
    });

    it("мультикурсор: два выделения на одной строке дублируются каждое", () => {
        const s = state("ab cd", [createSelection(0, 0, 0, 2), createSelection(0, 3, 0, 5)]);
        s.duplicateSelection();
        expect(s.document.getText()).toBe("abab cdcd");
        expect(s.selections[0].anchor).toEqual({ line: 0, character: 2 });
        expect(s.selections[0].active).toEqual({ line: 0, character: 4 });
        expect(s.selections[1].anchor).toEqual({ line: 0, character: 7 });
        expect(s.selections[1].active).toEqual({ line: 0, character: 9 });
    });
});

describe("EditorViewState.moveLinesDown", () => {
    it("меняет строку каретки местами со строкой ниже", () => {
        const s = state("a\nb\nc", [createCursorSelection(0, 1)]);
        const undo = s.moveLinesDown();
        expect(s.document.getText()).toBe("b\na\nc");
        expect(s.selections[0].active).toEqual({ line: 1, character: 1 });
        expect(undo?.label).toBe("moveLinesDown");
    });

    it("двигает все строки выделения одним блоком", () => {
        const s = state("a\nb\nc\nd", [createSelection(0, 0, 1, 1)]);
        s.moveLinesDown();
        expect(s.document.getText()).toBe("c\na\nb\nd");
        expect(s.selections[0].anchor).toEqual({ line: 1, character: 0 });
        expect(s.selections[0].active).toEqual({ line: 2, character: 1 });
    });

    it("на последней строке — no-op без undo", () => {
        const s = state("a\nb", [createCursorSelection(1, 0)]);
        expect(s.moveLinesDown()).toBeUndefined();
        expect(s.document.getText()).toBe("a\nb");
    });

    it("каретки на соседних строках едут одним блоком", () => {
        const s = state("a\nb\nc\nd", [createCursorSelection(0, 0), createCursorSelection(1, 0)]);
        s.moveLinesDown();
        expect(s.document.getText()).toBe("c\na\nb\nd");
        expect(s.selections.map((sel) => sel.active.line)).toEqual([1, 2]);
    });

    it("раздельные каретки едут независимо", () => {
        const s = state("a\nb\nc\nd\ne", [createCursorSelection(0, 0), createCursorSelection(3, 0)]);
        s.moveLinesDown();
        expect(s.document.getText()).toBe("b\na\nc\ne\nd");
        expect(s.selections.map((sel) => sel.active.line)).toEqual([1, 4]);
    });

    it("блок у нижнего края стоит, остальные едут", () => {
        const s = state("a\nb\nc\nd", [createCursorSelection(0, 0), createCursorSelection(3, 0)]);
        s.moveLinesDown();
        expect(s.document.getText()).toBe("b\na\nc\nd");
        expect(s.selections.map((sel) => sel.active.line)).toEqual([1, 3]);
    });
});

describe("EditorViewState.moveLinesUp", () => {
    it("меняет строку каретки местами со строкой выше", () => {
        const s = state("a\nb\nc", [createCursorSelection(1, 0)]);
        const undo = s.moveLinesUp();
        expect(s.document.getText()).toBe("b\na\nc");
        expect(s.selections[0].active).toEqual({ line: 0, character: 0 });
        expect(undo?.label).toBe("moveLinesUp");
    });

    it("на первой строке — no-op", () => {
        const s = state("a\nb", [createCursorSelection(0, 0)]);
        expect(s.moveLinesUp()).toBeUndefined();
        expect(s.document.getText()).toBe("a\nb");
    });

    it("выделение до колонки 0 не тянет свою последнюю строку", () => {
        const s = state("a\nb\nc", [createSelection(1, 0, 2, 0)]);
        s.moveLinesUp();
        expect(s.document.getText()).toBe("b\na\nc");
        expect(s.selections[0].anchor).toEqual({ line: 0, character: 0 });
        expect(s.selections[0].active).toEqual({ line: 1, character: 0 });
    });
});

describe("EditorViewState.deleteLines", () => {
    it("удаляет строку каретки целиком, каретка держит колонку", () => {
        const s = state("alpha\nbeta\ngamma", [createCursorSelection(1, 2)]);
        const undo = s.deleteLines();
        expect(s.document.getText()).toBe("alpha\ngamma");
        expect(s.selections[0].active).toEqual({ line: 1, character: 2 });
        expect(undo?.label).toBe("deleteLines");
    });

    it("колонка клампится к длине новой строки", () => {
        const s = state("alpha\nb", [createCursorSelection(0, 4)]);
        s.deleteLines();
        expect(s.document.getText()).toBe("b");
        expect(s.selections[0].active).toEqual({ line: 0, character: 1 });
    });

    it("удаляет все строки выделения", () => {
        const s = state("a\nb\nc\nd", [createSelection(1, 0, 2, 1)]);
        s.deleteLines();
        expect(s.document.getText()).toBe("a\nd");
        expect(s.selections[0].active.line).toBe(1);
    });

    it("последняя строка удаляется вместе с предшествующим переводом строки", () => {
        const s = state("a\nb\nc", [createCursorSelection(2, 0)]);
        s.deleteLines();
        expect(s.document.getText()).toBe("a\nb");
        expect(s.selections[0].active).toEqual({ line: 1, character: 0 });
    });

    it("единственная строка документа очищается, а не удаляется", () => {
        const s = state("alpha", [createCursorSelection(0, 3)]);
        s.deleteLines();
        expect(s.document.getText()).toBe("");
        expect(s.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("мультикурсор: смежные строки сливаются в один блок с одной кареткой", () => {
        const s = state("a\nb\nc\nd", [createCursorSelection(0, 0), createCursorSelection(1, 0)]);
        s.deleteLines();
        expect(s.document.getText()).toBe("c\nd");
        expect(s.selections).toHaveLength(1);
        expect(s.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("раздельные каретки удаляют каждая свою строку", () => {
        const s = state("a\nb\nc\nd\ne", [createCursorSelection(0, 0), createCursorSelection(2, 0)]);
        s.deleteLines();
        expect(s.document.getText()).toBe("b\nd\ne");
        expect(s.selections.map((sel) => sel.active.line)).toEqual([0, 1]);
    });

    it("удалённые выше строки укорачивают посадку каретки следующего блока", () => {
        const s = state("a\nb\nc\nd\ne\nf", [createCursorSelection(1, 0), createCursorSelection(3, 0)]);
        s.deleteLines();
        expect(s.document.getText()).toBe("a\nc\ne\nf");
        expect(s.selections.map((sel) => sel.active.line)).toEqual([1, 2]);
    });

    it("выделение до колонки 0 не удаляет свою последнюю строку", () => {
        const s = state("a\nb\nc", [createSelection(0, 0, 1, 0)]);
        s.deleteLines();
        expect(s.document.getText()).toBe("b\nc");
    });
});
