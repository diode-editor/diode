import type { DiffSide } from "./diffSide.ts";
import type { DetailedLineRangeMapping } from "./rangeMapping.ts";

/**
 * Движок отдаёт `innerChanges` 1-based и многострочными; рендеру нужны 0-based
 * отрезки в пределах одной строки. Конверсия — только здесь.
 */

/** `end` эксклюзивный. */
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

    /** `line` 0-based. */
    public get(side: DiffSide, line: number): readonly ICharSpan[] {
        return this.spans[side].get(line) ?? [];
    }

    private add(
        side: DiffSide,
        range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number },
    ): void {
        for (let lineNumber = range.startLineNumber; lineNumber <= range.endLineNumber; lineNumber++) {
            const start = lineNumber === range.startLineNumber ? range.startColumn - 1 : 0;
            const end = lineNumber === range.endLineNumber ? range.endColumn - 1 : Number.MAX_SAFE_INTEGER;
            // Пустой отрезок — точка вставки или перенос на границе многострочного диапазона.
            if (end <= start) continue;
            const line = lineNumber - 1;
            const spans = this.spans[side].get(line);
            if (spans === undefined) this.spans[side].set(line, [{ start, end }]);
            else spans.push({ start, end });
        }
    }
}
