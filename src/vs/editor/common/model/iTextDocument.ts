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

/** Lines are 0-based. */
export interface ITextDocument {
    readonly lineCount: number;
    readonly versionId: number;
    /** Upstream's alternative version: undo/redo bring back the value of the state they restore (`TextDocument`). */
    readonly alternativeVersionId: number;
    /** At the current `versionId` or the one before the last bump — where an undo element just pushed started. */
    alternativeVersionIdAt(versionId: number): number;
    readonly languageId: string;

    /** Only for {@link serialize}: lines are stored LF-canonical. */
    readonly eol: EndOfLine;

    getLineContent(lineIndex: number): string;
    getLineLength(lineIndex: number): number;
    getText(): string;
    /** `getText().length` without building the text (the piece tree knows its length). */
    getValueLength(): number;
    setText(text: string): void;
    getTextInRange(range: IRange): string;

    serialize(): string;
    /** Changes no lines; bumps `versionId` but not `alternativeVersionId`. */
    setEol(eol: EndOfLine): void;

    applyEdits(edits: readonly ITextEdit[]): IApplyEditsResult;

    /**
     * {@link applyEdits} moves decorations before firing its events; {@link setText} carries
     * no edits, so ranges stay in place, clamped to the new text.
     */
    deltaDecorations(oldIds: readonly string[], newDecorations: readonly IModelDeltaDecoration[]): string[];
    getDecorationRange(id: string): IRange | null;

    /** Leaves `versionId` alone: a language change does not make the document dirty. */
    setLanguage(languageId: string): void;

    /**
     * {@link applyEdits} of the undo stack: the batch's event says where it came from, and `alternativeVersionId`
     * is the restored state's, set before the events.
     */
    applyUndoRedoEdits(
        edits: readonly ITextEdit[],
        origin: "undo" | "redo",
        alternativeVersionId: number,
    ): IApplyEditsResult;

    /** Several changes from one `applyEdits` fire one by one, in document order. */
    onDidChangeContent(listener: (change: IDocumentContentChange) => void): IDisposable;

    /** After every {@link onDidChangeContent} of the same batch. */
    onDidChangeModelContent(listener: (event: IModelContentChangedEvent) => void): IDisposable;

    onDidChangeLanguage(listener: (change: IDocumentLanguageChange) => void): IDisposable;

    /** An EOL change does not show up in {@link onDidChangeContent}. */
    onDidChangeEol(listener: () => void): IDisposable;
}
