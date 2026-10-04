import type { EndOfLine } from "../core/endOfLine.ts";
import type { IRange } from "../core/iRange.ts";

/**
 * Description of a single content change applied to {@link ITextDocument}.
 *
 * Coordinates are in *pre-edit* logical line space. After the change, the
 * logical line range `[startLine .. oldEndLine]` is replaced with new content
 * spanning `[startLine .. newEndLine]`. `lineDelta = newEndLine - oldEndLine`.
 *
 * Token caches and similar derived data live outside the document and listen
 * to these events to invalidate / shift their entries (see DocumentTokenStore).
 */
export interface IDocumentContentChange {
    readonly startLine: number;
    readonly oldEndLine: number;
    readonly newEndLine: number;
    /**
     * Содержимое заменено целиком ({@link ITextDocument.setText}: перечитка с
     * диска, смена содержимого владельцем) — upstream `isFlush`. Документ тот
     * же, но всё, что выводилось из прежнего текста (детект отступа, фолды),
     * пора вывести заново.
     */
    readonly isFlush?: boolean;
}

/**
 * Одна правка батча {@link IModelContentChangedEvent}: диапазон в координатах
 * документа ДО этой правки и вставленный текст как есть (модель режет его на
 * строки по `\n` — зеркало обязано так же). Порядок в батче —
 * порядок применения (снизу вверх, по убыванию позиций): последовательное
 * применение правок к копии строк до батча даёт текст после него — как
 * `IModelContentChange` эталона (`mirrorTextModel.ts`).
 */
export interface IModelContentChange {
    readonly range: IRange;
    readonly text: string;
}

/**
 * Батч-событие изменения содержимого: одно на `applyEdits`/`setText`, уже
 * после применения всех правок. Несёт точные правки — их зеркалирует
 * синхронизация документов с extension host'ом (`$acceptModelChanged`
 * эталона), построчному {@link IDocumentContentChange} их не хватает.
 */
export interface IModelContentChangedEvent {
    /** Правки батча; у `isFlush` пусто — содержимое перечитывается целиком. */
    readonly changes: readonly IModelContentChange[];
    /** Версия документа после батча. */
    readonly versionId: number;
    readonly eol: EndOfLine;
    /** Содержимое заменено целиком (`setText`). */
    readonly isFlush: boolean;
}
