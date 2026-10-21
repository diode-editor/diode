/**
 * `[start, end)`. Indices arrive ascending and without duplicates (that's what the fuzzy matcher
 * yields), so extending the trailing range is enough.
 */
export function toMatchRanges(matchedIndices: readonly number[]): [number, number][] {
    const ranges: [number, number][] = [];
    for (const index of matchedIndices) {
        const last = ranges.at(-1);
        if (last?.[1] === index) last[1]++;
        else ranges.push([index, index + 1]);
    }
    return ranges;
}

/** Indices before `basenameOffset` are the directory (description); the rest are the name (label), at its local offset. */
export function splitPathMatchRanges(
    matchedIndices: readonly number[],
    basenameOffset: number,
): { labelRanges: [number, number][]; descriptionRanges: [number, number][] } {
    const labelIndices: number[] = [];
    const descriptionIndices: number[] = [];

    for (const index of matchedIndices) {
        if (index >= basenameOffset) labelIndices.push(index - basenameOffset);
        else descriptionIndices.push(index);
    }

    return { labelRanges: toMatchRanges(labelIndices), descriptionRanges: toMatchRanges(descriptionIndices) };
}
