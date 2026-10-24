import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeFileWatcher } from "../../../../../TestUtils/configurationLayersFixture.ts";
import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { memoryFileOpener, MemoryRandomAccessFile } from "../../../../../TestUtils/memoryRandomAccessFile.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { type ILanguageService, NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import type { ILargeFileOptions } from "../../../../editor/common/model/largeFileOptions.ts";
import type { IRandomAccessFileOpener } from "../../../../platform/files/common/iRandomAccessFile.ts";
import type { IMemoryProbe } from "../../../../platform/memory/common/iMemoryProbe.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";

import {
    type IMemoryLoadingProgress,
    MEMORY_PER_FILE_BYTE,
    MEMORY_RESERVE_BYTES,
    READ_CHUNK_SIZE,
    TextFileModel,
} from "./textFileModel.ts";

// "Enable Editing" on the document on disk streams the file into a piece tree (OpenPerformance 4.5), and so does a
// reload of a large file once it is in memory. These tests drive both through the model.

/** Above 1 MiB the file stays on disk; the line axis is left alone. */
const ON_DISK: ILargeFileOptions = { largeFileOptimizations: true, sizeThresholdMb: 1, lineCountThreshold: 1_000_000 };

const LOG_LANGUAGE_SERVICE: ILanguageService = { ...NULL_LANGUAGE_SERVICE, getLanguageIdForResource: () => "log" };

/**
 * More than two read chunks of numbered lines with Greek and an emoji in each: some chunk boundary cuts a
 * multibyte sequence, which the decoder must carry over.
 */
function multiChunkLog(): string {
    const lines: string[] = [];
    let bytes = 0;
    for (let i = 0; bytes < 2 * READ_CHUNK_SIZE + 12_345; i++) {
        const line = `${String(i)} αίτημα εξυπηρετήθηκε 🚀 path=/api/v1/items/${String(i)}`;
        lines.push(line);
        bytes += Buffer.byteLength(line) + 1;
    }
    return lines.join("\n") + "\n";
}

/** ~1.25 MiB of numbered ASCII lines: above the threshold, one read chunk. */
function bigLog(lines = 24_000): string {
    return (
        Array.from({ length: lines }, (_, i) => `${String(i)} INFO worker request handled path=/api/v1/items`).join(
            "\n",
        ) + "\n"
    );
}

/** Resolves when the model's stream into memory has ended and its caller has acted on the outcome (a tick later). */
async function streamed(model: TextFileModel): Promise<void> {
    if (model.memoryLoading !== null) {
        await new Promise<void>((resolve) => {
            const subscription = model.onDidChangeMemoryLoading(() => {
                if (model.memoryLoading !== null) return;
                subscription.dispose();
                resolve();
            });
        });
    }
    await new Promise((resolve) => setImmediate(resolve));
}

/** The first open is not gated (the document on disk indexes at once); every later one is, so the test steps the stream. */
function gatedAfterFirst(): IRandomAccessFileOpener & { readonly opened: MemoryRandomAccessFile[] } {
    const opened: MemoryRandomAccessFile[] = [];
    return {
        opened,
        open: (path) => {
            const file = new MemoryRandomAccessFile(fs.readFileSync(path), { gated: opened.length > 0 });
            opened.push(file);
            return file;
        },
    };
}

