import { Emitter } from "../../../base/common/event.ts";
import type { EndOfLine } from "../core/endOfLine.ts";
import { clampPositionToDocument, comparePositions } from "../core/iPosition.ts";
import type { IRange } from "../core/iRange.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";
import { compareTextEditsInDocumentOrder } from "../core/iTextEdit.ts";
import type { ITextBufferFactory } from "../model.ts";

import { DiskTextBuffer } from "./diskTextBuffer.ts";
import type { IDocumentBuffer } from "./iDocumentBuffer.ts";
import type { IDocumentContentChange, IModelContentChangedEvent } from "./iDocumentContentChange.ts";
import type { IDocumentLanguageChange } from "./iDocumentLanguageChange.ts";
import type { IApplyEditsResult, ITextDocument } from "./iTextDocument.ts";
import { PieceTreeDocumentBuffer, toLf } from "./pieceTreeDocumentBuffer.ts";
import { type IModelDeltaDecoration, TrackedDecorations } from "./trackedDecorations.ts";

export {
    createTextBufferFactoryBuilder,
    createTextBufferFactoryFromChunks,
    type ITextBufferFactoryBuilder,
} from "./pieceTreeDocumentBuffer.ts";

/**
 * The 0-based {@link ITextDocument} over an {@link IDocumentBuffer}: the piece tree of upstream behind
 * `PieceTreeDocumentBuffer` (the ±1 adapter, docs/arch/Editor.md) or the read-only `DiskTextBuffer`.
 * The document owns versions, edit validation, decorations and events; the buffer owns the text.
 *
 * On load EOLs are normalized to the dominant one (`normalizeEOL`); a lone `\r` is
 * a line break too. Outward everything is LF: {@link getText} and edits use `\n`,
 * {@link serialize} uses `eol`.
 */
export class TextDocument implements ITextDocument {
    private buffer!: IDocumentBuffer;
    private readonly onDidChangeContentEmitter = new Emitter<IDocumentContentChange>();
    public readonly onDidChangeContent = this.onDidChangeContentEmitter.event;
    private readonly onDidChangeModelContentEmitter = new Emitter<IModelContentChangedEvent>();
    public readonly onDidChangeModelContent = this.onDidChangeModelContentEmitter.event;
    private readonly onDidChangeLanguageEmitter = new Emitter<IDocumentLanguageChange>();
    public readonly onDidChangeLanguage = this.onDidChangeLanguageEmitter.event;
    private readonly onDidChangeEolEmitter = new Emitter<void>();
    public readonly onDidChangeEol = this.onDidChangeEolEmitter.event;
    private innerVersionId = 0;
    private languageIdValue: string;
    private readonly decorations = new TrackedDecorations();

    public constructor(text: TextSource, languageId = "plaintext") {
        this.attachBuffer(createDocumentBuffer(text));
        this.languageIdValue = languageId;
    }

    public get versionId(): number {
        return this.innerVersionId;
    }

    public get eol(): EndOfLine {
        return this.buffer.eol;
    }

    public get languageId(): string {
        return this.languageIdValue;
    }

    /** The document on disk behind this one, or `null` when the text is in memory (the piece tree). */
    public get onDisk(): DiskTextBuffer | null {
        return this.buffer instanceof DiskTextBuffer ? this.buffer : null;
    }

    /** Releases the buffer: a document on disk holds a descriptor and a background pass. The model calls it. */
    public dispose(): void {
        this.buffer.dispose();
    }

    /** Leaves `versionId` alone: a language change does not make the document dirty. */
    public setLanguage(languageId: string): void {
        if (languageId === this.languageIdValue) return;
        const oldLanguageId = this.languageIdValue;
        this.languageIdValue = languageId;
        this.onDidChangeLanguageEmitter.fire({ oldLanguageId, newLanguageId: languageId });
    }

    public get lineCount(): number {
        return this.buffer.lineCount;
    }

    public getLineContent(lineIndex: number): string {
        this.assertValidLineIndex(lineIndex);
        return this.buffer.getLineContent(lineIndex);
    }

    public getLineLength(lineIndex: number): number {
        this.assertValidLineIndex(lineIndex);
        return this.buffer.getLineLength(lineIndex);
    }

    public getText(): string {
        return this.buffer.getValueInRange(this.fullRange());
    }

    public getValueLength(): number {
        return this.buffer.getValueLength();
    }

    public serialize(): string {
        return this.buffer.serialize();
    }

    /** {@link serialize} in chunks; content is as of the call, later edits are not included. */
    public createSnapshot(): Iterable<string> {
        return this.buffer.createSnapshot();
    }

    public getLinesContent(): string[] {
        return this.buffer.getLinesContent();
    }

    public setEol(eol: EndOfLine): void {
        if (eol === this.eol) return;
        this.assertWritable("setEol");
        this.buffer.setEol(eol);
        this.onDidChangeEolEmitter.fire();
    }

    /** Same document, `isFlush` event: a reload is an ordinary edit for every subscriber. */
    public setText(text: TextSource): void {
        const oldEndLine = this.lineCount - 1;
        const eolBefore = this.eol;
        this.innerVersionId++;
        this.buffer.dispose();
        this.attachBuffer(createDocumentBuffer(text));
        this.decorations.acceptFlush(this);
        this.fireChange({
            startLine: 0,
            oldEndLine,
            newEndLine: this.lineCount - 1,
            isFlush: true,
        });
        this.onDidChangeModelContentEmitter.fire({
            changes: [],
            versionId: this.innerVersionId,
            eol: this.eol,
            isFlush: true,
        });
        if (this.eol !== eolBefore) this.onDidChangeEolEmitter.fire();
    }

