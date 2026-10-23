import { describe, expect, it } from "vitest";

import { FOLDING_MAXIMUM_REGIONS_DEFAULT, limitFoldingRegions } from "./foldingRegionsLimit.ts";
import { createFoldingRegion, type IFoldingRegion } from "./iFoldingRegion.ts";

function region(startLine: number, endLine: number): IFoldingRegion {
    return createFoldingRegion(startLine, endLine);
}

function spans(regions: IFoldingRegion[]): [number, number][] {
    return regions.map((r) => [r.startLine, r.endLine]);
}

describe("limitFoldingRegions", () => {
    it("the upstream default is 5000", () => {
        expect(FOLDING_MAXIMUM_REGIONS_DEFAULT).toBe(5000);
    });

    it("returns the same array when it fits, including exactly at the limit", () => {
        const regions = [region(0, 5), region(1, 2), region(6, 9)];
        expect(limitFoldingRegions(regions, 3)).toBe(regions);
        expect(limitFoldingRegions(regions, 4)).toBe(regions);
        expect(limitFoldingRegions([], 10)).toEqual([]);
    });

    it("drops the deepest nesting level first", () => {
        // Two top-level blocks, each with a nested one, each of those with a deeper one.
        const regions = [region(0, 9), region(1, 4), region(2, 3), region(10, 19), region(11, 14), region(12, 13)];
        expect(spans(limitFoldingRegions(regions, 4))).toEqual([
            [0, 9],
            [1, 4],
            [10, 19],
            [11, 14],
        ]);
        expect(spans(limitFoldingRegions(regions, 2))).toEqual([
            [0, 9],
            [10, 19],
        ]);
    });

    it("the level that does not fit whole contributes its first regions, in document order", () => {
        const regions = [region(0, 9), region(1, 2), region(3, 4), region(5, 6), region(10, 19), region(11, 12)];
        // Level 0 (two regions) fits; level 1 has four, only two more fit.
        expect(spans(limitFoldingRegions(regions, 4))).toEqual([
            [0, 9],
            [1, 2],
            [3, 4],
            [10, 19],
        ]);
    });

    it("a region starting on the last line of another counts as nested in it", () => {
        // Line 5 is both the last body line of 0..5 and the header of 5..7 (an indented header).
        const regions = [region(0, 5), region(5, 7), region(8, 9)];
        expect(spans(limitFoldingRegions(regions, 2))).toEqual([
            [0, 5],
            [8, 9],
        ]);
    });

    it("siblings after a closed region are back at the parent's level", () => {
        const regions = [region(0, 3), region(1, 2), region(4, 7), region(5, 6)];
        expect(spans(limitFoldingRegions(regions, 3))).toEqual([
            [0, 3],
            [1, 2],
            [4, 7],
        ]);
    });

    it("keeps exactly `limit` regions of a flat list", () => {
        const regions = Array.from({ length: 10 }, (_, i) => region(i * 2, i * 2 + 1));
        const limited = limitFoldingRegions(regions, 7);
        expect(limited).toHaveLength(7);
        expect(spans(limited)).toEqual(spans(regions.slice(0, 7)));
    });

    it("levels deeper than the 30 counted ones are dropped once over the limit", () => {
        // A chain of 33 nested regions, limit 32: only the counted levels 0..29 are "fitting levels"
        // (30 regions); level 30, the first uncounted one, gets a slot region by region, 31 and 32 go —
        // even though 32 of the 33 would fit by count alone.
        const chain = Array.from({ length: 33 }, (_, i) => region(i, 100 - i));
        const limited = limitFoldingRegions(chain, 32);
        expect(limited).toHaveLength(31);
        expect(spans(limited)).toEqual(spans(chain.slice(0, 31)));
    });

    it("when even the top level does not fit, nested regions are not taken in its place", () => {
        const regions = [region(0, 9), region(1, 2), region(10, 19), region(20, 29)];
        expect(spans(limitFoldingRegions(regions, 2))).toEqual([
            [0, 9],
            [10, 19],
        ]);
    });
});
