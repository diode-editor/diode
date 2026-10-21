import { describe, expect, it } from "vitest";

import { clampPositionToDocument } from "./iPosition.ts";

describe("clampPositionToDocument", () => {
    // Lines differ in length: the column is clamped against its OWN line, after the line is clamped.
    const doc = { lineCount: 2, getLineLength: (line: number): number => (line === 0 ? 2 : 3) };

    it("a position inside the document is unchanged", () => {
        expect(clampPositionToDocument(doc, { line: 0, character: 1 })).toEqual({ line: 0, character: 1 });
        expect(clampPositionToDocument(doc, { line: 1, character: 3 })).toEqual({ line: 1, character: 3 });
    });

    it("a line past the document end becomes the last line", () => {
        expect(clampPositionToDocument(doc, { line: 99, character: 0 })).toEqual({ line: 1, character: 0 });
    });

    it("a negative line becomes the first", () => {
        expect(clampPositionToDocument(doc, { line: -5, character: 1 })).toEqual({ line: 0, character: 1 });
    });

    it("a column past the line end becomes the line end", () => {
        expect(clampPositionToDocument(doc, { line: 0, character: 7 })).toEqual({ line: 0, character: 2 });
    });

    it("a negative column becomes the line start", () => {
        expect(clampPositionToDocument(doc, { line: 1, character: -7 })).toEqual({ line: 1, character: 0 });
    });

    it("the column is clamped against the line the position has already moved to", () => {
        expect(clampPositionToDocument(doc, { line: 99, character: 3 })).toEqual({ line: 1, character: 3 });
    });
});
