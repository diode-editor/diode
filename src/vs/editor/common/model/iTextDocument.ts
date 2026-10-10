import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { EndOfLine } from "../core/endOfLine.ts";
import type { IRange } from "../core/iRange.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";

import type { IDocumentContentChange, IModelContentChangedEvent } from "./iDocumentContentChange.ts";
import type { IDocumentLanguageChange } from "./iDocumentLanguageChange.ts";
import type { IModelDeltaDecoration } from "./trackedDecorations.ts";

export interface IApplyEditsResult {
    readonly appliedVersion: number;
    readonly inverseEdits: readonly ITextEdit[];
}

/**
 * Read/write interface for a text document.
 * Line indices are 0-based.
 *
 * Token storage is intentionally NOT part of this interface; tokens live in
 * a separate per-document cache that subscribes to {@link onDidChangeContent}.
 */
export interface ITextDocument {
    readonly lineCount: number;
    readonly versionId: number;
    /** Language id документа (VS Code-стиль: `typescript`, `markdown`, …). */
    readonly languageId: string;

    /**
     * End-of-line sequence used when the document is serialized to disk.
     * Line content is always stored LF-canonical; this is a separate axis
     * applied only by {@link serialize}.
     */
    readonly eol: EndOfLine;

    getLineContent(lineIndex: number): string;
    getLineLength(lineIndex: number): number;
    /** Returns the full text with LF line separators (internal canonical form). */
    getText(): string;
    setText(text: string): void;
    getTextInRange(range: IRange): string;

    /** Returns the full text joined with the document's {@link eol} — for writing to disk. */
    serialize(): string;
    /** Changes the {@link eol} axis. No-op при совпадении. Does not alter line content or bump versionId. */
    setEol(eol: EndOfLine): void;

    applyEdits(edits: readonly ITextEdit[]): IApplyEditsResult;

    /**
     * Декорации, которые едут вместе с текстом (upstream `deltaDecorations`):
     * снимает `oldIds`, добавляет `newDecorations` (диапазоны приводятся к
     * документу) и возвращает их id. Каждая правка {@link applyEdits} сдвигает
     * их до своих событий по правилам `stickiness`; {@link setText} правок не
     * несёт — диапазоны остаются на месте, приведённые к новому тексту.
     */
    deltaDecorations(oldIds: readonly string[], newDecorations: readonly IModelDeltaDecoration[]): string[];
    /** Текущий диапазон декорации; `null` — снята. */
    getDecorationRange(id: string): IRange | null;

    /**
     * Меняет язык документа. No-op при совпадении с текущим. Не меняет
     * `versionId` — смена языка не делает документ dirty.
     */
    setLanguage(languageId: string): void;

    /**
     * Notifies of any structural change (applyEdits / setText). Multiple
     * changes from a single `applyEdits` call are emitted one after another
     * in document order.
     */
    onDidChangeContent(listener: (change: IDocumentContentChange) => void): IDisposable;

    /**
     * Одно батч-событие на `applyEdits`/`setText` с точными правками — после
     * всех событий {@link onDidChangeContent} того же батча. Для зеркал
     * документа (синхронизация с extension host'ом), которым мало границ строк.
     */
    onDidChangeModelContent(listener: (event: IModelContentChangedEvent) => void): IDisposable;

    /** Notifies of a language change made via {@link setLanguage}. */
    onDidChangeLanguage(listener: (change: IDocumentLanguageChange) => void): IDisposable;

    /**
     * Notifies of an {@link eol} change made via {@link setEol} (в том числе
     * из undo/redo). Смена EOL не является структурным изменением текста и
     * поэтому не попадает в {@link onDidChangeContent}.
     */
    onDidChangeEol(listener: () => void): IDisposable;
}
