import { describe, expect, it } from "vitest";

import { createRange } from "./iRange.ts";
import {
    compareTextEditsInDocumentOrder,
    createDeleteEdit,
    createInsertEdit,
    createTextEdit,
    hasOverlappingEdits,
} from "./iTextEdit.ts";

describe("hasOverlappingEdits", () => {
    it("an empty batch and a single edit do not overlap", () => {
        expect(hasOverlappingEdits([])).toBe(false);
        expect(hasOverlappingEdits([createDeleteEdit(0, 0, 0, 5)])).toBe(false);
    });

    it("edits in different places do not overlap", () => {
        expect(hasOverlappingEdits([createDeleteEdit(0, 0, 0, 2), createDeleteEdit(1, 3, 1, 5)])).toBe(false);
    });

    it("batch order does not matter: edits arrive in any order", () => {
        expect(hasOverlappingEdits([createDeleteEdit(1, 3, 1, 5), createDeleteEdit(0, 0, 0, 2)])).toBe(false);
    });

    it("adjacent edits do not overlap", () => {
        expect(hasOverlappingEdits([createDeleteEdit(0, 0, 0, 2), createDeleteEdit(0, 2, 0, 4)])).toBe(false);
    });

    it("two zero-width inserts at one point do not overlap", () => {
        expect(hasOverlappingEdits([createInsertEdit(1, 1, "p"), createInsertEdit(1, 1, "q")])).toBe(false);
    });

    it("an overlap on one line is detected", () => {
        expect(hasOverlappingEdits([createDeleteEdit(0, 0, 0, 5), createDeleteEdit(0, 3, 0, 8)])).toBe(true);
    });

    it("an overlap given in reverse order is detected too", () => {
        expect(hasOverlappingEdits([createDeleteEdit(0, 3, 0, 8), createDeleteEdit(0, 0, 0, 5)])).toBe(true);
    });

    it("an insert inside another multi-line range is an overlap", () => {
        expect(
            hasOverlappingEdits([
                createTextEdit(createRange(0, 1, 2, 1), "x"),
                createInsertEdit(1, 0, "y"),
                createDeleteEdit(3, 0, 3, 1),
            ]),
        ).toBe(true);
    });

    it("an overlap is found in the middle of a long batch too", () => {
        expect(
            hasOverlappingEdits([
                createDeleteEdit(0, 0, 0, 1),
                createDeleteEdit(1, 0, 1, 1),
                createDeleteEdit(2, 0, 2, 4),
                createDeleteEdit(2, 2, 2, 6),
            ]),
        ).toBe(true);
    });
});

describe("compareTextEditsInDocumentOrder", () => {
    it("by start first, even when ends coincide", () => {
        const replace = createTextEdit(createRange(0, 0, 0, 2), "X");
        const insertAtEnd = createTextEdit(createRange(0, 2, 0, 2), "Y");
        expect(compareTextEditsInDocumentOrder(replace, insertAtEnd)).toBeLessThan(0);
        expect(compareTextEditsInDocumentOrder(insertAtEnd, replace)).toBeGreaterThan(0);
    });

    it("with equal starts — by end", () => {
        const insert = createTextEdit(createRange(0, 1, 0, 1), "X");
        const replace = createTextEdit(createRange(0, 1, 0, 3), "Y");
        expect(compareTextEditsInDocumentOrder(insert, replace)).toBeLessThan(0);
        expect(compareTextEditsInDocumentOrder(insert, insert)).toBe(0);
    });
});
