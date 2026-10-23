import type { IFoldingRegion } from "./iFoldingRegion.ts";

/** Upstream `MAX_FOLDING_REGIONS_FOR_INDENT_DEFAULT`, the default of `editor.foldingMaximumRegions`. */
export const FOLDING_MAXIMUM_REGIONS_DEFAULT = 5000;

/** Upstream counts the first 30 nesting levels; anything deeper is dropped first once over the limit. */
const COUNTED_NESTING_LEVELS = 30;

/**
 * Upstream `RangesCollector.toIndentRanges` (syntaxRangeProvider): over the limit, the shallowest
 * regions survive — whole nesting levels while they fit, then the first regions, in document order,
 * of the level that does not. `regions` are sorted by `startLine`; the input is returned as is when
 * it fits, so a recompute that found nothing to cut allocates nothing.
 */
export function limitFoldingRegions(regions: IFoldingRegion[], limit: number): IFoldingRegion[] {
    if (regions.length <= limit) return regions;

    const levels: number[] = [];
    const levelCounts: number[] = [];
    const open: IFoldingRegion[] = [];
    for (const region of regions) {
        // A region starting on the last line of another is nested in it (its header is an indented line).
        while (open.length > 0 && open[open.length - 1].endLine < region.startLine) open.pop();
        const level = open.length;
        levels.push(level);
        if (level < COUNTED_NESTING_LEVELS) levelCounts[level] = (levelCounts[level] ?? 0) + 1;
        open.push(region);
    }

    // Levels are dense: a region at level N opens on top of N regions, which were counted at 0..N-1.
    let entries = 0;
    let maxLevel = levelCounts.length;
    for (const [level, count] of levelCounts.entries()) {
        // Stryker disable next-line EqualityOperator: a level that fills the limit exactly is taken whole either way — as a fitting level here or, as the first partial one, region by region below
        if (count + entries > limit) {
            maxLevel = level;
            break;
        }
        entries += count;
    }

    const result: IFoldingRegion[] = [];
    for (const [i, region] of regions.entries()) {
        const level = levels[i];
        if (level < maxLevel || (level === maxLevel && entries++ < limit)) result.push(region);
    }
    return result;
}
