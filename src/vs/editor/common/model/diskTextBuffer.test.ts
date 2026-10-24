import { constants } from "node:buffer";

import { describe, expect, it } from "vitest";

import { MemoryRandomAccessFile } from "../../../../TestUtils/memoryRandomAccessFile.ts";
import { EndOfLine } from "../core/endOfLine.ts";
import { createRange } from "../core/iRange.ts";

import { DiskTextBuffer, type IDiskTextBufferOptions, MAX_STRING_LENGTH } from "./diskTextBuffer.ts";
import type { IDocumentContentChange } from "./iDocumentContentChange.ts";
import { SNAPSHOT_CHUNK_LENGTH } from "./pieceTreeDocumentBuffer.ts";
import { TextDocument } from "./textDocument.ts";

function open(
    text: string,
    options: IDiskTextBufferOptions = {},
): { buffer: DiskTextBuffer; file: MemoryRandomAccessFile } {
    const file = new MemoryRandomAccessFile(Buffer.from(text, "utf8"));
    return {
        buffer: new DiskTextBuffer(file, { chunkSize: 4, pageSize: 3, cachedPages: 2, lineByteCap: 64, ...options }),
        file,
    };
}

const READ_ONLY = "the document on disk is read-only (Enable Editing loads it into memory)";

function indexed(buffer: DiskTextBuffer): Promise<void> {
    if (buffer.indexing.done) return Promise.resolve();
    return new Promise((resolve) => {
        const subscription = buffer.onDidChangeIndexing(() => {
            if (!buffer.indexing.done) return;
            subscription.dispose();
            resolve();
        });
        buffer.startIndexing();
    });
}

function lines(buffer: DiskTextBuffer): string[] {
    return Array.from({ length: buffer.lineCount }, (_, line) => buffer.getLineContent(line));
}

/** The piece tree is the reference for everything but a lone `\r`, which the disk buffer does not split on. */
function facts(buffer: { lineCount: number; getLineContent(l: number): string; eol: EndOfLine; serialize(): string }) {
    return {
        lines: Array.from({ length: buffer.lineCount }, (_, line) => buffer.getLineContent(line)),
        eol: buffer.eol,
        serialized: buffer.serialize(),
    };
}

