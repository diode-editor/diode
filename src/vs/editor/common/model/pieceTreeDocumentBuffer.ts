import { UTF8_BOM_CHARACTER } from "../../../base/common/strings.ts";
import { EndOfLine, eolToSequence } from "../core/endOfLine.ts";
import type { IRange } from "../core/iRange.ts";
import { createRange } from "../core/iRange.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";
import { createTextEdit } from "../core/iTextEdit.ts";
import { Range } from "../core/range.ts";
import type { ITextBuffer, ITextBufferFactory, ITextSnapshot } from "../model.ts";
import { DefaultEndOfLine, EndOfLinePreference, ValidAnnotatedEditOperation } from "../model.ts";

import type { IDocumentBuffer } from "./iDocumentBuffer.ts";
import { PieceTreeTextBufferBuilder } from "./pieceTreeTextBuffer/pieceTreeTextBufferBuilder.ts";

/**
 * Adapts the 1-based upstream `PieceTreeTextBuffer` to the 0-based {@link IDocumentBuffer}: the ±1 lives
 * only here (docs/arch/Editor.md). The buffer treats a lone `\r` as a line break too and normalizes EOLs
 * to the dominant one on load; outward everything is LF except {@link serialize}.
 */
export class PieceTreeDocumentBuffer implements IDocumentBuffer {
    public readonly isReadOnly = false;
    private readonly buffer: ITextBuffer;

    public constructor(text: string | ITextBufferFactory) {
        const factory = typeof text === "string" ? createTextBufferFactoryFromChunks([text]) : text;
        const { textBuffer } = factory.create(DefaultEndOfLine.LF);
        // The builder strips a leading BOM into a separate field, but our decoder already
        // removed the BOM (`encoding.ts`): here U+FEFF is an ordinary character, put it back.
        if (textBuffer.getBOM() !== "") {
            // Stryker disable next-line BooleanLiteral: neither auto-whitespace nor the inverse edit is read here
            textBuffer.applyEdits([toBufferOperation(new Range(1, 1, 1, 1), UTF8_BOM_CHARACTER)], false, false);
        }
        this.buffer = textBuffer;
    }

    public get eol(): EndOfLine {
        return this.buffer.getEOL() === "\r\n" ? EndOfLine.CRLF : EndOfLine.LF;
    }

    public get lineCount(): number {
        return this.buffer.getLineCount();
    }

    public getLineContent(line: number): string {
        return this.buffer.getLineContent(line + 1);
    }

    /**
     * Goes through the content, not `buffer.getLineLength`: that one walks down the
     * tree twice without a cache. A pass over 200k lines takes ~20 ms vs ~110 ms.
     */
    public getLineLength(line: number): number {
        return this.getLineContent(line).length;
    }

    public getValueInRange(range: IRange): string {
        return this.buffer.getValueInRange(toBufferRange(range), EndOfLinePreference.LF);
    }

    public getValueLength(): number {
        return this.buffer.getValueLengthInRange(this.fullRange(), EndOfLinePreference.LF);
    }

    public serialize(): string {
        return this.buffer.getValueInRange(this.fullRange(), EndOfLinePreference.TextDefined);
    }

    public createSnapshot(): Iterable<string> {
        return readSnapshot(this.buffer.createSnapshot(false));
    }

    public getLinesContent(): string[] {
        return this.buffer.getLinesContent();
    }

    public setEol(eol: EndOfLine): void {
        this.buffer.setEOL(eolToSequence(eol));
    }

    public applyEdits(edits: readonly ITextEdit[]): readonly ITextEdit[] {
        const result = this.buffer.applyEdits(
            edits.map((edit) => toBufferOperation(toBufferRange(edit.range), edit.text)),
            // Stryker disable next-line BooleanLiteral: the buffer computes auto-whitespace but we never read it
            false,
            true,
        );
        // Inverse edits are in coordinates of the ALREADY APPLIED document, in document
        // order; buffer text carries its EOL, outward it is LF.
        // Stryker disable next-line ArrayDeclaration: with computeUndoEdits the buffer always returns an array
        const reverseEdits = result.reverseEdits ?? [];
        return reverseEdits.map((op) => createTextEdit(fromBufferRange(op.range), toLf(op.text)));
    }

    // Stryker disable next-line BlockStatement: the buffer only owns an emitter with no subscribers, no observable effect
    public dispose(): void {
        // Stryker disable next-line CallExpression: same
        this.buffer.dispose();
    }

    private fullRange(): Range {
        const lineCount = this.buffer.getLineCount();
        return new Range(1, 1, lineCount, this.buffer.getLineLength(lineCount) + 1);
    }
}

/** A chunk boundary may split `\r\n` or a surrogate pair; the builder holds the tail until the next chunk. */
export function createTextBufferFactoryFromChunks(chunks: Iterable<string>): ITextBufferFactory {
    const builder = createTextBufferFactoryBuilder();
    for (const chunk of chunks) builder.acceptChunk(chunk);
    return builder.finish();
}

/** Takes chunks one at a time, across awaits: a streaming load feeds it as bytes arrive (A4, OpenPerformance 4.5). */
export interface ITextBufferFactoryBuilder {
    acceptChunk(chunk: string): void;
    finish(): ITextBufferFactory;
}

/** {@link createTextBufferFactoryFromChunks} for a source that is not an iterable: upstream `createTextBufferFactoryFromStream`. */
export function createTextBufferFactoryBuilder(): ITextBufferFactoryBuilder {
    const builder = new PieceTreeTextBufferBuilder();
    return {
        acceptChunk: (chunk) => {
            builder.acceptChunk(chunk);
        },
        // Stryker disable next-line BooleanLiteral: without normalization the buffer converts EOL on every read (regex over text); same semantics, different cost
        finish: () => builder.finish(true),
    };
}

/** Snapshot chunk merge threshold, as in upstream `TextModelSnapshot`. */
export const SNAPSHOT_CHUNK_LENGTH = 64 * 1024;

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

export function toLf(text: string): string {
    return text.replace(/\r\n?/g, "\n");
}
