import { Emitter } from "../../../base/common/event.ts";
import type { IRandomAccessFile } from "../../../platform/files/common/iRandomAccessFile.ts";
import { EndOfLine, eolToSequence } from "../core/endOfLine.ts";
import type { IRange } from "../core/iRange.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";

import type { IDocumentBuffer } from "./iDocumentBuffer.ts";
import type { IDocumentContentChange } from "./iDocumentContentChange.ts";
import { LineStartIndex } from "./lineStartIndex.ts";
import { SNAPSHOT_CHUNK_LENGTH } from "./pieceTreeDocumentBuffer.ts";

const KiB = 1024;
const MiB = 1024 * KiB;

/** One read of the indexing pass; also what the constructor reads synchronously for the first screen. */
export const DISK_INDEX_CHUNK_SIZE = 4 * MiB;
/** A frame's lines come from one or two pages; a miss is one `pread` of this size. */
export const DISK_PAGE_SIZE = MiB;
/** The constant part of the memory: pages × size. */
export const DISK_CACHED_PAGES = 32;
/**
 * A line is read up to this many bytes: a 2 GB file of one line (a minified JSON) must not become a 2 GB
 * string on the first frame. The view stops painting a line at `STOP_RENDERING_LINE_AFTER` anyway.
 */
export const DISK_LINE_BYTE_CAP = MiB;
/**
 * `buffer.constants.MAX_STRING_LENGTH` of node on 64-bit (V8's limit). Not imported: the editor's common
 * layer takes no node modules. Whole-text reads of a document on disk refuse above it with an error
 * instead of V8's `RangeError: Invalid string length` after seconds of work.
 */
export const MAX_STRING_LENGTH = 2 ** 29 - 24;

const CARRIAGE_RETURN = 0x0d;

export interface IDiskIndexingProgress {
    readonly indexedBytes: number;
    readonly totalBytes: number;
    readonly done: boolean;
    /** The pass stopped on a read error; what was indexed stays readable. */
    readonly error: unknown;
}

export interface IDiskTextBufferOptions {
    /** Bytes of the BOM at the start of the file: line 0 begins after it. */
    readonly bomLength?: number;
    readonly chunkSize?: number;
    readonly pageSize?: number;
    readonly cachedPages?: number;
    readonly lineByteCap?: number;
    /** Tests lower {@link MAX_STRING_LENGTH} to hit the guard on small files. */
    readonly maxStringLength?: number;
}

/**
 * The read-only document on disk (docs/arch/Editor.md, OpenPerformance stage 4.2): the file is never read
 * into memory as a whole. Lines are located through a {@link LineStartIndex} built from the file in the
 * background and read on demand through an LRU of pages. UTF-8 only: `\n` is ASCII and no multibyte
 * sequence contains it, so every line decodes on its own; a trailing `\r` is stripped. Unlike the piece
 * tree, a lone `\r` is not a line break.
 *
 * The constructor indexes the first chunk synchronously (the first screen is ready when the model is);
 * {@link startIndexing} continues asynchronously and the line count grows: each chunk fires
 * {@link onDidAppendLines} (a change on the last line) and {@link onDidChangeIndexing} (progress). While the
 * pass runs the line whose end is not known yet is not counted; when it ends, the final line appears, empty
 * when the file ends with `\n` (as in the piece tree).
 */
export class DiskTextBuffer implements IDocumentBuffer {
    public readonly isReadOnly = true;
    private readonly starts = new LineStartIndex();
    private readonly bomLength: number;
    private readonly chunkSize: number;
    private readonly pageSize: number;
    private readonly cachedPages: number;
    private readonly lineByteCap: number;
    private readonly maxStringLength: number;
    /** Insertion order is the LRU order: a hit re-inserts. */
    private readonly pages = new Map<number, Buffer>();
    private indexedBytes: number;
    private done = false;
    private indexingStarted = false;
    private indexingError: unknown = null;
    private disposed = false;
    private eolValue = EndOfLine.LF;
    private eolDecided = false;
    /** The frame asks for a line's content and then its length; one decode serves both. */
    private lastLine: { readonly line: number; readonly content: string } | null = null;
    private readonly onDidAppendLinesEmitter = new Emitter<IDocumentContentChange>();
    public readonly onDidAppendLines = this.onDidAppendLinesEmitter.event;
    private readonly onDidChangeIndexingEmitter = new Emitter<void>();
    /** Progress of the background pass, including its end. */
    public readonly onDidChangeIndexing = this.onDidChangeIndexingEmitter.event;

    public constructor(
        private readonly file: IRandomAccessFile,
        options: IDiskTextBufferOptions = {},
    ) {
        this.bomLength = options.bomLength ?? 0;
        this.chunkSize = options.chunkSize ?? DISK_INDEX_CHUNK_SIZE;
        this.pageSize = options.pageSize ?? DISK_PAGE_SIZE;
        this.cachedPages = options.cachedPages ?? DISK_CACHED_PAGES;
        this.lineByteCap = options.lineByteCap ?? DISK_LINE_BYTE_CAP;
        this.maxStringLength = options.maxStringLength ?? MAX_STRING_LENGTH;
        this.indexedBytes = this.bomLength;
        this.starts.append(this.bomLength);
        const chunk = Buffer.allocUnsafe(this.chunkSize);
        const read = file.readSync(chunk, this.bomLength);
        this.indexChunk(chunk.subarray(0, read), this.bomLength);
        if (this.indexedBytes >= file.size) this.finish();
    }

