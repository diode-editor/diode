import { describe, expect, it } from "vitest";

import { MemoryRandomAccessFile } from "../../../../TestUtils/memoryRandomAccessFile.ts";

import { DiskTextBuffer, type IDiskTextBufferOptions } from "./diskTextBuffer.ts";
import type { IDocumentContentChange } from "./iDocumentContentChange.ts";
import { PieceTreeDocumentBuffer } from "./pieceTreeDocumentBuffer.ts";

/** Small chunks and pages so that a few bytes cross every boundary. */
const OPTIONS: IDiskTextBufferOptions = { chunkSize: 8, pageSize: 4, cachedPages: 3, lineByteCap: 64 };

function open(text: string, options: IDiskTextBufferOptions = {}) {
    const file = new MemoryRandomAccessFile(Buffer.from(text, "utf8"));
    const buffer = new DiskTextBuffer(file, { ...OPTIONS, ...options });
    const events: IDocumentContentChange[] = [];
    buffer.onDidAppendLines((change) => events.push(change));
    let progress = 0;
    buffer.onDidChangeIndexing(() => progress++);
    return { buffer, file, events, progress: () => progress };
}

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

function expected(text: string): string[] {
    const tree = new PieceTreeDocumentBuffer(text);
    return Array.from({ length: tree.lineCount }, (_, line) => tree.getLineContent(line));
}

/** A grown file, opened and fully indexed; the tail is appended through {@link DiskTextBuffer.extendTo}. */
async function grown(initial: string, tail: string, options: IDiskTextBufferOptions = {}) {
    const opened = open(initial, options);
    await indexed(opened.buffer);
    opened.events.length = 0;
    opened.file.append(tail);
    const extended = opened.buffer.extendTo(opened.file.length);
    // A tail bigger than a chunk goes through a pass.
    await indexed(opened.buffer);
    return { ...opened, extended };
}

