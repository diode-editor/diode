import { describe, expect, it } from "vitest";

import type { ISelection } from "./iSelection.ts";
import { createCursorSelection, createSelection } from "./iSelection.ts";
import { sortAndMergeSelections } from "./sortAndMergeSelections.ts";

/** [anchorLine, anchorCh, activeLine, activeCh]. */
function shape(selection: ISelection): number[] {
    return [selection.anchor.line, selection.anchor.character, selection.active.line, selection.active.character];
}

describe("sortAndMergeSelections — degenerate inputs", () => {
    it("an empty array stays empty", () => {
        expect(sortAndMergeSelections([])).toEqual([]);
    });

    it("a single selection returns a copy of the array, not the same array", () => {
        const input = [createCursorSelection(0, 3)];
        const result = sortAndMergeSelections(input);
        expect(result).toHaveLength(1);
        expect(result[0]).toBe(input[0]);
        expect(result).not.toBe(input);
    });
});

describe("sortAndMergeSelections — sorting", () => {
    it("orders cursors in document order", () => {
        const result = sortAndMergeSelections([
            createCursorSelection(2, 0),
            createCursorSelection(0, 5),
            createCursorSelection(1, 1),
        ]);
        expect(result.map((sel) => sel.active.line)).toEqual([0, 1, 2]);
    });

    it("sorts by range start, not by active (reversed selection)", () => {
        const backwards = createSelection(2, 0, 0, 0);
        const later = createCursorSelection(3, 0);
        expect(sortAndMergeSelections([later, backwards])[0]).toBe(backwards);
    });

    it("with a shared start the range end sets the order, not sort stability", () => {
        const longer = createSelection(0, 0, 0, 6);
        const shorter = createSelection(0, 0, 0, 2);
        expect(sortAndMergeSelections([longer, shorter])).toHaveLength(1);
        expect(shape(sortAndMergeSelections([longer, shorter])[0])).toEqual([0, 0, 0, 6]);
        expect(shape(sortAndMergeSelections([shorter, longer])[0])).toEqual([0, 0, 0, 6]);
    });
});

describe("sortAndMergeSelections — merging with a cursor", () => {
    it("two cursors at one point merge into one", () => {
        const result = sortAndMergeSelections([createCursorSelection(1, 4), createCursorSelection(1, 4)]);
        expect(result).toHaveLength(1);
        expect(shape(result[0])).toEqual([1, 4, 1, 4]);
    });

    it("a cursor inside a selection is absorbed by it", () => {
        const result = sortAndMergeSelections([createSelection(0, 0, 0, 5), createCursorSelection(0, 3)]);
        expect(result).toHaveLength(1);
        expect(shape(result[0])).toEqual([0, 0, 0, 5]);
    });

    it("a cursor exactly at the selection end counts as touching and merges", () => {
        const result = sortAndMergeSelections([createSelection(0, 0, 0, 5), createCursorSelection(0, 5)]);
        expect(result).toHaveLength(1);
        expect(shape(result[0])).toEqual([0, 0, 0, 5]);
    });

    it("a cursor exactly at the selection start merges too", () => {
        const result = sortAndMergeSelections([createSelection(0, 2, 0, 5), createCursorSelection(0, 2)]);
        expect(result).toHaveLength(1);
        expect(shape(result[0])).toEqual([0, 2, 0, 5]);
    });

    it("a cursor past the selection end stays a separate cursor", () => {
        const result = sortAndMergeSelections([createSelection(0, 0, 0, 5), createCursorSelection(0, 6)]);
        expect(result).toHaveLength(2);
    });
});