    public get size(): number {
        return this.file.size;
    }

    public get indexing(): IDiskIndexingProgress {
        return {
            indexedBytes: this.indexedBytes,
            totalBytes: this.file.size,
            done: this.done,
            error: this.indexingError,
        };
    }

    /** Idempotent. The pass stops with {@link dispose}. */
    public startIndexing(): void {
        if (this.indexingStarted || this.done) return;
        this.indexingStarted = true;
        void this.indexRest();
    }

    private async indexRest(): Promise<void> {
        const chunk = Buffer.allocUnsafe(this.chunkSize);
        try {
            // The chunks are laid out up front from the size at open: the pass is bounded by them, not by a
            // counter that a mutant could stall (docs/MUTATION.md). A file that grows meanwhile is 4.4.
            for (const offset of this.chunkOffsets()) {
                // A dispose can only land under the await: the loop body is synchronous otherwise.
                const read = await this.file.read(chunk, offset);
                if (!this.isLive()) return;
                // The file shrank under us: what was indexed stays, the tail is gone (rotation is 4.4).
                if (read <= 0) break;
                const before = this.lineCount;
                this.indexChunk(chunk.subarray(0, read), offset);
                this.fireGrowth(before);
                this.onDidChangeIndexingEmitter.fire();
            }
        } catch (error) {
            if (!this.isLive()) return;
            this.indexingError = error;
        }
        this.finish();
    }

    /** Offsets of the chunks still to read, from the indexed end to the file size. */
    private chunkOffsets(): number[] {
        const first = this.indexedBytes;
        const count = Math.ceil((this.file.size - first) / this.chunkSize);
        return Array.from({ length: Math.max(0, count) }, (_, index) => first + index * this.chunkSize);
    }

    /** A method, not the field: the flag flips under an `await`, which TypeScript's narrowing does not see. */
    private isLive(): boolean {
        return !this.disposed;
    }

    private indexChunk(chunk: Buffer, offset: number): void {
        this.starts.appendChunk(chunk, offset);
        this.indexedBytes = offset + chunk.length;
        this.lastLine = null;
        if (!this.eolDecided && this.starts.count >= 2) {
            // Stryker disable next-line BooleanLiteral: deciding again reads the same bytes and gives the same EOL; the flag only saves the read
            this.eolDecided = true;
            // The first line's `\n` is right before the second line's start; a `\r` before it means CRLF.
            const feedAt = this.starts.lineStart(1) - 1;
            if (feedAt > this.bomLength && this.byteAt(feedAt - 1) === CARRIAGE_RETURN) this.eolValue = EndOfLine.CRLF;
        }
    }

    /** The last line becomes final (and visible); the pass is over either way. */
    private finish(): void {
        const before = this.lineCount;
        this.done = true;
        this.lastLine = null;
        this.fireGrowth(before);
        this.onDidChangeIndexingEmitter.fire();
    }

    private fireGrowth(before: number): void {
        const after = this.lineCount;
        if (after === before) return;
        this.onDidAppendLinesEmitter.fire({ startLine: before - 1, oldEndLine: before - 1, newEndLine: after - 1 });
    }

    public get eol(): EndOfLine {
        return this.eolValue;
    }

    /**
     * While the pass runs, the line whose end is not known yet is not counted — except when it is the only
     * one: a document always has a line, so a file without a `\n` in its first chunk shows what is read.
     */
    public get lineCount(): number {
        return this.done ? this.starts.count : Math.max(1, this.starts.count - 1);
    }

    public getLineContent(line: number): string {
        if (this.lastLine?.line === line) return this.lastLine.content;
        this.assertLine(line);
        const start = this.starts.lineStart(line);
        const end = this.lineEnd(line);
        let length = Math.min(end - start, this.lineByteCap);
        const bytes = this.readBytes(start, length);
        length = bytes.length;
        // `bytes[-1]` of an empty line is undefined, not a CR.
        if (bytes[length - 1] === CARRIAGE_RETURN) length--;
        const content = bytes.toString("utf8", 0, length);
        this.lastLine = { line, content };
        return content;
    }

    public getLineLength(line: number): number {
        return this.getLineContent(line).length;
    }

    public getValueInRange(range: IRange): string {
        const { start, end } = range;
        if (start.line === end.line) return this.getLineContent(start.line).slice(start.character, end.character);
        // Characters are at most the bytes: the lines before the last in full, plus the last line's prefix.
        this.assertFitsString(this.starts.lineStart(start.line), this.lineEnd(end.line - 1) + end.character);
        const parts = [this.getLineContent(start.line).slice(start.character)];
        for (let line = start.line + 1; line < end.line; line++) parts.push(this.getLineContent(line));
        parts.push(this.getLineContent(end.line).slice(0, end.character));
        return parts.join("\n");
    }

