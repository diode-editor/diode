import { describe, expect, it } from "vitest";

import { createCursorSelection, createSelection, getIdealColumn, withIdealColumn } from "./iSelection.ts";

describe("withIdealColumn", () => {
    it("returns a new selection carrying the given ideal column", () => {
        const sel = createSelection(1, 2, 3, 4);
        const result = withIdealColumn(sel, 9);

        expect(result.idealColumn).toBe(9);
        expect(getIdealColumn(result)).toBe(9);
    });

    it("preserves anchor and active positions unchanged", () => {
        const sel = createSelection(1, 2, 3, 4, 0);
        const result = withIdealColumn(sel, 42);

        expect(result.anchor).toEqual({ line: 1, character: 2 });
        expect(result.active).toEqual({ line: 3, character: 4 });
    });

    it("does not mutate the original selection", () => {
        const sel = createCursorSelection(0, 5);
        withIdealColumn(sel, 100);

        expect(sel.idealColumn).toBeUndefined();
        expect(getIdealColumn(sel)).toBe(5);
    });

    it("overrides an existing ideal column", () => {
        const sel = createCursorSelection(0, 3, 7);
        const result = withIdealColumn(sel, 1);

        expect(result.idealColumn).toBe(1);
    });
});
