import type { DetailedLineRangeMapping } from "./rangeMapping.ts";
import type { DiffSide } from "./diffSide.ts";

/**
 * Посимвольные (intra-line) диапазоны изменений по строкам обеих сторон —
 * проекция `innerChanges` движка на вид «строка → список отрезков офсетов».
 *
 * Движок отдаёт `RangeMapping[]` в геометрии upstream (1-based строки и
 * колонки, диапазон может накрывать несколько строк); рендеру нужны 0-based
 * отрезки в пределах одной строки. Конверсия — только здесь, как это уже
 * сделано для гуттера в `quickDiffDecorations.ts`.
 */

/** Отрезок изменения внутри строки: офсеты символов, `end` эксклюзивный. */
export interface ICharSpan {
    readonly start: number;
    /** `Number.MAX_SAFE_INTEGER` = до конца строки (рендер клампит по длине). */
    readonly end: number;
}

export class DiffInnerRanges {
    private readonly spans: Record<DiffSide, Map<number, ICharSpan[]>> = {
        original: new Map(),
        modified: new Map(),
    };

    public constructor(changes: readonly DetailedLineRangeMapping[]) {
        for (const change of changes) {
            for (const inner of change.innerChanges ?? []) {
                this.add("original", inner.originalRange);
                this.add("modified", inner.modifiedRange);
            }
        }
    }

    /** Диапазоны intra-line изменения строки `line` (0-based); пусто — красить нечего. */
    public get(side: DiffSide, line: number): readonly ICharSpan[] {
        return this.spans[side].get(line) ?? [];
    }

    /** Режет upstream-`Range` по строкам и складывает 0-based отрезки. */
    private add(
        side: DiffSide,
        range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number },
    ): void {
        for (let lineNumber = range.startLineNumber; lineNumber <= range.endLineNumber; lineNumber++) {
            const start = lineNumber === range.startLineNumber ? range.startColumn - 1 : 0;
            const end = lineNumber === range.endLineNumber ? range.endColumn - 1 : Number.MAX_SAFE_INTEGER;
            // Пустой отрезок — точка вставки (или перенос строки на границе
            // многострочного диапазона): красить нечего.
            if (end <= start) continue;
            const line = lineNumber - 1;
            const spans = this.spans[side].get(line);
            if (spans === undefined) this.spans[side].set(line, [{ start, end }]);
            else spans.push({ start, end });
        }
    }
}