describe("TextFileModel — a large file streams into memory", () => {
    let ws: ITempWorkspace;
    const models: TextFileModel[] = [];

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-textfile-stream-" });
    });
    afterEach(() => {
        for (const model of models.splice(0)) model.dispose();
        ws.dispose();
    });

    function open(
        name: string,
        content: string | Buffer,
        opener: IRandomAccessFileOpener = memoryFileOpener(),
        memory: IMemoryProbe | null = null,
    ): TextFileModel {
        const model = new TextFileModel(LOG_LANGUAGE_SERVICE, new UndoRedoService(), diskFileService());
        models.push(model);
        model.largeFileOptions = () => ON_DISK;
        model.randomAccessFiles = opener;
        model.memory = memory;
        const path = ws.path(name);
        fs.writeFileSync(path, content);
        model.openFile(Uri.file(path));
        return model;
    }

    it("Enable Editing reads chunk by chunk with progress; the text and encoding are the file's, the language stays", async () => {
        const content = multiChunkLog();
        const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(content)]);
        const opener = gatedAfterFirst();
        const big = open("big.log", bytes, opener);
        expect(big.isOnDisk).toBe(true);
        // Picked by the user on the read-only document: the switch keeps it, the document is the same one.
        big.setLanguage("json");
        const progress: (IMemoryLoadingProgress | null)[] = [];
        big.onDidChangeMemoryLoading(() => progress.push(big.memoryLoading));
        let flushes = 0;
        big.document.onDidChangeModelContent((event) => {
            if (event.isFlush) flushes++;
        });

        const enabled = big.enableEditing();
        const stream = opener.opened[1];
        expect(big.memoryLoading).toEqual({ loadedBytes: 0, totalBytes: bytes.length });
        // The document on disk stays on screen, read-only, while the bytes come in.
        for (let chunk = 0; chunk < 3; chunk++) {
            expect(big.isOnDisk).toBe(true);
            await waitForPendingRead(stream);
            stream.release();
        }
        expect(await enabled).toBeNull();

        // The BOM is skipped: the reads start after it.
        expect(progress).toEqual([
            { loadedBytes: 0, totalBytes: bytes.length },
            { loadedBytes: 3 + READ_CHUNK_SIZE, totalBytes: bytes.length },
            { loadedBytes: 3 + 2 * READ_CHUNK_SIZE, totalBytes: bytes.length },
            { loadedBytes: bytes.length, totalBytes: bytes.length },
            null,
        ]);
        expect(big.isOnDisk).toBe(false);
        expect(big.isTooLargeForTokenization).toBe(false);
        expect(big.document.getText()).toBe(content);
        expect(big.encoding).toBe("utf8bom");
        expect(big.languageId).toBe("json");
        expect(big.isOrphaned).toBe(false);
        expect(big.isModified).toBe(false);
        // One flush: the switch to the piece tree is a single replacement.
        expect(flushes).toBe(1);
        expect(opener.opened.map((file) => file.disposed)).toEqual([true, true]);
    });

    it("a second Enable Editing while the file streams in waits for the same load", async () => {
        const opener = gatedAfterFirst();
        const big = open("big.log", bigLog(), opener);
        const first = big.enableEditing();
        const second = big.enableEditing();
        expect(second).toBe(first);
        await waitForPendingRead(opener.opened[1]);
        opener.opened[1].release();
        expect(await first).toBeNull();
        expect(opener.opened).toHaveLength(2);
        // Done: the next call is an ordinary file's no-op.
        expect(await big.enableEditing()).toBeNull();
        expect(opener.opened).toHaveLength(2);
    });

    it("not enough memory before the stream: refused at once, the document stays on disk", async () => {
        const content = bigLog();
        const needed = Buffer.byteLength(content) * MEMORY_PER_FILE_BYTE;
        const opener = memoryFileOpener();
        const short = open("short.log", content, opener, { availableBytes: () => needed - 1 });
        let fired = 0;
        short.onDidChangeTooLargeForTokenization(() => fired++);
        expect(await short.enableEditing()).toBe("out-of-memory");
        expect(short.isOnDisk).toBe(true);
        expect(short.isTooLargeForTokenization).toBe(true);
        expect(fired).toBe(0);
        expect(short.memoryLoading).toBeNull();
        // Nothing was read: the stream's descriptor is closed again.
        expect(opener.opened[1].asyncReads).toBe(0);
        expect(opener.opened[1].disposed).toBe(true);

        // A refusal is not remembered: with memory freed, the next click loads.
        let freed = false;
        const retry = open("retry.log", content, memoryFileOpener(), {
            availableBytes: () => (freed ? Number.MAX_SAFE_INTEGER : 0),
        });
        expect(await retry.enableEditing()).toBe("out-of-memory");
        freed = true;
        expect(await retry.enableEditing()).toBeNull();
        expect(retry.isOnDisk).toBe(false);

        // Exactly the bound is enough before the stream; while it streams, the reserve is what counts.
        let asked = 0;
        const exact = open("exact.log", content, memoryFileOpener(), {
            availableBytes: () => (asked++ === 0 ? needed : MEMORY_RESERVE_BYTES),
        });
        expect(await exact.enableEditing()).toBeNull();
    });

    it("a file that shrinks under the stream: what is still there is the text, and the progress stops with it", async () => {
        const content = Buffer.from(multiChunkLog());
        const opener = gatedAfterFirst();
        const big = open("big.log", content, opener);
        const progress: (IMemoryLoadingProgress | null)[] = [];
        big.onDidChangeMemoryLoading(() => progress.push(big.memoryLoading));
        const enabled = big.enableEditing();
        const stream = opener.opened[1];
        const left = READ_CHUNK_SIZE + 100;
        stream.visibleSize = left;
        for (let chunk = 0; chunk < 3; chunk++) {
            await waitForPendingRead(stream);
            stream.release();
        }
        expect(await enabled).toBeNull();
        expect(progress).toEqual([
            { loadedBytes: 0, totalBytes: content.length },
            { loadedBytes: READ_CHUNK_SIZE, totalBytes: content.length },
            { loadedBytes: left, totalBytes: content.length },
            null,
        ]);
        expect(big.document.getText()).toBe(content.subarray(0, left).toString("utf8"));
    });

    it("a file that ends inside a multibyte character ends with a replacement character, as a one-shot decode", async () => {
        const bytes = Buffer.concat([Buffer.from(bigLog()), Buffer.from([0xe2, 0x82])]);
        const big = open("cut.log", bytes);
        expect(await big.enableEditing()).toBeNull();
        const last = big.document.lineCount - 1;
        expect(big.document.getLineContent(last)).toBe("\ufffd");
    });

    it("memory running out while the file streams in stops the stream and refuses", async () => {
        const opener = gatedAfterFirst();
        let available = Number.MAX_SAFE_INTEGER;
        const big = open("big.log", multiChunkLog(), opener, { availableBytes: () => available });
        const enabled = big.enableEditing();
        const stream = opener.opened[1];
        await waitForPendingRead(stream);
        stream.release();
        await waitForPendingRead(stream);
        available = MEMORY_RESERVE_BYTES - 1;
        stream.release();
        expect(await enabled).toBe("out-of-memory");
        expect(big.isOnDisk).toBe(true);
        expect(big.memoryLoading).toBeNull();
        // Stopped at the chunk where memory ran out: the third chunk was never asked for.
        expect(stream.asyncReads).toBe(2);
        expect(stream.disposed).toBe(true);
    });

    it("a read error refuses and closes the stream; an error that is not the file system's surfaces", async () => {
        const failing = gatedAfterFirst();
        const big = open("big.log", bigLog(), failing);
        const enabled = big.enableEditing();
        failing.opened[1].failAsync = Object.assign(new Error("EIO: i/o error"), { code: "EIO" });
        await waitForPendingRead(failing.opened[1]);
        failing.opened[1].release();
        expect(await enabled).toBe("read-failed");
        expect(big.isOnDisk).toBe(true);
        expect(failing.opened[1].disposed).toBe(true);

        const broken = gatedAfterFirst();
        const other = open("other.log", bigLog(), broken);
        const rejected = other.enableEditing();
        broken.opened[1].failAsync = new TypeError("a bug");
        await waitForPendingRead(broken.opened[1]);
        broken.opened[1].release();
        await expect(rejected).rejects.toThrow(TypeError);
        expect(other.memoryLoading).toBeNull();

        // Node's own errors carry `ERR_*` codes: a bug in the call, not the file's state, so they surface too.
        const misused = gatedAfterFirst();
        const third = open("third.log", bigLog(), misused);
        const surfaced = third.enableEditing();
        misused.opened[1].failAsync = Object.assign(new Error("src and dest cannot be the same"), {
            code: "ERR_FS_CP_EINVAL",
        });
        await waitForPendingRead(misused.opened[1]);
        misused.opened[1].release();
        await expect(surfaced).rejects.toThrow(/cannot be the same/);
    });

    it("an opener that fails with a bug, not a file system error, surfaces it", async () => {
        let opens = 0;
        const opener = memoryFileOpener();
        const broken: IRandomAccessFileOpener = {
            open: (path) => {
                if (opens++ > 0) throw new TypeError("not a file system error");
                return opener.open(path);
            },
        };
        const big = open("big.log", bigLog(), broken);
        await expect(big.enableEditing()).rejects.toThrow(TypeError);
        expect(big.isOnDisk).toBe(true);
    });

    it("an unreadable file refuses before the stream starts", async () => {
        let opens = 0;
        const opener = memoryFileOpener();
        const refusing: IRandomAccessFileOpener = {
            open: (path) => {
                if (opens++ > 0) throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
                return opener.open(path);
            },
        };
        const big = open("big.log", bigLog(), refusing);
        expect(await big.enableEditing()).toBe("read-failed");
        expect(big.isOnDisk).toBe(true);
        expect(big.memoryLoading).toBeNull();
    });

    it("closing the model while the file streams in cancels the load and closes the stream", async () => {
        const opener = gatedAfterFirst();
        const big = open("big.log", bigLog(), opener);
        const enabled = big.enableEditing();
        await waitForPendingRead(opener.opened[1]);
        big.dispose();
        // The read fails once the model is gone: the load was cancelled, not refused.
        opener.opened[1].failAsync = Object.assign(new Error("EBADF: bad file descriptor"), { code: "EBADF" });
        opener.opened[1].release();
        expect(await enabled).toBe("cancelled");
        expect(opener.opened[1].disposed).toBe(true);
    });

    it("a file changed while it streamed in: the clean buffer reloads it after the switch", async () => {
        const watcher = new FakeFileWatcher();
        const opener = gatedAfterFirst();
        const model = new TextFileModel(LOG_LANGUAGE_SERVICE, new UndoRedoService(), diskFileService());
        models.push(model);
        model.largeFileOptions = () => ON_DISK;
        model.randomAccessFiles = opener;
        model.fileWatcher = watcher;
        const path = ws.path("growing.log");
        fs.writeFileSync(path, bigLog());
        model.openFile(Uri.file(path));

        const enabled = model.enableEditing();
        await waitForPendingRead(opener.opened[1]);
        // Appended while the stream reads the old bytes; the watcher's event has not arrived yet.
        fs.appendFileSync(path, "appended line\n");
        opener.opened[1].release();
        expect(await enabled).toBeNull();
        // The reload streams too: the file is still above the threshold.
        expect(model.memoryLoading).not.toBeNull();
        await waitForPendingRead(opener.opened[2]);
        opener.opened[2].release();
        await streamed(model);
        expect(model.document.getLineContent(24_000)).toBe("appended line");
        expect(model.isModified).toBe(false);
    });
});

