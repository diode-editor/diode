/**
 * `[начало, конец)`. Индексы приходят возрастающими и без повторов (так отдаёт fuzzy-матчер),
 * поэтому достаточно продлевать хвостовой диапазон.
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

/** Индексы до `basenameOffset` — каталог (описание), остальные — имя (лейбл) в его локальном оффсете. */
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
