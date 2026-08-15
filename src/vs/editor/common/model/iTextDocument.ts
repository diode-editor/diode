import type { IDisposable } from "@tuidom/core/common/disposable";
import type { EndOfLine } from "../core/endOfLine.ts";
import type { IRange } from "../core/iRange.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";

import type { IDocumentContentChange } from "./iDocumentContentChange.ts";
import type { IDocumentLanguageChange } from "./iDocumentLanguageChange.ts";

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

    /** Notifies of a language change made via {@link setLanguage}. */
    onDidChangeLanguage(listener: (change: IDocumentLanguageChange) => void): IDisposable;

    /**
     * Notifies of an {@link eol} change made via {@link setEol} (в том числе
     * из undo/redo). Смена EOL не является структурным изменением текста и
     * поэтому не попадает в {@link onDidChangeContent}.
     */
    onDidChangeEol(listener: () => void): IDisposable;
}