describe("TextFileModel — a reload of a large file in memory streams", () => {
    let ws: ITempWorkspace;
    const models: TextFileModel[] = [];

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-textfile-stream-reload-" });
    });
    afterEach(() => {
        for (const model of models.splice(0)) model.dispose();
        ws.dispose();
    });

    /** A large file whose editing is enabled: in memory, out of the mode. */
    async function editable(
        opener: IRandomAccessFileOpener & { readonly opened: MemoryRandomAccessFile[] },
        memory: IMemoryProbe | null = null,
    ): Promise<{ model: TextFileModel; path: string }> {
        const model = new TextFileModel(LOG_LANGUAGE_SERVICE, new UndoRedoService(), diskFileService());
        models.push(model);
        model.largeFileOptions = () => ON_DISK;
        model.randomAccessFiles = opener;
        model.memory = memory;
        const path = ws.path("big.log");
        fs.writeFileSync(path, bigLog());
        model.openFile(Uri.file(path));
        const enabled = model.enableEditing();
        await waitForPendingRead(opener.opened[1]);
        opener.opened[1].release();
        expect(await enabled).toBeNull();
        return { model, path };
    }

    it("revert keeps the old text until the new one is in, then replaces it in one flush", async () => {
        const opener = gatedAfterFirst();
        const { model, path } = await editable(opener);
        // The encoding is sniffed again, like any reload: the file gained a BOM.
        fs.writeFileSync(path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(bigLog(30_000))]));
        let diskStateChanges = 0;
        model.onDidChangeDiskState(() => diskStateChanges++);

        expect(model.revertToDisk()).toBe(true);
        expect(model.memoryLoading).not.toBeNull();
        expect(model.document.lineCount).toBe(24_001);
        await waitForPendingRead(opener.opened[2]);
        opener.opened[2].release();
        await streamed(model);
        expect(model.document.lineCount).toBe(30_001);
        expect(model.document.getLineContent(0)).toBe("0 INFO worker request handled path=/api/v1/items");
        expect(model.encoding).toBe("utf8bom");
        expect(model.isOnDisk).toBe(false);
        expect(model.isTooLargeForTokenization).toBe(false);
        expect(diskStateChanges).toBe(1);
    });

    it("an edit while the new text streams in wins: the buffer stays as edited, in conflict with the disk", async () => {
        const opener = gatedAfterFirst();
        const { model, path } = await editable(opener);
        fs.writeFileSync(path, bigLog(30_000));
        model.revertToDisk();
        await waitForPendingRead(opener.opened[2]);
        model.document.applyEdits([
            { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "typed " },
        ]);
        opener.opened[2].release();
        await streamed(model);
        expect(model.document.lineCount).toBe(24_001);
        expect(model.document.getLineContent(0)).toBe(`typed 0 INFO worker request handled path=/api/v1/items`);
        expect(model.hasDiskConflict).toBe(true);
    });

    it("no memory for the new text: the buffer stays, in conflict with the disk", async () => {
        const opener = gatedAfterFirst();
        let available = Number.MAX_SAFE_INTEGER;
        const { model, path } = await editable(opener, { availableBytes: () => available });
        fs.writeFileSync(path, bigLog(30_000));
        available = 0;
        model.revertToDisk();
        await streamed(model);
        expect(model.document.lineCount).toBe(24_001);
        expect(model.hasDiskConflict).toBe(true);
    });

    it("a newer reload overtakes a pending one: the older finds itself stale and steps aside", async () => {
        const opener = gatedAfterFirst();
        const { model, path } = await editable(opener);
        fs.writeFileSync(path, bigLog(30_000));
        model.revertToDisk();
        await waitForPendingRead(opener.opened[2]);
        // A newer reload of the same file overtakes the pending one, which finds itself stale.
        model.revertToDisk();
        opener.opened[2].release();
        for (let tick = 0; tick < 50 && !opener.opened[2].disposed; tick++) {
            await new Promise((resolve) => setImmediate(resolve));
        }
        await new Promise((resolve) => setImmediate(resolve));
        // The stale one has ended: the newer load still owns the progress, and nothing is in conflict.
        expect(opener.opened[2].disposed).toBe(true);
        expect(model.memoryLoading).not.toBeNull();
        expect(model.hasDiskConflict).toBe(false);
        opener.opened[3].release();
        await streamed(model);
        expect(model.document.lineCount).toBe(30_001);
        expect(model.hasDiskConflict).toBe(false);
    });

    it("without an opener a large file in memory reloads synchronously, as before", async () => {
        const model = new TextFileModel(LOG_LANGUAGE_SERVICE, new UndoRedoService(), diskFileService());
        models.push(model);
        model.largeFileOptions = () => ON_DISK;
        const path = ws.path("plain.log");
        fs.writeFileSync(path, bigLog());
        model.openFile(Uri.file(path));
        expect(await model.enableEditing()).toBeNull();
        fs.writeFileSync(path, bigLog(30_000));
        expect(model.revertToDisk()).toBe(true);
        expect(model.memoryLoading).toBeNull();
        expect(model.document.lineCount).toBe(30_001);
    });

    it("a large buffer whose file is gone reloads the old way, which knows what a missing file is", async () => {
        const opener = gatedAfterFirst();
        const { model, path } = await editable(opener);
        fs.rmSync(path);
        expect(model.revertToDisk()).toBe(true);
        expect(model.memoryLoading).toBeNull();
        expect(opener.opened).toHaveLength(2);
    });

    it("a small file reloads synchronously, as before", async () => {
        const opener = gatedAfterFirst();
        const { model, path } = await editable(opener);
        fs.writeFileSync(path, "tiny");
        expect(model.revertToDisk()).toBe(true);
        expect(model.memoryLoading).toBeNull();
        expect(model.document.getText()).toBe("tiny");
    });
});

/** The stream's next read is issued on a later tick (after the previous chunk is taken in). */
async function waitForPendingRead(file: MemoryRandomAccessFile): Promise<void> {
    for (let tick = 0; tick < 50 && file.pendingReads === 0; tick++) {
        await new Promise((resolve) => setImmediate(resolve));
    }
    expect(file.pendingReads).toBe(1);
}