describe("DiskTextBuffer", () => {
    const SAMPLES = [
        "",
        "a",
        "a\n",
        "\n",
        "\n\n",
        "ab\ncd\nef",
        "ab\r\ncd\r\n",
        "ab\r\ncd\nef\r\n",
        "😀\n𝄞\nαβγ δ\n",
        "x\n\n\ny",
    ];

    for (const sample of SAMPLES) {
        it(`${JSON.stringify(sample)}: lines, eol, text as the piece tree, under any chunk and page size`, async () => {
            const reference = facts(new TextDocument(sample));
            for (const chunkSize of [1, 2, 3, 5, 64]) {
                for (const pageSize of [1, 2, 4, 64]) {
                    const { buffer } = open(sample, { chunkSize, pageSize });
                    await indexed(buffer);
                    expect(facts(buffer), `chunk ${String(chunkSize)} page ${String(pageSize)}`).toEqual(reference);
                    expect(
                        buffer.getValueInRange(
                            createRange(0, 0, buffer.lineCount - 1, buffer.getLineLength(buffer.lineCount - 1)),
                        ),
                    ).toBe(new TextDocument(sample).getText());
                    buffer.dispose();
                }
            }
        });
    }

    it("the first chunk is indexed synchronously: complete lines show before the pass starts", () => {
        const { buffer, file } = open("one\ntwo\nthree\nfour\n", { chunkSize: 9 });
        // "one\ntwo\nt" — two complete lines; "t…" is open and not counted.
        expect(buffer.lineCount).toBe(2);
        expect(lines(buffer)).toEqual(["one", "two"]);
        expect(buffer.indexing).toEqual({ indexedBytes: 9, totalBytes: 19, done: false, error: null });
        expect(file.asyncReads).toBe(0);
        buffer.dispose();
    });

    it("grows chunk by chunk: each event is a change on the last line, the final one adds the last line", async () => {
        const { buffer } = open("one\ntwo\nthree\nfour\n", { chunkSize: 9 });
        const events: IDocumentContentChange[] = [];
        const counts: number[] = [];
        let progress = 0;
        buffer.onDidAppendLines((change) => {
            events.push(change);
            counts.push(buffer.lineCount);
        });
        buffer.onDidChangeIndexing(() => progress++);
        await indexed(buffer);
        // Chunk 2 ("hree\nfour") completes "three", chunk 3 ("\n") completes "four"; the end of the
        // file makes the empty last line final.
        expect(events).toEqual([
            { startLine: 1, oldEndLine: 1, newEndLine: 2 },
            { startLine: 2, oldEndLine: 2, newEndLine: 3 },
            { startLine: 3, oldEndLine: 3, newEndLine: 4 },
        ]);
        expect(counts).toEqual([3, 4, 5]);
        // Progress: one per chunk read, one for the end.
        expect(progress).toBe(3);
        expect(lines(buffer)).toEqual(["one", "two", "three", "four", ""]);
        expect(buffer.indexing.done).toBe(true);
        buffer.dispose();
    });

    it("a file without a line feed in its first chunk still has one line, showing what is read so far", async () => {
        const { buffer } = open("abcdefgh", { chunkSize: 3 });
        expect(buffer.lineCount).toBe(1);
        expect(buffer.getLineContent(0)).toBe("abc");
        const events: IDocumentContentChange[] = [];
        buffer.onDidAppendLines((change) => events.push(change));
        await indexed(buffer);
        expect(buffer.getLineContent(0)).toBe("abcdefgh");
        expect(events).toEqual([]);
        buffer.dispose();
    });

    it("startIndexing is idempotent and a no-op once the file is indexed", async () => {
        const { buffer, file } = open("a\nb\nc", { chunkSize: 2 });
        let progress = 0;
        buffer.onDidChangeIndexing(() => progress++);
        buffer.startIndexing();
        buffer.startIndexing();
        await indexed(buffer);
        // One pass: "a\n" was read at construction, "b\n" and "c" are two chunks — not four.
        expect(file.asyncReads).toBe(2);
        expect(progress).toBe(3);
        buffer.startIndexing();
        await new Promise((resolve) => setImmediate(resolve));
        expect(file.asyncReads).toBe(2);
        expect(progress).toBe(3);
        buffer.dispose();
    });

    it("a whole file in the first chunk is indexed at construction, with no pass", () => {
        const { buffer, file } = open("a\nb", { chunkSize: 64 });
        expect(buffer.indexing.done).toBe(true);
        expect(lines(buffer)).toEqual(["a", "b"]);
        buffer.startIndexing();
        expect(file.asyncReads).toBe(0);
        buffer.dispose();
    });

    it("CRLF is decided by the first line's end; a lone \\r stays in the line (unlike the piece tree)", async () => {
        const crlf = open("a\r\nb\nc", { chunkSize: 1 });
        await indexed(crlf.buffer);
        expect(crlf.buffer.eol).toBe(EndOfLine.CRLF);
        expect(lines(crlf.buffer)).toEqual(["a", "b", "c"]);
        expect(crlf.buffer.serialize()).toBe("a\r\nb\r\nc");

        const lf = open("a\nb\r\n", { chunkSize: 64 });
        expect(lf.buffer.eol).toBe(EndOfLine.LF);

        const lone = open("a\rb\nc", { chunkSize: 64 });
        expect(lines(lone.buffer)).toEqual(["a\rb", "c"]);
        for (const { buffer } of [crlf, lf, lone]) buffer.dispose();
    });

    it("a BOM is skipped: line 0 starts after it, the EOL check reads past it", () => {
        const { buffer } = open("﻿\r\nx", { bomLength: 3, chunkSize: 64 });
        expect(lines(buffer)).toEqual(["", "x"]);
        expect(buffer.eol).toBe(EndOfLine.CRLF);
        expect(buffer.getValueLength()).toBe(2);
        buffer.dispose();
    });

    it("getValueLength is the indexed bytes without BOM and line feeds, an upper bound of the characters", async () => {
        const { buffer } = open("ab\ncd\n😀", { chunkSize: 4 });
        // 4 bytes indexed: "ab\nc" → 3 content bytes.
        expect(buffer.getValueLength()).toBe(3);
        await indexed(buffer);
        expect(buffer.getValueLength()).toBe(8);
        buffer.dispose();
    });

    it("pages: a line inside one page is a view of it, a line across pages is joined; the LRU evicts the oldest", () => {
        const { buffer, file } = open("0123456789abcdefghij\nX", { chunkSize: 64, pageSize: 4, cachedPages: 2 });
        file.syncReads = 0;
        // Line 0 spans pages 0..4: five page reads; the cache keeps two of them.
        expect(buffer.getLineContent(0)).toBe("0123456789abcdefghij");
        expect(file.syncReads).toBe(5);
        // Line 1 ("X" at byte 21) is on page 5: one more read.
        expect(buffer.getLineContent(1)).toBe("X");
        expect(file.syncReads).toBe(6);
        // Page 5 is cached now: a second read of line 1 hits.
        expect(buffer.getLineLength(1)).toBe(1);
        expect(file.syncReads).toBe(6);
        buffer.dispose();
    });

    it("the LRU is by use, not by insertion: a hit keeps its page over an older untouched one", () => {
        const { buffer, file } = open("aaa\nbbb\nccc\nddd\n", { chunkSize: 64, pageSize: 4, cachedPages: 2 });
        // Lines 0..3 sit on pages 0..3. Pages 0 and 1 are in; the hit on page 0 makes page 1 the oldest.
        buffer.getLineContent(0);
        buffer.getLineContent(1);
        buffer.getLineContent(0);
        // Page 2 evicts page 1, not page 0.
        buffer.getLineContent(2);
        file.syncReads = 0;
        expect(buffer.getLineContent(0)).toBe("aaa");
        expect(file.syncReads).toBe(0);
        // Page 1 comes back and evicts page 2; page 0, just used, stays for one more hit.
        expect(buffer.getLineContent(1)).toBe("bbb");
        expect(file.syncReads).toBe(1);
        expect(buffer.getLineContent(0)).toBe("aaa");
        expect(file.syncReads).toBe(1);
        buffer.dispose();
    });

    it("the frame's line memo: content then length decode once; the memo drops when the pass moves on", async () => {
        // Three pages per line and a cache of two: without the memo the length would re-read the pages.
        const { buffer, file } = open("abcdef\ncd\nef", { chunkSize: 6, pageSize: 2, cachedPages: 2 });
        // No feed in the first chunk: nothing was read for the EOL check, the pages are cold.
        expect(file.syncReads).toBe(1);
        expect(buffer.getLineContent(0)).toBe("abcdef");
        expect(file.syncReads).toBe(4);
        expect(buffer.getLineLength(0)).toBe(6);
        expect(file.syncReads).toBe(4);
        await indexed(buffer);
        expect(lines(buffer)).toEqual(["abcdef", "cd", "ef"]);
        buffer.dispose();
    });

    it("a line longer than the byte cap is cut there", () => {
        const { buffer } = open("0123456789\nshort", { chunkSize: 64, lineByteCap: 4 });
        expect(buffer.getLineContent(0)).toBe("0123");
        expect(buffer.getLineLength(0)).toBe(4);
        expect(buffer.getLineContent(1)).toBe("shor");
        buffer.dispose();
    });

    it("getValueInRange joins lines with LF and slices the edges; a range of one line slices it", async () => {
        const { buffer } = open("ab\r\ncd\r\nef\r\n", { chunkSize: 64 });
        await indexed(buffer);
        expect(buffer.getValueInRange(createRange(0, 1, 2, 1))).toBe("b\ncd\ne");
        expect(buffer.getValueInRange(createRange(1, 0, 1, 2))).toBe("cd");
        expect(buffer.getValueInRange(createRange(1, 1, 1, 1))).toBe("");
        buffer.dispose();
    });

    it("serialize, getLinesContent and a multi-line range refuse above the string limit instead of building the text", async () => {
        const { buffer } = open("abc\ndef\nghi", { chunkSize: 64, maxStringLength: 5 });
        await indexed(buffer);
        expect(() => buffer.serialize()).toThrow("The document on disk is 11 bytes, more than a string can hold (5)");
        expect(() => buffer.getLinesContent()).toThrow(RangeError);
        expect(() => buffer.getValueInRange(createRange(0, 0, 2, 3))).toThrow(RangeError);
        // One line and a short range still work.
        expect(buffer.getValueInRange(createRange(1, 0, 1, 3))).toBe("def");
        expect(buffer.getValueInRange(createRange(0, 2, 1, 1))).toBe("c\nd");
        buffer.dispose();

        // Exactly the limit fits; the BOM does not count.
        const exact = open("ab\ncd", { chunkSize: 64, maxStringLength: 5 });
        expect(exact.buffer.serialize()).toBe("ab\ncd");
        const bom = open("\uFEFFab", { bomLength: 3, chunkSize: 64, maxStringLength: 2 });
        expect(bom.buffer.serialize()).toBe("ab");
        const bomOver = open("\uFEFFab", { bomLength: 3, chunkSize: 64, maxStringLength: 1 });
        expect(() => bomOver.buffer.serialize()).toThrow("is 2 bytes");
        exact.buffer.dispose();
        bom.buffer.dispose();
        bomOver.buffer.dispose();
    });

    it("createSnapshot yields the lines with the document EOL in chunks; the last line has no EOL", async () => {
        const { buffer } = open("a\r\nb\r\nc\r\n", { chunkSize: 64 });
        await indexed(buffer);
        expect([...buffer.createSnapshot()].join("")).toBe("a\r\nb\r\nc\r\n");
        expect(buffer.getLinesContent()).toEqual(["a", "b", "c", ""]);
        buffer.dispose();

        // 1 KiB lines: a chunk closes on the line that reaches SNAPSHOT_CHUNK_LENGTH, exactly, and the rest
        // is the last chunk — no empty one after it.
        const perChunk = SNAPSHOT_CHUNK_LENGTH / 1024;
        const text = Array.from({ length: perChunk + 2 }, () => "x".repeat(1023)).join("\n") + "\n";
        const big = open(text, { chunkSize: 1024 * 1024, pageSize: 1024 * 1024, lineByteCap: 2048 });
        await indexed(big.buffer);
        const chunks = [...big.buffer.createSnapshot()];
        expect(chunks.map((chunk) => chunk.length)).toEqual([SNAPSHOT_CHUNK_LENGTH, 2 * 1024]);
        expect(chunks.join("")).toBe(text);
        expect(big.buffer.serialize()).toBe(text);
        big.buffer.dispose();

        // The last line closes the chunk exactly: nothing is left for an empty chunk after it.
        const flushed =
            Array.from({ length: perChunk - 1 }, () => "x".repeat(1023)).join("\n") + "\n" + "y".repeat(1024);
        const flush = open(flushed, { chunkSize: 1024 * 1024, pageSize: 1024 * 1024, lineByteCap: 2048 });
        await indexed(flush.buffer);
        expect([...flush.buffer.createSnapshot()].map((chunk) => chunk.length)).toEqual([SNAPSHOT_CHUNK_LENGTH]);
        flush.buffer.dispose();
    });

    it("edits and an EOL change are refused: the document is read-only", () => {
        const { buffer } = open("a\nb", { chunkSize: 64 });
        // An Error instance, not a pattern: `toThrow(/re/)` passes on a thrown `undefined` (docs/TESTING.md).
        expect(() => buffer.applyEdits()).toThrow(new Error(`DiskTextBuffer.applyEdits: ${READ_ONLY}`));
        expect(() => {
            buffer.setEol();
        }).toThrow(new Error(`DiskTextBuffer.setEol: ${READ_ONLY}`));
        expect(buffer.isReadOnly).toBe(true);
        buffer.dispose();
    });

    it("a line index outside the document throws, the open line under the pass included", () => {
        const { buffer } = open("a\nb", { chunkSize: 64 });
        expect(() => buffer.getLineContent(2)).toThrow("Line index 2 out of bounds [0, 1]");
        expect(() => buffer.getLineContent(-1)).toThrow(/out of bounds/);
        buffer.dispose();
        // "ab\nc": line 1 is indexed but open — not a line of the document yet.
        const growing = open("ab\ncd", { chunkSize: 4 });
        expect(growing.buffer.lineCount).toBe(1);
        expect(() => growing.buffer.getLineContent(1)).toThrow("Line index 1 out of bounds [0, 0]");
        growing.buffer.dispose();
    });

    it("dispose stops the pass, drops the pages and closes the file; nothing fires afterwards", async () => {
        const { buffer, file } = open("a\nb\nc\nd\ne\nf\n", { chunkSize: 2 });
        let fired = 0;
        buffer.onDidAppendLines(() => fired++);
        buffer.onDidChangeIndexing(() => fired++);
        buffer.startIndexing();
        buffer.dispose();
        buffer.dispose();
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(file.disposals).toBe(1);
        expect(fired).toBe(0);
        // The read in flight is dropped, no other follows: nothing was indexed past the first chunk.
        expect(file.asyncReads).toBe(1);
        expect(buffer.indexing).toEqual({ indexedBytes: 2, totalBytes: 12, done: false, error: null });
    });

    it("a read that fails after dispose is not an error of the pass: the buffer is gone", async () => {
        const { buffer, file } = open("a\nb\nc\nd\ne\nf\n", { chunkSize: 2 });
        buffer.startIndexing();
        buffer.dispose();
        file.failAsync = new Error("EIO");
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(buffer.indexing).toMatchObject({ done: false, error: null });
    });

    it("a read error ends the pass: the indexed lines stay, the progress carries the error", async () => {
        const { buffer, file } = open("a\nb\nc\nd\n", { chunkSize: 4 });
        file.failAsync = new Error("EIO");
        await indexed(buffer);
        expect(buffer.indexing.done).toBe(true);
        expect(buffer.indexing.error).toBe(file.failAsync);
        // "a\nb\n" was indexed synchronously; the last line is then the open "" after the second feed.
        expect(lines(buffer)).toEqual(["a", "b", ""]);
        buffer.dispose();
    });

    it("a file truncated under the pass ends it with what was indexed", async () => {
        const { buffer, file } = open("a\nb\nc\nd\ne\n", { chunkSize: 4 });
        file.visibleSize = 4;
        let progress = 0;
        buffer.onDidChangeIndexing(() => progress++);
        await indexed(buffer);
        expect(buffer.indexing.done).toBe(true);
        expect(buffer.indexing.error).toBeNull();
        expect(lines(buffer)).toEqual(["a", "b", ""]);
        // The empty read ends the pass: no read of the second chunk, one event for the end.
        expect(file.asyncReads).toBe(1);
        expect(progress).toBe(1);
        buffer.dispose();
    });

    it("MAX_STRING_LENGTH is node's limit for this platform", () => {
        expect(MAX_STRING_LENGTH).toBe(constants.MAX_STRING_LENGTH);
    });
});

