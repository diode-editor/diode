import { describe, expect, it } from "vitest";

import { createCursorSelection, createSelection } from "../core/iSelection.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

type Sel = ReturnType<typeof createCursorSelection>;

/**
 * Tab добирает каретку ДО следующего табстопа, а не вставляет всегда `tabSize`
 * пробелов. Сьют смотрит на наблюдаемый результат: текст документа И колонку
 * каретки после нажатия — именно колонку пользователь видит в статус-баре
 * (`Ln 1, Col 7` вместо `Col 5` и был симптомом).
 */
function spacesState(text: string, selections: Sel[], tabSize = 4): EditorViewState {
    const state = new EditorViewState(new TextDocument(text), selections);
    state.insertSpaces = true;
    state.tabSize = tabSize;
    state.detectIndentation = false;
    return state;
}

function tabsState(text: string, selections: Sel[], tabSize = 4): EditorViewState {
    const state = new EditorViewState(new TextDocument(text), selections);
    state.insertSpaces = false;
    state.tabSize = tabSize;
    state.detectIndentation = false;
    return state;
}

describe("Tab выравнивает каретку по табстопам (insertSpaces, tabSize=4)", () => {
    // Колонка каретки до Tab → текст после Tab и колонка каретки после.
    // Все каретки доезжают ровно до табстопа: 4 или 8, и ни колонкой дальше.
    const cases: { from: number; text: string; to: number }[] = [
        { from: 0, text: "    abcdefgh", to: 4 },
        { from: 1, text: "a   bcdefgh", to: 4 },
        { from: 3, text: "abc defgh", to: 4 },
        { from: 4, text: "abcd    efgh", to: 8 },
        { from: 5, text: "abcde   fgh", to: 8 },
    ];

    for (const { from, text, to } of cases) {
        it(`с колонки ${from} уводит на ${to}`, () => {
            const state = spacesState("abcdefgh", [createCursorSelection(0, from)]);
            state.indentLines();
            expect(state.document.getText()).toBe(text);
            expect(state.selections[0].active).toEqual({ line: 0, character: to });
        });
    }

    it("на табстопе вставляет полный уровень", () => {
        const state = spacesState("abcdefgh", [createCursorSelection(0, 8)]);
        state.indentLines();
        expect(state.document.getText()).toBe("abcdefgh    ");
        expect(state.selections[0].active).toEqual({ line: 0, character: 12 });
    });

    it("tabSize=2: каретка с колонки 1 уезжает на 2", () => {
        const state = spacesState("abcd", [createCursorSelection(0, 1)], 2);
        state.indentLines();
        expect(state.document.getText()).toBe("a bcd");
        expect(state.selections[0].active).toEqual({ line: 0, character: 2 });
    });

    it("tabSize=3: каретка с колонки 4 уезжает на 6", () => {
        const state = spacesState("abcdef", [createCursorSelection(0, 4)], 3);
        state.indentLines();
        expect(state.document.getText()).toBe("abcd  ef");
        expect(state.selections[0].active).toEqual({ line: 0, character: 6 });
    });
});

describe("Tab считает табстоп по ВИДИМОЙ колонке", () => {
    it("таб слева от каретки занимает своё расстояние до табстопа", () => {
        // "\ta|b": таб — это колонки 0..3, "a" — колонка 4, каретка на 5.
        // По символьному offset'у (2) вышло бы 2 пробела вместо 3.
        const state = spacesState("\tab", [createCursorSelection(0, 2)]);
        state.indentLines();
        expect(state.document.getText()).toBe("\ta   b");
        expect(state.selections[0].active).toEqual({ line: 0, character: 5 });
    });

    it("широкая графема занимает две колонки", () => {
        // "你a|b": 你 — колонки 0..1, "a" — колонка 2, каретка на 3.
        const state = spacesState("你ab", [createCursorSelection(0, 2)]);
        state.indentLines();
        expect(state.document.getText()).toBe("你a b");
        expect(state.selections[0].active).toEqual({ line: 0, character: 3 });
    });
});

describe("Tab у мультикурсора — своя добавка на каждую каретку", () => {
    it("каретки на разных колонках одной строки получают разное число пробелов", () => {
        const state = spacesState("abcdefgh", [createCursorSelection(0, 1), createCursorSelection(0, 6)]);
        state.indentLines();
        // Колонка 1 → 3 пробела (до 4), колонка 6 → 2 пробела (до 8).
        expect(state.document.getText()).toBe("a   bcdef  gh");
        expect(state.selections.map((sel) => sel.active)).toEqual([
            { line: 0, character: 4 },
            { line: 0, character: 11 },
        ]);
    });

    it("каретки на разных строках считают табстоп по своей строке", () => {
        const state = spacesState("ab\nabcdef", [createCursorSelection(0, 1), createCursorSelection(1, 2)]);
        state.indentLines();
        expect(state.document.getText()).toBe("a   b\nab  cdef");
        expect(state.selections.map((sel) => sel.active)).toEqual([
            { line: 0, character: 4 },
            { line: 1, character: 4 },
        ]);
    });

    it("одна строка с табом, другая без — каждая по своей видимой колонке", () => {
        const state = spacesState("\tab\nab", [createCursorSelection(0, 2), createCursorSelection(1, 2)]);
        state.indentLines();
        // Строка 0: видимая колонка 5 → 3 пробела. Строка 1: колонка 2 → 2 пробела.
        expect(state.document.getText()).toBe("\ta   b\nab  ");
        expect(state.selections.map((sel) => sel.active)).toEqual([
            { line: 0, character: 5 },
            { line: 1, character: 4 },
        ]);
    });
});

describe("Tab с выделением внутри строки", () => {
    it("заменяет выделение добавкой до табстопа от его НАЧАЛА", () => {
        const state = spacesState("abcdefgh", [createSelection(0, 1, 0, 3)]);
        state.indentLines();
        // Выделение "bc" стёрто, вставлены 3 пробела: каретка на табстопе 4.
        expect(state.document.getText()).toBe("a   defgh");
        expect(state.selections[0].active).toEqual({ line: 0, character: 4 });
    });
});

describe("Tab табами табстопы не считает", () => {
    it("вставляет один \\t с любой колонки", () => {
        const state = tabsState("abcdefgh", [createCursorSelection(0, 5)]);
        state.indentLines();
        expect(state.document.getText()).toBe("abcde\tfgh");
        expect(state.selections[0].active).toEqual({ line: 0, character: 6 });
    });

    it("мультикурсор получает по одному \\t на каретку", () => {
        const state = tabsState("abcdefgh", [createCursorSelection(0, 1), createCursorSelection(0, 6)]);
        state.indentLines();
        expect(state.document.getText()).toBe("a\tbcdef\tgh");
    });
});

describe("Tab/Shift+Tab остаются обратимы на отступе строки", () => {
    it("Tab с колонки 0 и Shift+Tab возвращают строку как была", () => {
        const state = spacesState("ab", [createCursorSelection(0, 0)]);
        state.indentLines();
        expect(state.document.getText()).toBe("    ab");
        state.outdentLines();
        expect(state.document.getText()).toBe("ab");
    });

    it("undo-шаг Tab'а обратим своими обратными правками", () => {
        const state = spacesState("abcdefgh", [createCursorSelection(0, 5)]);
        const undo = state.indentLines();
        expect(undo).toBeDefined();
        expect(state.document.getText()).toBe("abcde   fgh");
        state.document.applyEdits(undo!.backwardEdits);
        expect(state.document.getText()).toBe("abcdefgh");
    });
});
