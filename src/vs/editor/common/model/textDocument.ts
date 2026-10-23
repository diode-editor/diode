import { Emitter } from "../../../base/common/event.ts";
import { UTF8_BOM_CHARACTER } from "../../../base/common/strings.ts";
import { EndOfLine, eolToSequence } from "../core/endOfLine.ts";
import { clampPositionToDocument, comparePositions } from "../core/iPosition.ts";
import type { IRange } from "../core/iRange.ts";
import { createRange } from "../core/iRange.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";
import { compareTextEditsInDocumentOrder, createTextEdit } from "../core/iTextEdit.ts";
import { Range } from "../core/range.ts";
import type { ITextBuffer, ITextBufferFactory, ITextSnapshot } from "../model.ts";
import { DefaultEndOfLine, EndOfLinePreference, ValidAnnotatedEditOperation } from "../model.ts";

import type { IDocumentContentChange, IModelContentChangedEvent } from "./iDocumentContentChange.ts";
import type { IDocumentLanguageChange } from "./iDocumentLanguageChange.ts";
import type { IApplyEditsResult, ITextDocument } from "./iTextDocument.ts";
import { PieceTreeTextBufferBuilder } from "./pieceTreeTextBuffer/pieceTreeTextBufferBuilder.ts";
import { type IModelDeltaDecoration, TrackedDecorations } from "./trackedDecorations.ts";

/**
 * Adapts 0-based {@link ITextDocument} to the 1-based upstream `PieceTreeTextBuffer`:
 * the ±1 lives only here (docs/arch/Editor.md).
 *
 * On load EOLs are normalized to the dominant one (`normalizeEOL`); a lone `\r` is
 * a line break too. Outward everything is LF: {@link getText} and edits use `\n`,
 * {@link serialize} uses `eol`.
 */
