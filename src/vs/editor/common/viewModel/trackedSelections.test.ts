import { describe, expect, it } from "vitest";

import { createRange } from "../core/iRange.ts";
import type { ISelection } from "../core/iSelection.ts";
import { createCursorSelection, createSelection } from "../core/iSelection.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";
import { compareTextEditsInDocumentOrder, createTextEdit } from "../core/iTextEdit.ts";
import { TextDocument } from "../model/textDocument.ts";

import { planTrackedSelections, resolveTrackedSelections } from "./trackedSelections.ts";

/** План по исходному тексту → применение → выделения по обратным правкам, как в `EditorViewState.applyEdits`. */
function track(text: string, edits: ITextEdit[], selections: ISelection[]): { text: string; selections: ISelection[] } {
    const doc = new TextDocument(text);
    const sorted = [...edits].sort(compareTextEditsInDocumentOrder);
    const plan = planTrackedSelections(doc, sorted, selections);
    const { inverseEdits } = doc.applyEdits(edits);
    return { text: doc.getText(), selections: resolveTrackedSelections(plan, sorted, inverseEdits) };
}

const caret = (line: number, character: number): ISelection => createCursorSelection(line, character);
const insert = (line: number, character: number, text: string): ITextEdit =>
    createTextEdit(createRange(line, character, line, character), text);
const replace = (sl: number, sc: number, el: number, ec: number, text: string): ITextEdit =>
    createTextEdit(createRange(sl, sc, el, ec), text);

/** Каретки и выделения как `[anchorLine, anchorChar, activeLine, activeChar]`. */
function flat(selections: readonly ISelection[]): number[][] {
    return selections.map((s) => [s.anchor.line, s.anchor.character, s.active.line, s.active.character]);
}