    /**
     * Bytes of the indexed content without the line feeds — an upper bound of the character count (a `\r`
     * or a multibyte sequence counts more than one). Known without decoding, like the piece tree's length.
     */
    public getValueLength(): number {
        return Math.max(0, this.indexedBytes - this.bomLength - (this.starts.count - 1));
    }

    public serialize(): string {
        this.assertFitsString(this.bomLength, this.indexedBytes);
        return [...this.createSnapshot()].join("");
    }

    /** Lines with the document's EOL, in chunks of about {@link SNAPSHOT_CHUNK_LENGTH}; as of the call. */
    public *createSnapshot(): Generator<string> {
        const eol = eolToSequence(this.eolValue);
        const lineCount = this.lineCount;
        let parts: string[] = [];
        let length = 0;
        for (let line = 0; line < lineCount; line++) {
            const content = line === lineCount - 1 ? this.getLineContent(line) : this.getLineContent(line) + eol;
            parts.push(content);
            length += content.length;
            if (length >= SNAPSHOT_CHUNK_LENGTH) {
                yield parts.join("");
                parts = [];
                length = 0;
            }
        }
        if (parts.length > 0) yield parts.join("");
    }

    public getLinesContent(): string[] {
        this.assertFitsString(this.bomLength, this.indexedBytes);
        return Array.from({ length: this.lineCount }, (_, line) => this.getLineContent(line));
    }

    public setEol(): void {
        throw readOnlyError("setEol");
    }

    public applyEdits(): readonly ITextEdit[] {
        throw readOnlyError("applyEdits");
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        // Stryker disable next-line CallExpression: the pages are garbage with the buffer; clearing frees them before the GC gets there
        this.pages.clear();
        this.file.dispose();
        // Stryker disable next-line CallExpression: the pass checks isLive before it fires, so a kept listener never hears anything; disposing only drops it
        this.onDidAppendLinesEmitter.dispose();
        // Stryker disable next-line CallExpression: same
        this.onDidChangeIndexingEmitter.dispose();
    }

    /** First byte after the line's content and its `\r`, i.e. the position of its `\n` (or the indexed end). */
    private lineEnd(line: number): number {
        return line + 1 < this.starts.count ? this.starts.lineStart(line + 1) - 1 : this.indexedBytes;
    }

    private assertLine(line: number): void {
        const lineCount = this.lineCount;
        if (line < 0 || line >= lineCount) {
            throw new RangeError(`Line index ${String(line)} out of bounds [0, ${String(lineCount - 1)}]`);
        }
    }

    /** Characters are at most the bytes; above the string limit V8 would throw after building most of it. */
    private assertFitsString(fromByte: number, toByte: number): void {
        if (toByte - fromByte > this.maxStringLength) {
            throw new RangeError(
                `The document on disk is ${String(toByte - fromByte)} bytes, more than a string can hold (${String(this.maxStringLength)}); read it by lines`,
            );
        }
    }

    private byteAt(position: number): number {
        return this.readBytes(position, 1)[0];
    }

    /** A slice of one page without a copy, or the concatenation of the pages the range spans. */
    private readBytes(position: number, length: number): Buffer {
        // Stryker disable next-line ConditionalExpression,EqualityOperator: an empty range falls through to an empty slice or concat; the return only skips the page lookup
        if (length <= 0) return Buffer.alloc(0);
        const firstPage = Math.floor(position / this.pageSize);
        const lastPage = Math.floor((position + length - 1) / this.pageSize);
        // Stryker disable next-line ConditionalExpression,BlockStatement: the concat below gives the same bytes from one page; this path only saves the copy
        if (firstPage === lastPage) {
            const offset = position - firstPage * this.pageSize;
            return this.page(firstPage).subarray(offset, offset + length);
        }
        const parts: Buffer[] = [];
        for (let index = firstPage; index <= lastPage; index++) {
            const base = index * this.pageSize;
            const from = Math.max(position, base) - base;
            const to = Math.min(position + length, base + this.pageSize) - base;
            parts.push(this.page(index).subarray(from, to));
        }
        return Buffer.concat(parts);
    }

    /** Shorter than `pageSize` at the end of the file; a page past the end is empty. */
    private page(index: number): Buffer {
        const cached = this.pages.get(index);
        if (cached !== undefined) {
            this.pages.delete(index);
            this.pages.set(index, cached);
            return cached;
        }
        const buffer = Buffer.allocUnsafe(this.pageSize);
        const read = this.file.readSync(buffer, index * this.pageSize);
        const page = buffer.subarray(0, read);
        this.pages.set(index, page);
        if (this.pages.size > this.cachedPages) {
            const oldest = this.pages.keys().next().value;
            // Stryker disable next-line ConditionalExpression: the map is over its cap, so it has a first key; the check is for the type
            if (oldest !== undefined) this.pages.delete(oldest);
        }
        return page;
    }
}

function readOnlyError(operation: string): Error {
    return new Error(
        `DiskTextBuffer.${operation}: the document on disk is read-only (Enable Editing loads it into memory)`,
    );
}
