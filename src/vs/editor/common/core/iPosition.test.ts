import { describe, expect, it } from "vitest";

import { clampPositionToDocument } from "./iPosition.ts";

/**
 * Кламп позиции из внешнего источника (расширение, LSP, снимок прежнего
 * документа). Позиция за концом строки — не «неточная каретка», а сломанный
 * кадр: читатель строки по ней роняет редактор целиком.
 */
describe("clampPositionToDocument", () => {
    // «ab», «cde» — две строки разной длины: видно, что колонка клампится по
    // СВОЕЙ строке, уже после клампа номера строки.
    const doc = { lineCount: 2, getLineLength: (line: number): number => (line === 0 ? 2 : 3) };

    it("позиция внутри документа не меняется", () => {
        expect(clampPositionToDocument(doc, { line: 0, character: 1 })).toEqual({ line: 0, character: 1 });
        expect(clampPositionToDocument(doc, { line: 1, character: 3 })).toEqual({ line: 1, character: 3 });
    });

    it("строка за концом документа — последняя строка", () => {
        expect(clampPositionToDocument(doc, { line: 99, character: 0 })).toEqual({ line: 1, character: 0 });
    });

    it("отрицательная строка — первая", () => {
        expect(clampPositionToDocument(doc, { line: -5, character: 1 })).toEqual({ line: 0, character: 1 });
    });

    it("колонка за концом строки — конец строки", () => {
        expect(clampPositionToDocument(doc, { line: 0, character: 7 })).toEqual({ line: 0, character: 2 });
    });

    it("отрицательная колонка — начало строки", () => {
        expect(clampPositionToDocument(doc, { line: 1, character: -7 })).toEqual({ line: 1, character: 0 });
    });

    it("колонка клампится по строке, на которую позиция уже съехала", () => {
        // Строка 99 → 1 (длина 3), поэтому колонка 3 законна, хотя на строке 0
        // она была бы за концом.
        expect(clampPositionToDocument(doc, { line: 99, character: 3 })).toEqual({ line: 1, character: 3 });
    });
});
