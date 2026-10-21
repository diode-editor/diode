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

/** Строки 0-based. */
export interface ITextDocument {
    readonly lineCount: number;
    readonly versionId: number;
    readonly languageId: string;

    /** Только для {@link serialize}: строки хранятся LF-канонично. */
    readonly eol: EndOfLine;

    getLineContent(lineIndex: number): string;
    getLineLength(lineIndex: number): number;
    getText(): string;
    setText(text: string): void;
    getTextInRange(range: IRange): string;

    serialize(): string;
    /** Не меняет строки и `versionId`. */
    setEol(eol: EndOfLine): void;

    applyEdits(edits: readonly ITextEdit[]): IApplyEditsResult;

    /**
     * {@link applyEdits} сдвигает декорации до своих событий; {@link setText} правок
     * не несёт — диапазоны остаются на месте, приведённые к новому тексту.
     */
    deltaDecorations(oldIds: readonly string[], newDecorations: readonly IModelDeltaDecoration[]): string[];
    getDecorationRange(id: string): IRange | null;

    /** Не меняет `versionId` — смена языка не делает документ dirty. */
    setLanguage(languageId: string): void;

    /** Несколько изменений одного `applyEdits` — по очереди, в документном порядке. */
    onDidChangeContent(listener: (change: IDocumentContentChange) => void): IDisposable;

    /** После всех {@link onDidChangeContent} того же батча. */
    onDidChangeModelContent(listener: (event: IModelContentChangedEvent) => void): IDisposable;

    onDidChangeLanguage(listener: (change: IDocumentLanguageChange) => void): IDisposable;

    /** Смена EOL в {@link onDidChangeContent} не попадает. */
    onDidChangeEol(listener: () => void): IDisposable;
}
