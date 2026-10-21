import type { DetailedLineRangeMapping } from "./rangeMapping.ts";
import { LineRangeMapping } from "./rangeMapping.ts";

/**
 * **Модель не знает о тексте — только о номерах строк**, контент достаёт рендер:
 * так превью правки одной строки в стомегабайтном файле стоит столько же, сколько
 * в маленьком. Алгоритм upstream `diffEditorViewModel.ts`, без его `observable`.
 */

export type IDiffViewRow =
    | { readonly kind: "unchanged"; readonly originalLine: number; readonly modifiedLine: number }
    | { readonly kind: "deleted"; readonly originalLine: number }
    | { readonly kind: "added"; readonly modifiedLine: number }
    | { readonly kind: "collapsed"; readonly hiddenLineCount: number; readonly regionIndex: number };

/** Номера строк 0-based. */
export interface IUnchangedRegion {
    readonly originalStartLine: number;
    readonly modifiedStartLine: number;
    /** Включая уже раскрытые. */
    readonly lineCount: number;
    readonly visibleTop: number;
    readonly visibleBottom: number;
    readonly hiddenLineCount: number;
}

export interface IDiffViewOptions {
    readonly hideUnchangedRegions: boolean;
    readonly contextLineCount: number;
    readonly minimumHiddenLineCount: number;
    readonly revealLineCount: number;
}

/** Как `diffEditorDefaultOptions.hideUnchangedRegions` в upstream. */
export const DEFAULT_DIFF_VIEW_OPTIONS: IDiffViewOptions = {
    hideUnchangedRegions: false,
    contextLineCount: 3,
    minimumHiddenLineCount: 3,
    revealLineCount: 20,
};

/** Внутри модели номера строк 1-based, как в `LineRange`. */
interface IRegionState {
    originalLineNumber: number;
    modifiedLineNumber: number;
    lineCount: number;
    visibleTop: number;
    visibleBottom: number;
}

export class DiffViewModel {
    private readonly changes: readonly DetailedLineRangeMapping[];
    private readonly originalLineCount: number;
    private readonly modifiedLineCount: number;
    private readonly options: IDiffViewOptions;
    private readonly regionStates: IRegionState[];
    private rowsCache: readonly IDiffViewRow[] | null = null;

    public constructor(
        changes: readonly DetailedLineRangeMapping[],
        originalLineCount: number,
        modifiedLineCount: number,
        options: Partial<IDiffViewOptions> = {},
    ) {
        this.changes = changes;
        this.originalLineCount = originalLineCount;
        this.modifiedLineCount = modifiedLineCount;
        this.options = { ...DEFAULT_DIFF_VIEW_OPTIONS, ...options };
        this.regionStates = this.options.hideUnchangedRegions ? this.computeRegions() : [];
    }

    public get rows(): readonly IDiffViewRow[] {
        this.rowsCache ??= this.buildRows();
        return this.rowsCache;
    }

    public get regions(): readonly IUnchangedRegion[] {
        return this.regionStates.map((state) => ({
            originalStartLine: state.originalLineNumber - 1,
            modifiedStartLine: state.modifiedLineNumber - 1,
            lineCount: state.lineCount,
            visibleTop: state.visibleTop,
            visibleBottom: state.visibleBottom,
            hiddenLineCount: hiddenOf(state),
        }));
    }

    /** Без `from` — целиком. */
    public expandRegion(index: number, from?: "top" | "bottom", lineCount?: number): void {
        const state = this.regionStates.at(index);
        if (state === undefined || index < 0) return;

        if (from === undefined) {
            state.visibleTop = state.lineCount;
            state.visibleBottom = 0;
        } else {
            const step = Math.max(0, lineCount ?? this.options.revealLineCount);
            if (from === "top") {
                state.visibleTop = Math.min(state.visibleTop + step, state.lineCount - state.visibleBottom);
            } else {
                state.visibleBottom = Math.min(state.visibleBottom + step, state.lineCount - state.visibleTop);
            }
        }
        this.rowsCache = null;
    }

    public expandAll(): void {
        for (let i = 0; i < this.regionStates.length; i++) this.expandRegion(i);
    }

