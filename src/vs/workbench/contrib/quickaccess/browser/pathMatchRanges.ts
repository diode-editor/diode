/**
 * Склеивает индексы совпадения в диапазоны подсветки `[начало, конец)`:
 * соседние индексы попадают в один диапазон, чтобы подряд совпавшие буквы
 * подсвечивались сплошняком, а не по одной.
 *
 * Индексы обязаны приходить возрастающими и без повторов — именно такой набор
 * отдаёт fuzzy-матчер (в том числе `fuzzyMatchPrepared`, который сводит воедино
 * наборы отдельных термов), поэтому продлить хвостовой диапазон достаточно:
 * искать среди прежних незачем.
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

/**
 * Разносит индексы fuzzy-совпадения по относительному пути (`dir/name`) на
 * диапазоны подсветки лейбла (имя файла) и описания (каталог): индексы до
 * `basenameOffset` — каталог, остальные — имя, пересчитанные в локальный
 * оффсет лейбла.
 *
 * Общая для файлового пикера ({@link import("./filesQuickAccessProvider.ts").FilesQuickAccessProvider})
 * и пикера открытых редакторов
 * ({@link import("./openEditorsQuickAccessProvider.ts").OpenEditorsQuickAccessProvider}):
 * списки разные, а раскладка строки «имя + путь-описание» одна.
 *
 * Запрос из нескольких термов приносит несколько разрозненных кусков индексов —
 * каждый остаётся своим диапазоном в своей половине строки, склейки в один
 * сплошной диапазон не происходит.
 */
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