    /**
     * Growth of a document on disk is relayed as a change on its last line, without a version bump (the
     * document is not modified) and without `onDidChangeModelContent` (there is no mirror of such a document).
     * The subscription dies with the buffer's emitter: a replaced buffer is disposed first ({@link setText}).
     */
    private attachBuffer(buffer: IDocumentBuffer): void {
        this.buffer = buffer;
        buffer.onDidAppendLines?.((change) => {
            this.fireChange(change);
        });
    }

    public deltaDecorations(oldIds: readonly string[], newDecorations: readonly IModelDeltaDecoration[]): string[] {
        return this.decorations.delta(oldIds, newDecorations, this);
    }

    public getDecorationRange(id: string): IRange | null {
        return this.decorations.getRange(id);
    }

    public getTextInRange(range: IRange): string {
        return this.buffer.getValueInRange(this.validateRange(range));
    }

    public applyEdits(edits: readonly ITextEdit[]): IApplyEditsResult {
        if (edits.length === 0) {
            return { appliedVersion: this.innerVersionId, inverseEdits: [] };
        }
        this.assertWritable("applyEdits");

        // Same order as the buffer's `_sortOpsAscending`; inverse edits come back in exactly this order.
        const docOrder = edits.map((edit) => this.validateEdit(edit)).sort(compareTextEditsInDocumentOrder);
        for (let i = 1; i < docOrder.length; i++) {
            if (comparePositions(docOrder[i].range.start, docOrder[i - 1].range.end) < 0) {
                // Same rejection as the buffer's, but before decorations have moved.
                throw new Error("Overlapping ranges are not allowed!");
            }
        }

        this.innerVersionId++;

        // Reversed docOrder, not a descending sort: a stable sort would leave edits with
        // IDENTICAL ranges (two inserts at one point, i.e. inverses of adjacent deletes)
        // backwards.
        const reversed = [...docOrder].reverse();

        // Decorations move while the text is still old: offsets are measured against the
        // previous text. Going bottom-up, lower edits never touch the lines of upper ones,
        // so line lengths come from the pre-batch buffer.
        for (const edit of reversed) {
            this.decorations.acceptEdit(edit, (line) => this.getLineLength(line));
        }

        const inverseEdits = this.buffer.applyEdits(docOrder);

        // Each next event addresses a document where the previous ones are ALREADY
        // applied, so bounds shift by the accumulated line delta. Without the shift
        // `EditorViewState.remapForDocumentChange` crashed on `getLineLength` past the end.
        let lineShift = 0;
        for (const edit of docOrder) {
            const startLine = edit.range.start.line;
            const oldEndLine = edit.range.end.line;
            const newEndLine = startLine + countLineFeeds(edit.text);
            this.fireChange({
                startLine: startLine + lineShift,
                oldEndLine: oldEndLine + lineShift,
                newEndLine: newEndLine + lineShift,
            });
            lineShift += newEndLine - oldEndLine;
        }

        // `reversed` is the apply order in original coordinates: applied in sequence to a
        // copy of the pre-batch lines, it yields the post-batch text.
        this.onDidChangeModelContentEmitter.fire({
            changes: reversed.map((edit) => ({ range: edit.range, text: edit.text })),
            versionId: this.innerVersionId,
            eol: this.eol,
            isFlush: false,
        });

        return { appliedVersion: this.innerVersionId, inverseEdits };
    }

    /**
     * Normalizes line breaks to `\n`: the buffer also treats `\r`/`\r\n` as breaks, while
     * events, decorations and the extension mirror split on `\n`; they would diverge.
     */
    private validateEdit(edit: ITextEdit): ITextEdit {
        return { range: this.validateRange(edit.range), text: toLf(edit.text) };
    }

    private validateRange(range: IRange): IRange {
        return {
            start: clampPositionToDocument(this, range.start),
            end: clampPositionToDocument(this, range.end),
        };
    }

    private fullRange(): IRange {
        const lastLine = this.buffer.lineCount - 1;
        return {
            start: { line: 0, character: 0 },
            end: { line: lastLine, character: this.buffer.getLineLength(lastLine) },
        };
    }

    private fireChange(change: IDocumentContentChange): void {
        this.onDidChangeContentEmitter.fire(change);
    }

    /** Before anything moves: a refused edit leaves the version, decorations and listeners as they were. */
    private assertWritable(operation: string): void {
        if (this.buffer.isReadOnly) {
            throw new Error(
                `TextDocument.${operation}: the document on disk is read-only (Enable Editing loads it into memory)`,
            );
        }
    }

    private assertValidLineIndex(lineIndex: number): void {
        const lineCount = this.buffer.lineCount;
        if (lineIndex < 0 || lineIndex >= lineCount) {
            throw new RangeError(`Line index ${lineIndex.toString()} out of bounds [0, ${(lineCount - 1).toString()}]`);
        }
    }
}

/** A string or a chunk factory build a piece tree; a ready buffer (the document on disk) is taken as is. */
export type TextSource = string | ITextBufferFactory | IDocumentBuffer;

function createDocumentBuffer(text: TextSource): IDocumentBuffer {
    if (typeof text === "string" || "create" in text) return new PieceTreeDocumentBuffer(text);
    return text;
}

function countLineFeeds(text: string): number {
    let count = 0;
    for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) count++;
    return count;
}
