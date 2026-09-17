/**
 * Разносит индексы fuzzy-совпадения по относительному пути (`dir/name`) на
 * диапазоны подсветки лейбла (имя файла) и описания (каталог): индексы до
 * `basenameOffset` — каталог, остальные — имя, пересчитанные в локальный
 * оффсет лейбла. Соседние индексы склеиваются в один диапазон, чтобы подряд
 * совпавшие буквы подсвечивались сплошняком, а не по одной.
 *
 * Общая для файлового пикера ({@link import("./filesQuickAccessProvider.ts").FilesQuickAccessProvider})
 * и пикера открытых редакторов
 * ({@link import("./openEditorsQuickAccessProvider.ts").OpenEditorsQuickAccessProvider}):
 * списки разные, а раскладка строки «имя + путь-описание» одна.
 */
export function splitPathMatchRanges(
    matchedIndices: readonly number[],
    basenameOffset: number,
): { labelRanges: [number, number][]; descriptionRanges: [number, number][] } {
    const labelRanges: [number, number][] = [];
    const descriptionRanges: [number, number][] = [];

    for (const index of matchedIndices) {
        const inLabel = index >= basenameOffset;
        const ranges = inLabel ? labelRanges : descriptionRanges;
        const position = inLabel ? index - basenameOffset : index;
        const last = ranges.at(-1);
        // Индексы приходят по возрастанию (fuzzy идёт слева направо), поэтому
        // продлить хвостовой диапазон достаточно — искать среди прежних незачем.
        if (last?.[1] === position) last[1]++;
        else ranges.push([position, position + 1]);
    }

    return { labelRanges, descriptionRanges };
}
