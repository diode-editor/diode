import { describe, expect, it } from "vitest";

import { createFoldingRegion } from "../../contrib/folding/iFoldingRegion.ts";
import { createCursorSelection, createSelection } from "../core/iSelection.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

function state(text: string, selections: ReturnType<typeof createCursorSelection>[]): EditorViewState {
    return new EditorViewState(new TextDocument(text), selections);
}

describe("EditorViewState.getTextToCopy", () => {
    it("пустое выделение отдаёт строку целиком с \\n и маркером линейности", () => {
        const s = state("alpha\nbeta", [createCursorSelection(0, 3)]);
        expect(s.getTextToCopy(true)).toEqual({ text: "alpha\n", isFromEmptySelection: true });
    });

    it("при выключенной настройке пустое выделение не отдаёт ничего", () => {
        const s = state("alpha\nbeta", [createCursorSelection(0, 3)]);
        expect(s.getTextToCopy(false)).toEqual({ text: "", isFromEmptySelection: false });
    });

    it("непустое выделение отдаёт свой текст без маркера", () => {
        const s = state("alpha\nbeta", [createSelection(0, 0, 0, 5)]);
        expect(s.getTextToCopy(true)).toEqual({ text: "alpha", isFromEmptySelection: false });
    });

    it("каретка не на первой строке отдаёт свою строку", () => {
        const s = state("alpha\nbeta", [createCursorSelection(1, 2)]);
        expect(s.getTextToCopy(true)).toEqual({ text: "beta\n", isFromEmptySelection: true });
    });

    it("смешанный набор: первая каретка не на первой строке несёт свою строку", () => {
        const s = state("alpha\nbeta\ngamma", [createCursorSelection(1, 1), createSelection(2, 0, 2, 2)]);
        expect(s.getTextToCopy(true)).toEqual({ text: "beta\nga", isFromEmptySelection: false });
    });

    it("при выключенной настройке смешанный набор отдаёт только выделенное", () => {
        const s = state("alpha\nbeta", [createCursorSelection(0, 1), createSelection(1, 0, 1, 2)]);
        expect(s.getTextToCopy(false)).toEqual({ text: "be", isFromEmptySelection: false });
    });

    it("несколько пустых кареток отдают свои строки, маркера линейности нет", () => {
        const s = state("a\nb\nc", [createCursorSelection(0, 0), createCursorSelection(2, 0)]);
        expect(s.getTextToCopy(true)).toEqual({ text: "a\nc\n", isFromEmptySelection: false });
    });

    it("две каретки на одной строке несут её один раз, маркер только у единственной", () => {
        const s = state("alpha\nbeta", [createCursorSelection(0, 1), createCursorSelection(0, 4)]);
        expect(s.getTextToCopy(true)).toEqual({ text: "alpha\n", isFromEmptySelection: false });
    });

    it("смешанный набор: пустая каретка на строке выделения не дублирует строку", () => {
        const s = state("hello world", [createSelection(0, 0, 0, 5), createCursorSelection(0, 8)]);
        expect(s.getTextToCopy(true)).toEqual({ text: "hello", isFromEmptySelection: false });
    });

    it("смешанный набор: пустые каретки несут строку, непустые — выделенное", () => {
        const s = state("alpha\nbeta\ngamma", [createCursorSelection(0, 2), createSelection(2, 0, 2, 5)]);
        expect(s.getTextToCopy(true)).toEqual({ text: "alpha\ngamma", isFromEmptySelection: false });
    });
});