    /** Портированный `UnchangedRegion.fromDiffs` из upstream. */
    private computeRegions(): IRegionState[] {
        const { contextLineCount: context, minimumHiddenLineCount: minHidden } = this.options;
        const result: IRegionState[] = [];

        for (const gap of LineRangeMapping.inverse(this.changes, this.originalLineCount, this.modifiedLineCount)) {
            let originalLineNumber = gap.original.startLineNumber;
            let modifiedLineNumber = gap.modified.startLineNumber;
            let lineCount = gap.original.length;

            const atStart = originalLineNumber === 1 && modifiedLineNumber === 1;
            const atEnd =
                originalLineNumber + lineCount === this.originalLineCount + 1 &&
                modifiedLineNumber + lineCount === this.modifiedLineCount + 1;

            if ((atStart || atEnd) && lineCount >= context + minHidden) {
                // У края файла контекст нужен только с внутренней стороны.
                if (atStart && !atEnd) lineCount -= context;
                if (atEnd && !atStart) {
                    originalLineNumber += context;
                    modifiedLineNumber += context;
                    lineCount -= context;
                }
            } else if (lineCount >= context * 2 + minHidden) {
                originalLineNumber += context;
                modifiedLineNumber += context;
                lineCount -= context * 2;
            } else {
                continue;
            }

            result.push({ originalLineNumber, modifiedLineNumber, lineCount, visibleTop: 0, visibleBottom: 0 });
        }

        return result;
    }

    private buildRows(): IDiffViewRow[] {
        const rows: IDiffViewRow[] = [];
        let originalLine = 1;
        let modifiedLine = 1;
        let regionIndex = 0;

        const emitGap = (length: number): void => {
            // Промежуток неизменённый, поэтому его длина одинакова с обеих сторон.
            const region = this.regionStates.at(regionIndex);
            const covered =
                region !== undefined &&
                region.originalLineNumber >= originalLine &&
                region.originalLineNumber + region.lineCount <= originalLine + length;

            if (!covered) {
                this.emitUnchanged(rows, originalLine, modifiedLine, length);
                return;
            }

            const leadingContext = region.originalLineNumber - originalLine;
            this.emitUnchanged(rows, originalLine, modifiedLine, leadingContext);

            const offset = leadingContext;
            this.emitUnchanged(rows, originalLine + offset, modifiedLine + offset, region.visibleTop);

            const hidden = hiddenOf(region);
            if (hidden > 0) rows.push({ kind: "collapsed", hiddenLineCount: hidden, regionIndex });

            const bottomOffset = offset + region.lineCount - region.visibleBottom;
            this.emitUnchanged(rows, originalLine + bottomOffset, modifiedLine + bottomOffset, region.visibleBottom);

            const trailingStart = offset + region.lineCount;
            this.emitUnchanged(
                rows,
                originalLine + trailingStart,
                modifiedLine + trailingStart,
                length - trailingStart,
            );
            regionIndex++;
        };

        for (const change of this.changes) {
            emitGap(change.original.startLineNumber - originalLine);
            originalLine = change.original.startLineNumber;
            modifiedLine = change.modified.startLineNumber;

            for (let i = 0; i < change.original.length; i++) {
                rows.push({ kind: "deleted", originalLine: originalLine + i - 1 });
            }
            for (let i = 0; i < change.modified.length; i++) {
                rows.push({ kind: "added", modifiedLine: modifiedLine + i - 1 });
            }

            originalLine = change.original.endLineNumberExclusive;
            modifiedLine = change.modified.endLineNumberExclusive;
        }

        emitGap(this.originalLineCount + 1 - originalLine);
        return rows;
    }

    private emitUnchanged(rows: IDiffViewRow[], originalLine: number, modifiedLine: number, length: number): void {
        for (let i = 0; i < length; i++) {
            rows.push({ kind: "unchanged", originalLine: originalLine + i - 1, modifiedLine: modifiedLine + i - 1 });
        }
    }
}

function hiddenOf(state: IRegionState): number {
    return state.lineCount - state.visibleTop - state.visibleBottom;
}