export class TextDocument implements ITextDocument {
    private buffer: ITextBuffer;
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
        this.buffer = createTextBuffer(text);
        this.languageIdValue = languageId;
    }

    public get versionId(): number {
        return this.innerVersionId;
    }

    public get eol(): EndOfLine {
        return this.buffer.getEOL() === "\r\n" ? EndOfLine.CRLF : EndOfLine.LF;
    }

    public get languageId(): string {
        return this.languageIdValue;
    }

    /** Leaves `versionId` alone: a language change does not make the document dirty. */
    public setLanguage(languageId: string): void {
        if (languageId === this.languageIdValue) return;
        const oldLanguageId = this.languageIdValue;
        this.languageIdValue = languageId;
        this.onDidChangeLanguageEmitter.fire({ oldLanguageId, newLanguageId: languageId });
    }

    public get lineCount(): number {
        return this.buffer.getLineCount();
    }

    public getLineContent(lineIndex: number): string {
        this.assertValidLineIndex(lineIndex);
        return this.buffer.getLineContent(lineIndex + 1);
    }

    /**
     * Goes through the content, not `buffer.getLineLength`: that one walks down the
     * tree twice without a cache. A pass over 200k lines takes ~20 ms vs ~110 ms.
     */
    public getLineLength(lineIndex: number): number {
        return this.getLineContent(lineIndex).length;
    }

    public getText(): string {
        return this.buffer.getValueInRange(this.fullRange(), EndOfLinePreference.LF);
    }

    public getValueLength(): number {
        return this.buffer.getValueLengthInRange(this.fullRange(), EndOfLinePreference.LF);
    }

    public serialize(): string {
        return this.buffer.getValueInRange(this.fullRange(), EndOfLinePreference.TextDefined);
    }

    /** {@link serialize} in chunks; content is as of the call, later edits are not included. */
    public createSnapshot(): Iterable<string> {
        return readSnapshot(this.buffer.createSnapshot(false));
    }

    public getLinesContent(): string[] {
        return this.buffer.getLinesContent();
    }

    public setEol(eol: EndOfLine): void {
        if (eol === this.eol) return;
        this.buffer.setEOL(eolToSequence(eol));
        this.onDidChangeEolEmitter.fire();
    }

    /** Same document, `isFlush` event: a reload is an ordinary edit for every subscriber. */
    public setText(text: TextSource): void {
        const oldEndLine = this.lineCount - 1;
        const eolBefore = this.eol;
        this.innerVersionId++;
        // Stryker disable next-line CallExpression: the buffer only owns an emitter with no subscribers, no observable effect
        this.buffer.dispose();
        this.buffer = createTextBuffer(text);
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

    public deltaDecorations(oldIds: readonly string[], newDecorations: readonly IModelDeltaDecoration[]): string[] {
        return this.decorations.delta(oldIds, newDecorations, this);
    }

    public getDecorationRange(id: string): IRange | null {
        return this.decorations.getRange(id);
    }

    public getTextInRange(range: IRange): string {
        return this.buffer.getValueInRange(toBufferRange(this.validateRange(range)), EndOfLinePreference.LF);
    }

    public applyEdits(edits: readonly ITextEdit[]): IApplyEditsResult {
        if (edits.length === 0) {
            return { appliedVersion: this.innerVersionId, inverseEdits: [] };
        }

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

        const result = this.buffer.applyEdits(
            docOrder.map((edit) => toBufferOperation(toBufferRange(edit.range), edit.text)),
            // Stryker disable next-line BooleanLiteral: the buffer computes auto-whitespace but we never read it
            false,
            true,
        );

        // Inverse edits are in coordinates of the ALREADY APPLIED document, in document
        // order; buffer text carries its EOL, outward it is LF.
        // Stryker disable next-line ArrayDeclaration: with computeUndoEdits the buffer always returns an array
        const reverseEdits = result.reverseEdits ?? [];
        const inverseEdits = reverseEdits.map((op) => createTextEdit(fromBufferRange(op.range), toLf(op.text)));

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

    private fullRange(): Range {
        const lineCount = this.buffer.getLineCount();
        return new Range(1, 1, lineCount, this.buffer.getLineLength(lineCount) + 1);
    }

    private fireChange(change: IDocumentContentChange): void {
        this.onDidChangeContentEmitter.fire(change);
    }

    private assertValidLineIndex(lineIndex: number): void {
        const lineCount = this.buffer.getLineCount();
        if (lineIndex < 0 || lineIndex >= lineCount) {
            throw new RangeError(`Line index ${lineIndex.toString()} out of bounds [0, ${(lineCount - 1).toString()}]`);
        }
    }
}

export type TextSource = string | ITextBufferFactory;

/** A chunk boundary may split `\r\n` or a surrogate pair; the builder holds the tail until the next chunk. */
export function createTextBufferFactoryFromChunks(chunks: Iterable<string>): ITextBufferFactory {
    const builder = new PieceTreeTextBufferBuilder();
    for (const chunk of chunks) builder.acceptChunk(chunk);
    // Stryker disable next-line BooleanLiteral: without normalization the buffer converts EOL on every read (regex over text); same semantics, different cost
    return builder.finish(true);
}

function createTextBuffer(text: TextSource): ITextBuffer {
    const factory = typeof text === "string" ? createTextBufferFactoryFromChunks([text]) : text;
    const { textBuffer } = factory.create(DefaultEndOfLine.LF);
    // The builder strips a leading BOM into a separate field, but our decoder already
    // removed the BOM (`encoding.ts`): here U+FEFF is an ordinary character, put it back.
    if (textBuffer.getBOM() !== "") {
        // Stryker disable next-line BooleanLiteral: neither auto-whitespace nor the inverse edit is read here
        textBuffer.applyEdits([toBufferOperation(new Range(1, 1, 1, 1), UTF8_BOM_CHARACTER)], false, false);
    }
    return textBuffer;
}

/** Snapshot chunk merge threshold, as in upstream `TextModelSnapshot`. */
const SNAPSHOT_CHUNK_LENGTH = 64 * 1024;

function* readSnapshot(snapshot: ITextSnapshot): Generator<string> {
    let parts: string[] = [];
    let length = 0;
    for (let piece = snapshot.read(); piece !== null; piece = snapshot.read()) {
        parts.push(piece);
        length += piece.length;
        if (length >= SNAPSHOT_CHUNK_LENGTH) {
            yield parts.join("");
            parts = [];
            length = 0;
        }
    }
    if (parts.length > 0) yield parts.join("");
}

/** `_isTracked` keeps the buffer from collapsing a batch of 1000+ edits into one (`_reduceOperations`). */
function toBufferOperation(range: Range, text: string): ValidAnnotatedEditOperation {
    // Stryker disable next-line BooleanLiteral: the buffer only copies the flag into the result
    const forceMoveMarkers = false;
    // Stryker disable next-line BooleanLiteral: without recordTrimAutoWhitespace the flag is never read
    const isAutoWhitespaceEdit = false;
    return new ValidAnnotatedEditOperation(null, range, text, forceMoveMarkers, isAutoWhitespaceEdit, true);
}

function toBufferRange(range: IRange): Range {
    return new Range(range.start.line + 1, range.start.character + 1, range.end.line + 1, range.end.character + 1);
}

function fromBufferRange(range: Range): IRange {
    return createRange(range.startLineNumber - 1, range.startColumn - 1, range.endLineNumber - 1, range.endColumn - 1);
}

function toLf(text: string): string {
    return text.replace(/\r\n?/g, "\n");
}

function countLineFeeds(text: string): number {
    let count = 0;
    for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) count++;
    return count;
}
