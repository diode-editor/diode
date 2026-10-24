import type { EndOfLine } from "../core/endOfLine.ts";
import type { IRange } from "../core/iRange.ts";

/** `[startLine .. oldEndLine]` in coordinates BEFORE the edit is replaced by `[startLine .. newEndLine]`. */
export interface IDocumentContentChange {
    readonly startLine: number;
    readonly oldEndLine: number;
    readonly newEndLine: number;
    /** Same document, but anything derived from the old text (indentation, folds) must be re-derived. */
    readonly isFlush?: boolean;
    /**
     * Lines appended by the background pass of a document on disk (its index being built, docs/arch/Editor.md):
     * not an edit, the version did not move, and a navigation target past the old end may now be reachable.
     */
    readonly isGrowth?: boolean;
    /** The growth that ends the background pass: the document's end is final (until something is appended). */
    readonly isFinalGrowth?: boolean;
    /**
     * Lines were appended to the file, after the last one: of a document on disk (`DiskTextBuffer.extendTo`, with
     * `isGrowth`, no version bump), or of a document in memory (`TextDocument.appendText`, an edit). The view's
     * follow (`EditorViewState.followTail`) rides on it; the growth of the index alone is not an append.
     */
    readonly isAppend?: boolean;
}

/**
 * The range is in coordinates BEFORE this edit; the model splits text on `\n` and the
 * mirror must do the same. Order within a batch is apply order (descending positions).
 */
export interface IModelContentChange {
    readonly range: IRange;
    readonly text: string;
}

export interface IModelContentChangedEvent {
    /** Empty when `isFlush`. */
    readonly changes: readonly IModelContentChange[];
    readonly versionId: number;
    readonly eol: EndOfLine;
    readonly isFlush: boolean;
}
