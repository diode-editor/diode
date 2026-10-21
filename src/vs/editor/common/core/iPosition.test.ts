import { describe, expect, it } from "vitest";

import { clampPositionToDocument } from "./iPosition.ts";

describe("clampPositionToDocument", () => {
    // Lines differ in length: the column is clamped against its OWN line, after the line is clamped.
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
        expect(clampPositionToDocument(doc, { line: 99, character: 3 })).toEqual({ line: 1, character: 3 });
    });
});