describe("sortAndMergeSelections — merging non-empty selections", () => {
    it("adjacent selections do NOT merge (parity with VS Code)", () => {
        const result = sortAndMergeSelections([createSelection(0, 0, 0, 2), createSelection(0, 2, 0, 4)]);
        expect(result).toHaveLength(2);
        expect(result.map(shape)).toEqual([
            [0, 0, 0, 2],
            [0, 2, 0, 4],
        ]);
    });

    it("a real overlap yields the union range", () => {
        const result = sortAndMergeSelections([createSelection(0, 0, 0, 4), createSelection(0, 2, 0, 7)]);
        expect(result).toHaveLength(1);
        expect(shape(result[0])).toEqual([0, 0, 0, 7]);
    });

    it("a nested selection is absorbed by the enclosing one", () => {
        const result = sortAndMergeSelections([createSelection(0, 0, 0, 9), createSelection(0, 3, 0, 5)]);
        expect(result).toHaveLength(1);
        expect(shape(result[0])).toEqual([0, 0, 0, 9]);
    });

    it("overlap across a line boundary", () => {
        const result = sortAndMergeSelections([createSelection(0, 2, 1, 3), createSelection(1, 1, 2, 4)]);
        expect(result).toHaveLength(1);
        expect(shape(result[0])).toEqual([0, 2, 2, 4]);
    });

    it("cascade: merging the first two enables merging with the third", () => {
        const result = sortAndMergeSelections([
            createSelection(0, 0, 0, 3),
            createSelection(0, 2, 0, 6),
            createSelection(0, 5, 0, 9),
        ]);
        expect(result).toHaveLength(1);
        expect(shape(result[0])).toEqual([0, 0, 0, 9]);
    });

    it("non-mergeable neighbours stay in document order", () => {
        const result = sortAndMergeSelections([
            createSelection(2, 0, 2, 1),
            createSelection(0, 0, 0, 4),
            createSelection(0, 2, 0, 6),
        ]);
        expect(result.map(shape)).toEqual([
            [0, 0, 0, 6],
            [2, 0, 2, 1],
        ]);
    });
});

describe("sortAndMergeSelections — direction and idealColumn", () => {
    it("direction is inherited from the later-added one (it comes second, LTR)", () => {
        const result = sortAndMergeSelections([createSelection(0, 4, 0, 0), createSelection(0, 2, 0, 7)]);
        expect(shape(result[0])).toEqual([0, 0, 0, 7]);
    });

    it("direction is inherited from the later-added one when it is reversed too", () => {
        const result = sortAndMergeSelections([createSelection(0, 0, 0, 4), createSelection(0, 7, 0, 2)]);
        expect(shape(result[0])).toEqual([0, 7, 0, 0]);
    });

    it("the later-added one wins regardless of document position", () => {
        const result = sortAndMergeSelections([createSelection(0, 3, 0, 7), createSelection(0, 5, 0, 1)]);
        expect(shape(result[0])).toEqual([0, 7, 0, 1]);
    });

    it("idealColumn carries over when the winner's active did not move", () => {
        const winner = createSelection(0, 2, 0, 7, 42);
        const result = sortAndMergeSelections([createSelection(0, 0, 0, 4), winner]);
        expect(result[0].idealColumn).toBe(42);
    });

    it("idealColumn resets when the winner's active moved", () => {
        const winner = createSelection(0, 5, 0, 2, 42);
        const result = sortAndMergeSelections([createSelection(0, 0, 0, 4), winner]);
        expect(shape(result[0])).toEqual([0, 5, 0, 0]);
        expect(result[0].idealColumn).toBeUndefined();
    });

    it("the cascade keeps the winner's age: the third selection is compared with it", () => {
        const result = sortAndMergeSelections([
            createSelection(0, 0, 0, 3),
            createSelection(0, 6, 0, 2, 11),
            createSelection(0, 4, 0, 5),
        ]);
        expect(result).toHaveLength(1);
        // The union's age comes from the first pair's winner (index 1); index 2 is newer, so the
        // direction is taken from it (forward) and the winner's idealColumn is not carried over.
        expect(shape(result[0])).toEqual([0, 0, 0, 6]);
        expect(result[0].idealColumn).toBeUndefined();
    });
});