describe("DiskTextBuffer.extendTo — the file grew (follow)", () => {
    it("a tail of a few lines is appended at once: the lines, the size and the event match the piece tree", async () => {
        const { buffer, events, extended, progress } = await grown("a\nb\n", "c\nd\n");
        expect(extended).toBe(true);
        expect(lines(buffer)).toEqual(expected("a\nb\nc\nd\n"));
        expect(buffer.size).toBe(8);
        expect(buffer.indexing).toMatchObject({ indexedBytes: 8, totalBytes: 8, done: true });
        // The old last line (the empty one after `b\n`) through the new last line.
        expect(events).toEqual([{ startLine: 2, oldEndLine: 2, newEndLine: 4, isAppend: true }]);
        // The synchronous append is not indexing: no progress event, the status bar stays quiet.
        expect(progress()).toBe(0);
        buffer.dispose();
    });

    it("bytes without a line feed grow the last line in place: the count stands, the event is on that line", async () => {
        const { buffer, events } = await grown("a\nb", "cd");
        expect(lines(buffer)).toEqual(["a", "bcd"]);
        expect(events).toEqual([{ startLine: 1, oldEndLine: 1, newEndLine: 1, isAppend: true }]);
        buffer.dispose();
    });

    it("every tail is checked against the piece tree: CRLF, multibyte, boundaries of chunks and pages", async () => {
        const cases: [string, string][] = [
            ["a\r\nb\r\n", "c\r\nd\r\n"],
            ["a\r\nb", "\r\nc"],
            ["", "x\ny\n"],
            ["abcdefg", "h\nijklmnop\nq"],
            ["αβ\n", "γ\nδε\n"],
            ["one\ntwo\nthree\n", "\n\n\nfour"],
        ];
        for (const [initial, tail] of cases) {
            const { buffer, extended } = await grown(initial, tail);
            expect(extended, JSON.stringify([initial, tail])).toBe(true);
            expect(lines(buffer), JSON.stringify([initial, tail])).toEqual(expected(initial + tail));
            // A second growth on top of the first.
            const { buffer: twice } = await grown(initial + tail, tail);
            expect(lines(twice), JSON.stringify([initial, tail, tail])).toEqual(expected(initial + tail + tail));
            buffer.dispose();
            twice.dispose();
        }
    });

    it("the page that ended with the file is read again: a cached short last page does not hide the tail", async () => {
        const { buffer, file } = open("ab\ncd\nef\n");
        await indexed(buffer);
        // The last line sits on the last page (bytes 8..9): reading it caches that page, 1 byte long.
        expect(buffer.getLineContent(3)).toBe("");
        file.append("gh\nij\n");
        expect(buffer.extendTo(file.length)).toBe(true);
        expect(lines(buffer)).toEqual(["ab", "cd", "ef", "gh", "ij", ""]);
        buffer.dispose();
    });

    it("the page that ended with the file grows in place: the new tail is read once, into the page's room", async () => {
        const { buffer, file } = open("ab\ncd\n", { pageSize: 16 });
        await indexed(buffer);
        expect(buffer.getLineContent(1)).toBe("cd");
        const before = file.syncReads;
        file.append("ef\n");
        buffer.extendTo(file.length);
        // The tail check (the page is cached), the page's growth and the tail itself: three reads, no page re-read.
        expect(file.syncReads - before).toBe(3);
        expect(buffer.getLineContent(2)).toBe("ef");
        expect(buffer.getLineContent(3)).toBe("");
        expect(file.syncReads - before).toBe(3);
        buffer.dispose();
    });

    it("pages grown in place across several growths, spilling into the next page, read like the piece tree", async () => {
        const { buffer, file } = open("ab\ncd\n", { pageSize: 4, chunkSize: 64 });
        await indexed(buffer);
        let text = "ab\ncd\n";
        for (const tail of ["e", "f\ng", "hijklmnop\n", "q\nrs\ntu"]) {
            // The end is on screen: its page is cached before every growth.
            expect(buffer.getLineContent(buffer.lineCount - 1)).toBe(expected(text).at(-1));
            file.append(tail);
            text += tail;
            expect(buffer.extendTo(file.length)).toBe(true);
            expect(lines(buffer), JSON.stringify(text)).toEqual(expected(text));
        }
        buffer.dispose();
    });

    it("bytes written after the stat are left for the next growth: the read stops at the size as told", async () => {
        const { buffer, file, events } = await grown("ab\n", "");
        file.append("cd\nef\n");
        expect(buffer.extendTo(file.length - 3)).toBe(true);
        expect(lines(buffer)).toEqual(["ab", "cd", ""]);
        expect(buffer.indexing).toMatchObject({ indexedBytes: 6, totalBytes: 6 });
        expect(buffer.extendTo(file.length)).toBe(true);
        expect(lines(buffer)).toEqual(["ab", "cd", "ef", ""]);
        expect(events).toHaveLength(2);
        buffer.dispose();
    });

    it("a tail of exactly one chunk is still read at once", async () => {
        const { buffer, file } = await grown("a\n", "");
        file.append("x".repeat((OPTIONS.chunkSize ?? 0) - 1) + "\n");
        expect(buffer.extendTo(file.length)).toBe(true);
        expect(buffer.indexing.done).toBe(true);
        expect(buffer.lineCount).toBe(3);
        buffer.dispose();
    });

    it("growth during an extension pass is only recorded: the tail is read once, in order", async () => {
        const { buffer, file } = await grown("a\n", "");
        const first = Array.from({ length: 5 }, (_, i) => `first ${String(i)}`).join("\n") + "\n";
        file.append(first);
        expect(buffer.extendTo(file.length)).toBe(true);
        expect(buffer.indexing.done).toBe(false);
        // A small growth while that pass runs: not read on the thread, or the pass would index it twice.
        file.append("second\n");
        expect(buffer.extendTo(file.length)).toBe(true);
        expect(buffer.lineCount).toBe(2);
        await indexed(buffer);
        expect(lines(buffer)).toEqual(expected("a\n" + first + "second\n"));
        buffer.dispose();
    });

    it("the tail check looks at the page before the last when only that one is cached", async () => {
        // 12 bytes over pages of 4: "ab\nc" "d\nef" "\ngh\n". Reading "ef" caches page 1 (and page 0, for the EOL).
        const { buffer, file } = open("ab\ncd\nef\ngh\n");
        await indexed(buffer);
        expect(buffer.getLineContent(2)).toBe("ef");
        file.rewrite("ab\ncd\nXY\ngh\nij\n");
        expect(buffer.extendTo(file.length)).toBe(false);
        buffer.dispose();
    });

    it("a page read after a write but before its event is checked whole: rewritten bytes past the old end are caught", async () => {
        // Pages of 4: "ab\nc" (cached by the EOL check) and "d\n" — not read yet.
        const { buffer, file } = open("ab\ncd\n", { pageSize: 4 });
        await indexed(buffer);
        file.append("xx\n");
        // The frame reads "cd" before the watcher reports the growth: page 1 is cached as "d\nxx".
        expect(buffer.getLineContent(1)).toBe("cd");
        file.rewrite("ab\ncd\nyy\n");
        expect(buffer.extendTo(file.length)).toBe(false);
        buffer.dispose();

        // Not rewritten: the same page is an append, and the lines read the new bytes.
        const kept = open("ab\ncd\n", { pageSize: 4 });
        await indexed(kept.buffer);
        kept.file.append("xx\n");
        expect(kept.buffer.getLineContent(1)).toBe("cd");
        expect(kept.buffer.extendTo(kept.file.length)).toBe(true);
        expect(lines(kept.buffer)).toEqual(["ab", "cd", "xx", ""]);
        kept.buffer.dispose();
    });

    it("bytes past the size as told stay out of the index when a pass ends: its tail stops at the told size", async () => {
        const text = "line 0\nline 1\n";
        const file = new MemoryRandomAccessFile(Buffer.from(text), { gated: true });
        const buffer = new DiskTextBuffer(file, OPTIONS);
        buffer.startIndexing();
        const more = Array.from({ length: 4 }, (_, i) => `more ${String(i)}`).join("\n") + "\n";
        file.append(more + "late\n");
        // The stat was taken before "late\n" arrived.
        expect(buffer.extendTo(file.length - 5)).toBe(true);
        const done = indexed(buffer);
        file.openGate();
        await done;
        expect(buffer.indexing.indexedBytes).toBe(file.length - 5);
        expect(lines(buffer)).toEqual(expected(text + more));
        buffer.dispose();
    });

    it("the lines before the old end are not read again", async () => {
        const { buffer, file } = open("ab\ncd\nef\n");
        await indexed(buffer);
        const before = file.syncReads;
        file.append("gh\n");
        buffer.extendTo(file.length);
        // The tail check reads the bytes before the end only when their page is cached (it is not), then the
        // tail itself: one chunk.
        expect(file.syncReads - before).toBe(1);
        buffer.dispose();
    });

    it("a file truncated and rewritten past its old size is not an append: the cached tail differs, extendTo refuses", async () => {
        const { buffer, file, events } = open("ab\ncd\nef\n");
        await indexed(buffer);
        // "ef" is on the page before the last one (the last page holds only the final line feed, which no line
        // reads): the check looks there too.
        expect(buffer.getLineContent(2)).toBe("ef");
        events.length = 0;
        file.rewrite("ab\ncd\nXY\ngh\n");
        expect(buffer.extendTo(file.length)).toBe(false);
        // Nothing moved: the caller re-indexes from scratch.
        expect(buffer.size).toBe(9);
        expect(buffer.lineCount).toBe(4);
        expect(events).toEqual([]);
        buffer.dispose();
    });

    it("without the end's page in the cache the growth is trusted: a rewrite that keeps the prefix is an append by content", async () => {
        const { buffer, file } = open("ab\ncd\nef\n");
        await indexed(buffer);
        // Line 0 is on page 0; the last page is never read.
        expect(buffer.getLineContent(0)).toBe("ab");
        file.rewrite("ab\ncd\nef\ngh\n");
        expect(buffer.extendTo(file.length)).toBe(true);
        expect(lines(buffer)).toEqual(["ab", "cd", "ef", "gh", ""]);
        buffer.dispose();
    });

    it("a size that did not grow is a no-op", async () => {
        const { buffer, file, events } = open("ab\ncd\n");
        await indexed(buffer);
        events.length = 0;
        expect(buffer.extendTo(file.length)).toBe(true);
        expect(buffer.extendTo(file.length - 1)).toBe(true);
        expect(buffer.size).toBe(6);
        expect(events).toEqual([]);
        buffer.dispose();
    });

    it("a tail bigger than a chunk is read in a background pass: progress runs again, the lines arrive chunk by chunk", async () => {
        const { buffer, file, events, progress } = await grown("a\n", "");
        const tail = Array.from({ length: 10 }, (_, i) => `line ${String(i)}`).join("\n") + "\n";
        expect(Buffer.byteLength(tail)).toBeGreaterThan(OPTIONS.chunkSize ?? 0);
        file.append(tail);
        expect(buffer.extendTo(file.length)).toBe(true);
        expect(buffer.indexing).toMatchObject({
            indexedBytes: 2,
            totalBytes: 2 + Buffer.byteLength(tail),
            done: false,
        });
        // Nothing read yet: the pass is asynchronous.
        expect(buffer.lineCount).toBe(2);

        await indexed(buffer);
        expect(lines(buffer)).toEqual(expected("a\n" + tail));
        expect(buffer.indexing).toMatchObject({ indexedBytes: file.length, done: true, error: null });
        expect(progress()).toBeGreaterThan(1);
        // Every chunk fires a change on the last line, whether or not it brought a new line.
        expect(events.length).toBeGreaterThanOrEqual(2);
        for (const event of events) expect(event).toMatchObject({ isAppend: true });
        expect(events.at(-1)?.newEndLine).toBe(buffer.lineCount - 1);
        buffer.dispose();
    });

    it("growth while a pass runs only raises the size: the pass reads what arrived when its layout is done", async () => {
        const text = Array.from({ length: 6 }, (_, i) => `line ${String(i)}`).join("\n") + "\n";
        const file = new MemoryRandomAccessFile(Buffer.from(text), { gated: true });
        const buffer = new DiskTextBuffer(file, OPTIONS);
        buffer.startIndexing();
        expect(buffer.indexing.done).toBe(false);

        // More than two chunks arrive: the pass's layout does not cover them, its end reads them all.
        const more = "more\nand more\nand even more\n";
        file.append(more);
        expect(buffer.extendTo(file.length)).toBe(true);
        expect(buffer.indexing.totalBytes).toBe(file.length);

        const done = indexed(buffer);
        file.openGate();
        await done;
        expect(lines(buffer)).toEqual(expected(text + more));
        expect(buffer.indexing).toMatchObject({ indexedBytes: file.length, done: true });
        buffer.dispose();
    });

    it("growth before the pass started is read by the pass", async () => {
        const text = "line 0\nline 1\nline 2\n";
        const file = new MemoryRandomAccessFile(Buffer.from(text));
        const buffer = new DiskTextBuffer(file, OPTIONS);
        file.append("line 3\n");
        expect(buffer.extendTo(file.length)).toBe(true);
        await indexed(buffer);
        expect(lines(buffer)).toEqual(expected(text + "line 3\n"));
        buffer.dispose();
    });

    it("a file shorter than its stat said (truncated between stat and read): what is there is read, nothing throws", async () => {
        const { buffer, file } = open("ab\ncd\n");
        await indexed(buffer);
        file.append("ef\n");
        // The caller saw 3 more bytes than the file has now.
        expect(buffer.extendTo(file.length + 3)).toBe(true);
        expect(lines(buffer)).toEqual(["ab", "cd", "ef", ""]);
        expect(buffer.indexing.indexedBytes).toBe(file.length);
        buffer.dispose();
    });

    it("after a pass that failed, the rest is not read on the thread; the next growth starts a new pass that clears the error", async () => {
        const text = Array.from({ length: 6 }, (_, i) => `line ${String(i)}`).join("\n") + "\n";
        const file = new MemoryRandomAccessFile(Buffer.from(text));
        const buffer = new DiskTextBuffer(file, OPTIONS);
        file.failAsync = new Error("EIO");
        await indexed(buffer);
        expect(buffer.indexing.error).toBe(file.failAsync);
        const indexedAfterFailure = buffer.indexing.indexedBytes;
        expect(indexedAfterFailure).toBeLessThan(file.length);

        file.failAsync = null;
        const tail = "more\nand more\nand even more\n";
        file.append(tail);
        expect(buffer.extendTo(file.length)).toBe(true);
        await indexed(buffer);
        expect(buffer.indexing).toMatchObject({ indexedBytes: file.length, done: true, error: null });
        expect(lines(buffer)).toEqual(expected(text + tail));
        buffer.dispose();
    });

    it("dispose during an extension pass stops it", async () => {
        const { buffer, file } = await grown("a\n", "");
        file.append("x".repeat(100) + "\n");
        buffer.extendTo(file.length);
        expect(buffer.indexing.done).toBe(false);
        buffer.dispose();
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
        expect(buffer.lineCount).toBe(2);
    });
});
