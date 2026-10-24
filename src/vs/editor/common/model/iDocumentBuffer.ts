import type { Event } from "../../../base/common/event.ts";
import type { EndOfLine } from "../core/endOfLine.ts";
import type { IRange } from "../core/iRange.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";

import type { IDocumentContentChange } from "./iDocumentContentChange.ts";

/**
 * What `TextDocument` needs from its storage, in the core's terms: 0-based lines, LF-canonical text outward.
 * Two implementations: the piece tree of upstream behind `PieceTreeDocumentBuffer` (the ±1 adapter) and
 * `DiskTextBuffer`, the read-only document on disk (docs/arch/Editor.md). The document adds versions,
 * validation, decorations and events on top.
 */
export interface IDocumentBuffer {
    /** {@link applyEdits} and {@link setEol} refuse; the document checks it first, before versions and decorations move. */
    readonly isReadOnly: boolean;
    readonly eol: EndOfLine;
    readonly lineCount: number;
    getLineContent(line: number): string;
    getLineLength(line: number): number;
    /** LF between lines, whatever `eol` is; the range is already validated. */
    getValueInRange(range: IRange): string;
    /** Length of the LF text. */
    getValueLength(): number;
    /** The text with the buffer's `eol`. */
    serialize(): string;
    /** {@link serialize} in chunks, as of the call. */
    createSnapshot(): Iterable<string>;
    getLinesContent(): string[];
    setEol(eol: EndOfLine): void;
    /**
     * Validated, non-overlapping edits in document order. Returns the inverse edits in coordinates of the
     * applied document, in document order, LF-canonical.
     */
    applyEdits(edits: readonly ITextEdit[]): readonly ITextEdit[];
    dispose(): void;
    /**
     * Lines appended by a background pass (the document on disk grows as its index is built): the change is on
     * the last line, as if a newline and the new lines were typed at its end. A buffer whose content is final
     * from the start has no such event.
     */
    readonly onDidAppendLines?: Event<IDocumentContentChange>;
}