describe("EditorViewState.cutSelections", () => {
    it("пустая каретка вырезает строку целиком вместе с переводом строки", () => {
        const s = state("alpha\nbeta\ngamma", [createCursorSelection(1, 2)]);
        const undo = s.cutSelections(true);
        expect(s.document.getText()).toBe("alpha\ngamma");
        expect(s.selections[0].active).toEqual({ line: 1, character: 0 });
        expect(undo?.label).toBe("cut");
    });

    it("при выключенной настройке пустая каретка не режет ничего", () => {
        const s = state("alpha\nbeta", [createCursorSelection(0, 2)]);
        expect(s.cutSelections(false)).toBeUndefined();
        expect(s.document.getText()).toBe("alpha\nbeta");
    });

    it("непустое выделение вырезает только диапазон", () => {
        const s = state("hello world", [createSelection(0, 0, 0, 6)]);
        s.cutSelections(true);
        expect(s.document.getText()).toBe("world");
        expect(s.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("последняя строка вырезается вместе с предшествующим переводом строки", () => {
        const s = state("a\nb\nc", [createCursorSelection(2, 1)]);
        s.cutSelections(true);
        expect(s.document.getText()).toBe("a\nb");
    });

    it("единственная строка документа очищается", () => {
        const s = state("alpha", [createCursorSelection(0, 2)]);
        s.cutSelections(true);
        expect(s.document.getText()).toBe("");
    });

    it("мультикурсор: каждая пустая каретка режет свою строку, каретки остаются", () => {
        const s = state("a\nb\nc\nd", [createCursorSelection(0, 0), createCursorSelection(2, 0)]);
        s.cutSelections(true);
        expect(s.document.getText()).toBe("b\nd");
        expect(s.selections.map((sel) => sel.active.line)).toEqual([0, 1]);
    });

    it("каретки на соседних строках в середине документа режут каждая свою строку", () => {
        const s = state("a\nb\nc\nd", [createCursorSelection(0, 0), createCursorSelection(1, 0)]);
        s.cutSelections(true);
        expect(s.document.getText()).toBe("c\nd");
        expect(s.selections.map((sel) => sel.active.line)).toEqual([0]);
    });

    it("каретки на соседних строках у конца документа режут без конфликта правок", () => {
        const s = state("a\nb\nc", [createCursorSelection(1, 0), createCursorSelection(2, 0)]);
        s.cutSelections(true);
        expect(s.document.getText()).toBe("a");
    });

    it("смешанный набор: пустая каретка режет строку, непустое выделение — диапазон", () => {
        const s = state("alpha\nbeta\ngamma", [createCursorSelection(0, 2), createSelection(2, 0, 2, 3)]);
        s.cutSelections(true);
        expect(s.document.getText()).toBe("beta\nma");
    });

    it("пустая каретка на строке непустого выделения не режет строку вторым разом", () => {
        const s = state("hello world", [createCursorSelection(0, 8), createSelection(0, 0, 0, 5)]);
        s.cutSelections(true);
        // Строку уже задевает выделение — каретка не добавляет удаление всей строки.
        expect(s.document.getText()).toBe(" world");
    });

    it("две каретки на одной строке режут её один раз", () => {
        const s = state("alpha\nbeta", [createCursorSelection(0, 1), createCursorSelection(0, 4)]);
        s.cutSelections(true);
        expect(s.document.getText()).toBe("beta");
    });

    it("каретка ниже выделения режет свою строку", () => {
        const s = state("alpha\nbeta\ngamma", [createSelection(0, 0, 0, 3), createCursorSelection(2, 1)]);
        s.cutSelections(true);
        expect(s.document.getText()).toBe("ha\nbeta");
    });

    it("read-only: cut — no-op без undo", () => {
        const s = state("alpha", [createCursorSelection(0, 0)]);
        s.readOnly = true;
        expect(s.cutSelections(true)).toBeUndefined();
        expect(s.document.getText()).toBe("alpha");
    });

    it("cut строки сдвигает фолд-регионы ниже", () => {
        const s = state("a\nb\nc\nd", [createCursorSelection(0, 0)]);
        s.setFoldingRegions([createFoldingRegion(2, 3)]);
        s.cutSelections(true);
        expect(s.foldedRegions).toEqual([createFoldingRegion(1, 2)]);
    });
});

describe("EditorViewState.pasteText", () => {
    it("линейная вставка кладёт строку выше курсорной, каретка остаётся у своего текста", () => {
        const s = state("alpha\nbeta", [createCursorSelection(1, 2)]);
        const undo = s.pasteText("copied\n", true);
        expect(s.document.getText()).toBe("alpha\ncopied\nbeta");
        expect(s.selections[0].active).toEqual({ line: 2, character: 2 });
        expect(undo?.label).toBe("paste");
    });

    it("без маркера линейности вставляет в позицию каретки", () => {
        const s = state("alpha\nbeta", [createCursorSelection(1, 2)]);
        s.pasteText("copied\n", false);
        expect(s.document.getText()).toBe("alpha\nbecopied\nta");
    });

    it("линейность действует только на однострочный текст с завершающим \\n", () => {
        const s = state("ab", [createCursorSelection(0, 1)]);
        s.pasteText("x\ny\n", true);
        expect(s.document.getText()).toBe("ax\ny\nb");
    });

    it("непустое выделение заменяется текстом даже при линейной вставке", () => {
        const s = state("alpha\nbeta", [createSelection(0, 0, 0, 5)]);
        s.pasteText("copied\n", true);
        expect(s.document.getText()).toBe("copied\n\nbeta");
    });

    it("мультикурсор: каждая пустая каретка получает строку над собой", () => {
        const s = state("a\nb", [createCursorSelection(0, 1), createCursorSelection(1, 1)]);
        s.pasteText("x\n", true);
        expect(s.document.getText()).toBe("x\na\nx\nb");
        expect(s.selections.map((sel) => sel.active)).toEqual([
            { line: 1, character: 1 },
            { line: 3, character: 1 },
        ]);
    });

    it("read-only: линейная вставка — no-op без undo", () => {
        const s = state("alpha", [createCursorSelection(0, 0)]);
        s.readOnly = true;
        expect(s.pasteText("copied\n", true)).toBeUndefined();
        expect(s.document.getText()).toBe("alpha");
    });

    it("вставка пустой строки (только \\n) линейно кладёт пустую строку выше", () => {
        const s = state("alpha", [createCursorSelection(0, 3)]);
        s.pasteText("\n", true);
        expect(s.document.getText()).toBe("\nalpha");
        expect(s.selections[0].active).toEqual({ line: 1, character: 3 });
    });

    it("линейная вставка сдвигает фолд-регионы ниже", () => {
        const s = state("a\nb\nc\nd", [createCursorSelection(0, 0)]);
        s.setFoldingRegions([createFoldingRegion(2, 3)]);
        s.pasteText("x\n", true);
        expect(s.foldedRegions).toEqual([createFoldingRegion(3, 4)]);
    });

    it("линейная вставка в конце файла прокручивает вьюпорт за кареткой", () => {
        const doc = Array.from({ length: 30 }, (_, i) => `line${String(i)}`).join("\n");
        const s = state(doc, [createCursorSelection(29, 0)]);
        s.scrollTop = 6; // каретка у нижнего края вьюпорта 80x24
        s.pasteText("x\n", true);
        expect(s.scrollTop).toBe(7);
    });
});