describe("TextDocument over a DiskTextBuffer", () => {
    it("relays growth as a content change without a version bump or a model-content event; onDisk points at the buffer", async () => {
        const { buffer } = open("one\ntwo\nthree\n", { chunkSize: 5 });
        const doc = new TextDocument(buffer);
        expect(doc.onDisk).toBe(buffer);
        expect(new TextDocument("x").onDisk).toBeNull();
        const changes: IDocumentContentChange[] = [];
        let modelContentEvents = 0;
        doc.onDidChangeContent((change) => changes.push(change));
        doc.onDidChangeModelContent(() => modelContentEvents++);
        expect(doc.lineCount).toBe(1);
        await indexed(buffer);
        expect(doc.lineCount).toBe(4);
        expect(changes.length).toBeGreaterThan(0);
        expect(changes.every((change) => change.isFlush !== true)).toBe(true);
        expect(modelContentEvents).toBe(0);
        expect(doc.versionId).toBe(0);
        expect(doc.getText()).toBe("one\ntwo\nthree\n");
        expect(doc.getTextInRange(createRange(1, 0, 2, 2))).toBe("two\nth");
        expect(doc.getLineLength(2)).toBe(5);
    });

    it("refuses edits and an EOL change before anything moves", () => {
        const doc = new TextDocument(open("a\nb", { chunkSize: 64 }).buffer);
        const id = doc.deltaDecorations([], [{ range: createRange(1, 0, 1, 1), options: { description: "d" } }])[0];
        expect(() => doc.applyEdits([{ range: createRange(0, 0, 0, 0), text: "x" }])).toThrow(
            new Error(`TextDocument.applyEdits: ${READ_ONLY}`),
        );
        expect(() => {
            doc.setEol(EndOfLine.CRLF);
        }).toThrow(new Error(`TextDocument.setEol: ${READ_ONLY}`));
        expect(doc.versionId).toBe(0);
        expect(doc.getDecorationRange(id)).toEqual(createRange(1, 0, 1, 1));
        // No edits: nothing to refuse.
        expect(doc.applyEdits([])).toEqual({ appliedVersion: 0, inverseEdits: [] });
    });

    it("setText replaces the disk buffer with an in-memory one: the old buffer is disposed and its growth no longer arrives", async () => {
        const { buffer, file } = open("a\nb\nc\nd\n", { chunkSize: 2 });
        const doc = new TextDocument(buffer);
        const changes: IDocumentContentChange[] = [];
        doc.onDidChangeContent((change) => changes.push(change));
        doc.setText("in memory");
        expect(file.disposed).toBe(true);
        expect(doc.onDisk).toBeNull();
        expect(changes).toEqual([{ startLine: 0, oldEndLine: 0, newEndLine: 0, isFlush: true }]);
        expect(doc.versionId).toBe(1);
        expect(doc.getText()).toBe("in memory");
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(changes).toHaveLength(1);
    });

    it("the other way round too: a reload onto a disk buffer is one flush", async () => {
        const doc = new TextDocument("old\ntext");
        const { buffer } = open("x\ny\nz", { chunkSize: 64 });
        const changes: IDocumentContentChange[] = [];
        doc.onDidChangeContent((change) => changes.push(change));
        doc.setText(buffer);
        expect(changes).toEqual([{ startLine: 0, oldEndLine: 1, newEndLine: 2, isFlush: true }]);
        await indexed(buffer);
        expect(doc.getLinesContent()).toEqual(["x", "y", "z"]);
        expect(doc.onDisk).toBe(buffer);
    });
});