describe("trackedSelections: каретки сдвигаются вслед за правками (маркеры эталона)", () => {
    it("правка ниже каретки её не трогает", () => {
        const result = track("abc\ndef", [replace(1, 1, 1, 2, "X")], [caret(0, 2)]);
        expect(result.text).toBe("abc\ndXf");
        expect(flat(result.selections)).toEqual([[0, 2, 0, 2]]);
    });

    it("вставка строк выше уводит каретку вниз на их число, колонка та же", () => {
        const result = track("a\nfoo", [insert(0, 0, "x\ny\n")], [caret(1, 2)]);
        expect(result.text).toBe("x\ny\na\nfoo");
        expect(flat(result.selections)).toEqual([[3, 2, 3, 2]]);
    });

    it("правка левее на той же строке сдвигает колонку на разницу длин", () => {
        const result = track("abcdef", [replace(0, 1, 0, 3, "XYZW")], [caret(0, 5)]);
        expect(result.text).toBe("aXYZWdef");
        expect(flat(result.selections)).toEqual([[0, 7, 0, 7]]);
    });

    it("вставка ровно в каретку: каретка встаёт в конец вставки, ничего не выделяя", () => {
        const result = track("ab", [insert(0, 1, "XY")], [caret(0, 1)]);
        expect(result.text).toBe("aXYb");
        expect(flat(result.selections)).toEqual([[0, 3, 0, 3]]);
    });

    it("удаление, начинающееся в каретке, её не двигает", () => {
        const result = track("abcd", [replace(0, 1, 0, 3, "")], [caret(0, 1)]);
        expect(result.text).toBe("ad");
        expect(flat(result.selections)).toEqual([[0, 1, 0, 1]]);
    });

    it("каретка внутри удаления и на его конце встаёт в начало удаления (trim trailing whitespace)", () => {
        const result = track(
            "ab   \ncd  ",
            [replace(0, 2, 0, 5, ""), replace(1, 2, 1, 4, "")],
            [caret(0, 3), caret(1, 4)],
        );
        expect(result.text).toBe("ab\ncd");
        expect(flat(result.selections)).toEqual([
            [0, 2, 0, 2],
            [1, 2, 1, 2],
        ]);
    });

    it("каретка в общей части замены держит смещение, глубже — уезжает в конец вставки", () => {
        // Замена «bcde» на «XY»: общая часть — 2 символа.
        const result = track("abcdef", [replace(0, 1, 0, 5, "XY")], [caret(0, 2), caret(0, 3), caret(0, 4)]);
        expect(result.text).toBe("aXYf");
        expect(flat(result.selections)).toEqual([
            [0, 2, 0, 2],
            [0, 3, 0, 3],
            [0, 3, 0, 3],
        ]);
    });

    it("смещение внутри многострочной вставки считается по её строкам", () => {
        // «bc» → «X\nYZ»: каретка после «b» держит смещение 1 (после «X»),
        // после «c» (конец заменяемого, вставка длиннее) — уезжает в конец вставки.
        const result = track("abcd", [replace(0, 1, 0, 3, "X\nYZ")], [caret(0, 2), caret(0, 3)]);
        expect(result.text).toBe("aX\nYZd");
        expect(flat(result.selections)).toEqual([
            [0, 2, 0, 2],
            [1, 2, 1, 2],
        ]);
    });

    it("смещение внутри многострочного заменяемого меряется по исходному тексту", () => {
        // «b\ncd» (4 символа) → «WXYZ»: каретка после «c» — смещение 3.
        const result = track("ab\ncde", [replace(0, 1, 1, 2, "WXYZ")], [caret(1, 1)]);
        expect(result.text).toBe("aWXYZe");
        expect(flat(result.selections)).toEqual([[0, 4, 0, 4]]);
    });

    it("каретка на границе замены длиннее заменяемого уезжает в конец вставки", () => {
        // «bc» → «XYZ»: маркер на конце заменяемого — на конце общей части,
        // конец выделения не липнет влево, поэтому едет дальше.
        const result = track("abcd", [replace(0, 1, 0, 3, "XYZ")], [caret(0, 3)]);
        expect(result.text).toBe("aXYZd");
        expect(flat(result.selections)).toEqual([[0, 4, 0, 4]]);
    });

    it("каретка на границе замены короче заменяемого остаётся на конце общей части", () => {
        // «bcd» → «XY»: удаление длиннее вставки — маркер на конце общей части стоит.
        const result = track("abcde", [replace(0, 1, 0, 4, "XY")], [caret(0, 3)]);
        expect(result.text).toBe("aXYe");
        expect(flat(result.selections)).toEqual([[0, 3, 0, 3]]);
    });

    it("начало выделения на границе общей части липнет влево и стоит", () => {
        // «bc» → «XYZ»: начало на конце «bc» (общая часть 2) остаётся после «XY».
        const result = track("abcde", [replace(0, 1, 0, 3, "XYZ")], [createSelection(0, 3, 0, 4)]);
        expect(result.text).toBe("aXYZde");
        expect(flat(result.selections)).toEqual([[0, 3, 0, 5]]);
    });

    it("выделение растёт, когда вставка ложится на его края", () => {
        const result = track("abcd", [insert(0, 1, "<"), insert(0, 3, ">")], [createSelection(0, 1, 0, 3)]);
        expect(result.text).toBe("a<bc>d");
        expect(flat(result.selections)).toEqual([[0, 1, 0, 5]]);
    });

    it("направление выделения сохраняется", () => {
        const result = track("abcd", [insert(0, 0, "xx")], [createSelection(0, 3, 0, 1)]);
        expect(result.text).toBe("xxabcd");
        expect(flat(result.selections)).toEqual([[0, 5, 0, 3]]);
    });

    it("у обратного выделения липнет влево его начало — active, а не anchor", () => {
        // Вставка в правый край (anchor) растит выделение, в левый (active) — нет.
        const result = track("abcdef", [insert(0, 1, "<"), insert(0, 4, ">")], [createSelection(0, 4, 0, 1)]);
        expect(result.text).toBe("a<bcd>ef");
        expect(flat(result.selections)).toEqual([[0, 6, 0, 1]]);
    });

    it("правка на строке ниже нулевой сдвигает строки каретки на свою разницу строк", () => {
        const result = track("a\nb\nc\nd", [insert(1, 0, "X\nY\n")], [caret(3, 1)]);
        expect(result.text).toBe("a\nX\nY\nb\nc\nd");
        expect(flat(result.selections)).toEqual([[5, 1, 5, 1]]);
    });

    it("стык замены и удаления: начало выделения остаётся в общей части замены", () => {
        // «ab» → «abXY» и удаление «cd» встык: удаление начало не двигает, решает замена.
        const edits = [replace(0, 0, 0, 2, "abXY"), replace(0, 2, 0, 4, "")];
        const result = track("abcdefgh", edits, [createSelection(0, 2, 0, 6)]);
        expect(result.text).toBe("abXYefgh");
        expect(flat(result.selections)).toEqual([[0, 2, 0, 6]]);
    });

    it("стык удаления и вставки: каретка встаёт за вставку, начало выделения — перед ней", () => {
        // Удаление «bc» и вставка «XY» в точку его конца.
        const edits = [replace(0, 1, 0, 3, ""), insert(0, 3, "XY")];
        const result = track("abcd", edits, [caret(0, 3), createSelection(0, 3, 0, 4)]);
        expect(result.text).toBe("aXYd");
        expect(flat(result.selections)).toEqual([
            [0, 3, 0, 3],
            [0, 1, 0, 4],
        ]);
    });

    it("стык с пустой правкой выше по порядку: маркер достаётся нижней", () => {
        // Вставка пустой строки в конец «bc» маркер не двигает — решает удаление.
        const edits = [replace(0, 1, 0, 3, ""), insert(0, 3, "")];
        const result = track("abcd", edits, [caret(0, 3)]);
        expect(result.text).toBe("ad");
        expect(flat(result.selections)).toEqual([[0, 1, 0, 1]]);
    });
});
