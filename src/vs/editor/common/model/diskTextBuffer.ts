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
 * Before the tail of a grown file is appended, this many bytes before the old end are read again and compared
 * with the cached page: a file truncated and rewritten past its old size within one watcher window is not an
 * append (follow, docs/arch/Editor.md). The last page is cached whenever the end was on screen.
 */
export const DISK_TAIL_CHECK_BYTES = 4 * KiB;
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
    /** No pass is running: the initial one is over and no tail is being read in the background. */
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
 *
 * A file that grows afterwards (a log being written; follow, stage 4.4) is extended in place with
 * {@link extendTo}: the tail is read from the indexed end and its lines are appended, the last line included —
 * nothing before it is read again. A tail of up to one chunk is read synchronously (the common case: a few
 * lines per watcher window); a bigger one in a background pass like the initial one.
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
    /** The file's size as last told by the caller (the open, then {@link extendTo}); the passes read up to it. */
    private sizeValue: number;
    private indexedBytes: number;
    /**
     * The initial pass is over: the last line is counted, and the file's end is where the indexed bytes end. Never
     * cleared: a later tail only moves the end.
     */
    private tailKnown = false;
    private passRunning = false;
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
        this.sizeValue = file.size;
        this.indexedBytes = this.bomLength;
        this.starts.append(this.bomLength);
        const chunk = Buffer.allocUnsafe(this.chunkSize);
        const read = file.readSync(chunk, this.bomLength);
        this.indexChunk(chunk.subarray(0, read), this.bomLength);
        if (this.indexedBytes >= this.sizeValue) this.finish();
    }

    /** As last told: the size at open, or the one given to {@link extendTo}. */
    public get size(): number {
        return this.sizeValue;
    }

    public get indexing(): IDiskIndexingProgress {
        return {
            indexedBytes: this.indexedBytes,
            totalBytes: this.sizeValue,
            done: this.tailKnown && !this.passRunning,
            error: this.indexingError,
        };
    }

    /** Idempotent. The pass stops with {@link dispose}. */
    public startIndexing(): void {
        if (this.passRunning || this.tailKnown) return;
        void this.runPass();
    }

    /**
     * The file grew to `size` bytes (the caller compared the stats; follow, stage 4.4): the bytes from the indexed
     * end are read and their lines appended, so the index, the pages and the lines before the old end stay. The
     * event is a change on the old last line (its content may have grown) through the new one.
     *
     * `false`: the bytes before the old end no longer match the cached page — the file was truncated and rewritten
     * past its old size within one watcher window, and the caller re-indexes from scratch. While a pass runs the
     * new size is only recorded: the pass reads whatever has arrived when its layout is exhausted.
     */
    public extendTo(size: number): boolean {
        // Stryker disable next-line EqualityOperator: at the same size the rest finds no tail to read and no page to grow; the return only saves the tail check
        if (size <= this.sizeValue) return true;
        const oldSize = this.sizeValue;
        if (!this.tailUnchanged(oldSize)) return false;
        this.sizeValue = size;
        this.growPages();
        if (this.passRunning || !this.tailKnown) return true;
        if (size - this.indexedBytes > this.chunkSize) {
            void this.runPass();
            return true;
        }
        const before = this.lineCount;
        const indexedBefore = this.indexedBytes;
        this.appendTailSync();
        this.fireTail(before, indexedBefore);
        return true;
    }

    private async runPass(): Promise<void> {
        this.passRunning = true;
        this.indexingError = null;
        const chunk = Buffer.allocUnsafe(this.chunkSize);
        try {
            // The chunks are laid out up front from the size as told: the pass is bounded by them, not by a
            // counter that a mutant could stall (docs/MUTATION.md). Bytes that arrive meanwhile are read by finish.
            for (const offset of this.chunkOffsets()) {
                // A dispose can only land under the await: the loop body is synchronous otherwise.
                const read = await this.file.read(chunk, offset);
                if (!this.isLive()) return;
                // The file shrank under us: what was indexed stays; the watcher reports the truncation separately.
                if (read <= 0) break;
                const before = this.lineCount;
                const indexedBefore = this.indexedBytes;
                this.indexChunk(chunk.subarray(0, read), offset);
                this.fireTail(before, indexedBefore);
                this.onDidChangeIndexingEmitter.fire();
            }
        } catch (error) {
            if (!this.isLive()) return;
            this.indexingError = error;
        }
        this.finish();
    }

    /** Offsets of the chunks still to read, from the indexed end to the size as told. */
    private chunkOffsets(): number[] {
        const first = this.indexedBytes;
        const count = Math.ceil((this.sizeValue - first) / this.chunkSize);
        return Array.from({ length: Math.max(0, count) }, (_, index) => first + index * this.chunkSize);
    }

    /** The tail up to the size as told, read on the calling thread; a short read ends it (the file shrank meanwhile). */
    private appendTailSync(): void {
        const offsets = this.chunkOffsets();
        // Stryker disable next-line ConditionalExpression,EqualityOperator: with no chunk to read the loop below does nothing; the return only saves the allocation
        if (offsets.length === 0) return;
        // Sized to the tail, not to a chunk: a 4 MiB scratch buffer per appended line (20 a second) was 80 MB/s of
        // external allocation, and V8's GC ran after it — a third of the CPU of follow.
        // Stryker disable next-line MethodExpression,ArithmeticOperator: a bigger scratch buffer reads the same bytes (each read is bounded below); only the allocation differs
        const chunk = Buffer.allocUnsafe(Math.min(this.chunkSize, this.sizeValue - this.indexedBytes));
        // One `some` over the precomputed offsets: leaves on the first short read, bounded without a counter.
        offsets.some((offset) => {
            // Up to the size as told, not past it: bytes written after the stat belong to the next growth event.
            const read = this.file.readSync(chunk.subarray(0, Math.min(chunk.length, this.sizeValue - offset)), offset);
            if (read <= 0) return true;
            this.indexChunk(chunk.subarray(0, read), offset);
            return false;
        });
    }

    /**
     * The end of the cached page around the old end still reads the same (up to {@link DISK_TAIL_CHECK_BYTES}).
     * The whole cached page counts, not only the bytes before the old end: a page read after a write but before
     * its watcher event holds bytes past the old end, and if those were rewritten, they are stale too. Nothing
     * cached there — trusted: the end was never on screen, and a rewrite that keeps the old bytes as a prefix is
     * an append by content.
     */
    private tailUnchanged(oldEnd: number): boolean {
        const lastPage = Math.floor((oldEnd - 1) / this.pageSize);
        // The last page may never have been read: a file ending with `\n` has an empty last line, and the frame
        // reads the content of the line before it, which may end on the previous page.
        for (const pageIndex of [lastPage, lastPage - 1]) {
            const page = this.pages.get(pageIndex);
            if (page === undefined) continue;
            const from = Math.max(0, page.length - DISK_TAIL_CHECK_BYTES);
            const probe = Buffer.allocUnsafe(page.length - from);
            const read = this.file.readSync(probe, pageIndex * this.pageSize + from);
            // A short read (the file shrank meanwhile) leaves fewer bytes, and a shorter buffer is never equal.
            return probe.subarray(0, read).equals(page.subarray(from));
        }
        return true;
    }

    /**
     * A page that ended with the file is short: the new bytes are read into the room it has left — one `pread`
     * that returns the few new bytes, no allocation, where dropping it would re-read and re-allocate a whole page
     * on the next frame, for every appended line. A full page has no room and is left as it is (a few dozen pages
     * at most). Like any page read, it takes whatever the file holds, past the size as told too: the lines are
     * bounded by the index, and {@link tailUnchanged} compares the whole page.
     */
    private growPages(): void {
        for (const [index, page] of Array.from(this.pages.entries())) {
            // `set` on a present key keeps its place in the LRU order.
            this.pages.set(index, this.growPage(index, page));
        }
    }

    /** {@link page} allocates every page whole (never from the shared pool): the short page is a view of its head. */
    private growPage(index: number, page: Buffer): Buffer {
        const want = this.pageSize - page.length;
        // Stryker disable next-line ConditionalExpression,EqualityOperator: a full page has no room; the read into an empty view would return 0 and the same page, the return only saves the call
        if (want <= 0) return page;
        const room = Buffer.from(page.buffer, page.byteOffset + page.length, want);
        const read = this.file.readSync(room, index * this.pageSize + page.length);
        return Buffer.from(page.buffer, page.byteOffset, page.length + read);
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

    /**
     * The pass is over: the last line becomes final (and visible), and the bytes that arrived while the pass ran
     * ({@link extendTo} raised the size) are read now, on this thread.
     */
    private finish(): void {
        const before = this.lineCount;
        const indexedBefore = this.indexedBytes;
        this.passRunning = false;
        this.tailKnown = true;
        // Not after a read error: the rest of the file could be gigabytes, and the pass that failed was the way to
        // read them off the thread; the next growth starts a new one.
        if (this.indexingError === null) this.appendTailSync();
        this.fireTail(before, indexedBefore);
        this.onDidChangeIndexingEmitter.fire();
    }

    /**
     * A change from the old last line to the new one. Once the tail is known, the last line is on screen and its
     * content may have grown without a new line — fired when bytes were indexed even if the count stands.
     */
    private fireTail(before: number, indexedBefore: number): void {
        const after = this.lineCount;
        if (after === before && !(this.tailKnown && this.indexedBytes !== indexedBefore)) return;
        this.lastLine = null;
        this.onDidAppendLinesEmitter.fire({
            startLine: before - 1,
            oldEndLine: before - 1,
            newEndLine: after - 1,
            isAppend: true,
        });
    }

    public get eol(): EndOfLine {
        return this.eolValue;
    }

    /**
     * While the pass runs, the line whose end is not known yet is not counted — except when it is the only
     * one: a document always has a line, so a file without a `\n` in its first chunk shows what is read.
     */
    public get lineCount(): number {
        return this.tailKnown ? this.starts.count : Math.max(1, this.starts.count - 1);
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
        // Not `allocUnsafe`: below 4 KiB it slices node's shared pool, and growing a short page in place
        // ({@link growPage}) writes past its view — into someone else's bytes, if the page came from the pool.
        const buffer = Buffer.allocUnsafeSlow(this.pageSize);
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
