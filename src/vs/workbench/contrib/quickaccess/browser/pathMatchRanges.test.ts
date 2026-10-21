import { describe, expect, it } from "vitest";

import { splitPathMatchRanges, toMatchRanges } from "./pathMatchRanges.ts";

// "src/app.ts": basename "app.ts" starts at index 4.
const BASENAME_OFFSET = 4;

describe("splitPathMatchRanges", () => {
    it("a match entirely in the file name goes to the label with a local offset", () => {
        expect(splitPathMatchRanges([4, 5, 6], BASENAME_OFFSET)).toEqual({
            labelRanges: [[0, 3]],
            descriptionRanges: [],
        });
    });

    it("a match entirely in the directory goes to the description as is", () => {
        expect(splitPathMatchRanges([0, 1, 2], BASENAME_OFFSET)).toEqual({
            labelRanges: [],
            descriptionRanges: [[0, 3]],
        });
    });

    it("a match across the boundary is split between both columns", () => {
        expect(splitPathMatchRanges([2, 3, 4], BASENAME_OFFSET)).toEqual({
            labelRanges: [[0, 1]],
            descriptionRanges: [[2, 4]],
        });
    });

    it("gaps yield separate ranges, adjacent indices are merged", () => {
        expect(splitPathMatchRanges([4, 5, 8], BASENAME_OFFSET)).toEqual({
            labelRanges: [
                [0, 2],
                [4, 5],
            ],
            descriptionRanges: [],
        });
    });

    it("no matches — no ranges", () => {
        expect(splitPathMatchRanges([], BASENAME_OFFSET)).toEqual({ labelRanges: [], descriptionRanges: [] });
    });

    it("no description (offset 0) — everything goes to the label", () => {
        expect(splitPathMatchRanges([0, 1], 0)).toEqual({ labelRanges: [[0, 2]], descriptionRanges: [] });
    });
});

describe("splitPathMatchRanges — multi-term query", () => {
    it("parts from different halves each stay in their own column", () => {
        expect(splitPathMatchRanges([0, 1, 2, 4, 5, 6, 7, 8], 4)).toEqual({
            labelRanges: [[0, 5]],
            descriptionRanges: [[0, 3]],
        });
    });

    it("two parts inside the label are two ranges, not one solid range", () => {
        expect(splitPathMatchRanges([4, 5, 6, 10, 11], 4)).toEqual({
            labelRanges: [
                [0, 3],
                [6, 8],
            ],
            descriptionRanges: [],
        });
    });

    it("two parts inside the description are two ranges", () => {
        expect(splitPathMatchRanges([0, 1, 3], 4)).toEqual({
            labelRanges: [],
            descriptionRanges: [
                [0, 2],
                [3, 4],
            ],
        });
    });

    it("the label range is not extended by the description's head at the seam", () => {
        // Index 3 is the directory's last char, 4 the name's first: after
        // remapping they become positions 3 and 0 and must not merge.
        expect(splitPathMatchRanges([3, 4], 4)).toEqual({
            labelRanges: [[0, 1]],
            descriptionRanges: [[3, 4]],
        });
    });
});

describe("toMatchRanges", () => {
    it("an empty index set yields an empty range list", () => {
        expect(toMatchRanges([])).toEqual([]);
    });

    it("a single index yields a one-position range", () => {
        expect(toMatchRanges([2])).toEqual([[2, 3]]);
    });

    it("adjacent indices merge into one range", () => {
        expect(toMatchRanges([0, 1, 2])).toEqual([[0, 3]]);
    });

    it("a gap starts a new range", () => {
        expect(toMatchRanges([0, 1, 5, 6])).toEqual([
            [0, 2],
            [5, 7],
        ]);
    });

    it("ranges go left to right, in index order", () => {
        expect(toMatchRanges([1, 4, 9])).toEqual([
            [1, 2],
            [4, 5],
            [9, 10],
        ]);
    });
});
