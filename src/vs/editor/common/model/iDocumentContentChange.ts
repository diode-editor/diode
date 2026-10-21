import type { EndOfLine } from "../core/endOfLine.ts";
import type { IRange } from "../core/iRange.ts";

/** `[startLine .. oldEndLine]` в координатах ДО правки заменено на `[startLine .. newEndLine]`. */
export interface IDocumentContentChange {
    readonly startLine: number;
    readonly oldEndLine: number;
    readonly newEndLine: number;
    /** Документ тот же, но выведенное из прежнего текста (отступ, фолды) пора вывести заново. */
    readonly isFlush?: boolean;
}

/**
 * Диапазон — в координатах ДО этой правки; текст модель режет по `\n`, зеркало
 * обязано так же. Порядок в батче — порядок применения (по убыванию позиций).
 */
export interface IModelContentChange {
    readonly range: IRange;
    readonly text: string;
}

export interface IModelContentChangedEvent {
    /** У `isFlush` пусто. */
    readonly changes: readonly IModelContentChange[];
    readonly versionId: number;
    readonly eol: EndOfLine;
    readonly isFlush: boolean;
}
