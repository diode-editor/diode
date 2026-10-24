import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeFileWatcher } from "../../../../../TestUtils/configurationLayersFixture.ts";
import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { memoryFileOpener } from "../../../../../TestUtils/memoryRandomAccessFile.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { enablePerformanceMarks, getMarks, resetPerformanceMarks } from "../../../../base/common/performance.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { type ILanguageService, NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { MAX_STRING_LENGTH } from "../../../../editor/common/model/diskTextBuffer.ts";
import { type ILargeFileOptions, MiB } from "../../../../editor/common/model/largeFileOptions.ts";
import type { IRandomAccessFileOpener } from "../../../../platform/files/common/iRandomAccessFile.ts";
import {
    NodeRandomAccessFile,
    nodeRandomAccessFileOpener,
} from "../../../../platform/files/node/nodeRandomAccessFile.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";

import { ORPHAN_CHECK_DELAY_MS, TextFileModel } from "./textFileModel.ts";

/** Above 1 MiB the file stays on disk; the line axis is left alone (it is decided on the built document). */
const ON_DISK: ILargeFileOptions = { largeFileOptimizations: true, sizeThresholdMb: 1, lineCountThreshold: 1_000_000 };

const LINE = "2026-01-01T00:00:00.000Z INFO worker request handled path=/api/v1/items";

/** Every file is a log: the document on disk must get the language the path resolves to. */
const LOG_LANGUAGE_SERVICE: ILanguageService = { ...NULL_LANGUAGE_SERVICE, getLanguageIdForResource: () => "log" };

/** ~1.2 MiB of log lines, numbered so any line can be checked. */
function bigLog(lines = 18_000): string {
    return Array.from({ length: lines }, (_, i) => `${String(i)} ${LINE}`).join("\n") + "\n";
}

function indexed(model: TextFileModel): Promise<void> {
    if (model.diskIndexing?.done !== false) return Promise.resolve();
    return new Promise((resolve) => {
        const subscription = model.onDidChangeDiskIndexing(() => {
            if (model.diskIndexing?.done !== true) return;
            subscription.dispose();
            resolve();
        });
    });
}

describe("TextFileModel — the document on disk", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-textfile-on-disk-" });
    });
    afterEach(() => {
        resetPerformanceMarks();
        ws.dispose();
    });

    function model(opener: IRandomAccessFileOpener | null = nodeRandomAccessFileOpener): TextFileModel {
        const result = new TextFileModel(LOG_LANGUAGE_SERVICE, new UndoRedoService(), diskFileService());
        result.largeFileOptions = () => ON_DISK;
        result.randomAccessFiles = opener;
        return result;
    }

    function open(name: string, content: string | Buffer, opener?: IRandomAccessFileOpener | null): TextFileModel {
        const result = model(opener);
        const path = ws.path(name);
        fs.writeFileSync(path, content);
        result.openFile(Uri.file(path));
        return result;
    }

    it("above the size threshold the file stays on disk, read-only, in the large-file mode; the lines read back", async () => {
        enablePerformanceMarks();
        const big = open("big.log", bigLog());
        expect(big.isOnDisk).toBe(true);
        expect(big.isTooLargeForTokenization).toBe(true);
        expect(big.isModified).toBe(false);
        expect(big.encoding).toBe("utf8");
        expect(big.onDiskDeclinedReason).toBeNull();
        // The first 4 MiB chunk holds the whole file: indexed at open, no growth to wait for.
        expect(big.diskIndexing).toMatchObject({ done: true, totalBytes: fs.statSync(ws.path("big.log")).size });
        expect(big.document.lineCount).toBe(18_001);
        expect(big.document.getLineContent(0)).toBe(`0 ${LINE}`);
        expect(big.document.getLineContent(17_999)).toBe(`17999 ${LINE}`);
        expect(big.document.getLineContent(18_000)).toBe("");
        expect(big.languageId).toBe("log");
        // The startup ladder sees the same marks as the in-memory path, with the first chunk's figures.
        const size = fs.statSync(ws.path("big.log")).size;
        expect(getMarks().map((mark) => [mark.name, mark.detail])).toEqual([
            ["textfile:read", { bytes: size }],
            ["textfile:decoded", { chars: size - 18_000 }],
            ["textfile:document-built", { lines: 18_001 }],
        ]);
        await indexed(big);
        big.dispose();
    });

    it("without an opener, or below the threshold, the file is read into memory as before", () => {
        // In memory and still in the mode: the in-memory path decides by characters, as 4.1 did.
        const noOpener = open("a.log", bigLog(), null);
        expect(noOpener.isOnDisk).toBe(false);
        expect(noOpener.isTooLargeForTokenization).toBe(true);
        expect(noOpener.document.lineCount).toBe(18_001);
        // Enable Editing on an in-memory model has no file to load: the mode just goes.
        expect(noOpener.forcefullyEnableFeatures()).toBe(true);
        expect(noOpener.isTooLargeForTokenization).toBe(false);

        const small = open("small.log", "one\ntwo");
        expect(small.isOnDisk).toBe(false);
        expect(small.document.getText()).toBe("one\ntwo");
        // Not in the mode: Enable Editing has nothing to do and says so.
        expect(small.forcefullyEnableFeatures()).toBe(true);
        expect(small.isTooLargeForTokenization).toBe(false);
        noOpener.dispose();
        small.dispose();
    });

    it("the index grows in the background: the line count follows it and the model relays progress", async () => {
        // The file reports twice its bytes: the pass has a tail to read, which turns out empty.
        const opener = memoryFileOpener({ size: 2 * 1024 * 1024 * 2 });
        const big = open("big.log", bigLog(), opener);
        expect(big.diskIndexing?.done).toBe(false);
        // The open line (the last one) is not counted until the pass ends.
        expect(big.document.lineCount).toBe(18_000);
        let progressEvents = 0;
        big.onDidChangeDiskIndexing(() => progressEvents++);
        await indexed(big);
        expect(progressEvents).toBeGreaterThan(0);
        expect(big.document.lineCount).toBe(18_001);
        big.dispose();
        expect(opener.opened[0].disposed).toBe(true);
    });

    it("a UTF-16 file above the threshold takes the old path, with the reason for the toast", () => {
        const opener = memoryFileOpener();
        const utf16 = open(
            "wide.log",
            Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(bigLog(), "utf16le")]),
            opener,
        );
        expect(utf16.isOnDisk).toBe(false);
        expect(utf16.isTooLargeForTokenization).toBe(true);
        expect(utf16.onDiskDeclinedReason).toBe("encoding");
        expect(utf16.encoding).toBe("utf16le");
        expect(utf16.document.getLineContent(5)).toBe(`5 ${LINE}`);
        // The descriptor opened for the sniff is closed again.
        expect(opener.opened.map((file) => file.disposed)).toEqual([true]);
        utf16.dispose();
    });

    it("a utf-8 BOM is skipped and reported as the encoding", () => {
        const bom = open("bom.log", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(bigLog())]));
        expect(bom.isOnDisk).toBe(true);
        expect(bom.encoding).toBe("utf8bom");
        expect(bom.document.getLineContent(0)).toBe(`0 ${LINE}`);
        bom.dispose();
    });

    it("an external change re-opens the document on disk: the old descriptor is closed, the text is the new file", () => {
        const opener = memoryFileOpener();
        const big = open("big.log", bigLog(), opener);
        fs.writeFileSync(ws.path("big.log"), bigLog(20_000));
        expect(big.revertToDisk()).toBe(true);
        expect(big.isOnDisk).toBe(true);
        expect(big.document.lineCount).toBe(20_001);
        expect(opener.opened).toHaveLength(2);
        expect(opener.opened[0].disposed).toBe(true);
        expect(opener.opened[1].disposed).toBe(false);
        big.dispose();
        expect(opener.opened[1].disposed).toBe(true);
    });

    it("a file gone and back: the orphan flag ends with the reopen on disk", () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        try {
            const watcher = new FakeFileWatcher();
            const big = model();
            big.fileWatcher = watcher;
            const path = ws.path("big.log");
            fs.writeFileSync(path, bigLog());
            big.openFile(Uri.file(path));

            // Gone and confirmed gone; back bigger — reopened on disk, no longer an orphan.
            fs.rmSync(path);
            watcher.fire(path);
            vi.advanceTimersByTime(ORPHAN_CHECK_DELAY_MS);
            expect(big.isOrphaned).toBe(true);
            fs.writeFileSync(path, bigLog(20_000));
            watcher.fire(path);
            expect(big.isOrphaned).toBe(false);
            expect(big.isOnDisk).toBe(true);
            expect(big.document.lineCount).toBe(20_001);
            big.dispose();
        } finally {
            vi.useRealTimers();
        }
    });

    it("a reload of a file that shrank below the threshold goes into memory, the mode stays (decided once)", () => {
        const big = open("big.log", bigLog());
        fs.writeFileSync(ws.path("big.log"), "tiny");
        expect(big.revertToDisk()).toBe(true);
        expect(big.isOnDisk).toBe(false);
        expect(big.isTooLargeForTokenization).toBe(true);
        expect(big.document.getText()).toBe("tiny");

        // And the other way: a small file that grows is reloaded into memory, the mode never turns on later.
        const small = open("small.log", "tiny");
        fs.writeFileSync(ws.path("small.log"), bigLog());
        expect(small.revertToDisk()).toBe(true);
        expect(small.isOnDisk).toBe(false);
        expect(small.isTooLargeForTokenization).toBe(false);
        big.dispose();
        small.dispose();
    });

    it("save is a no-op that reports saved", async () => {
        const path = ws.path("big.log");
        const big = open("big.log", bigLog());
        const before = fs.statSync(path).mtimeMs;
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(await big.save()).toBe("saved");
        expect(fs.statSync(path).mtimeMs).toBe(before);
        big.dispose();
    });

    it("Save As copies the file byte for byte and the model reopens on disk at the new path", async () => {
        const content = Buffer.concat([
            Buffer.from([0xef, 0xbb, 0xbf]),
            Buffer.from(bigLog().replaceAll("\n", "\r\n")),
        ]);
        const opener = memoryFileOpener();
        const big = open("big.log", content, opener);
        let saved = 0;
        big.onDidSaveDocument(() => saved++);
        await big.saveAs(ws.path("copy.log"));
        expect(fs.readFileSync(ws.path("copy.log")).equals(content)).toBe(true);
        expect(big.uri.fsPath).toBe(ws.path("copy.log"));
        expect(big.isOnDisk).toBe(true);
        expect(big.isModified).toBe(false);
        expect(big.encoding).toBe("utf8bom");
        expect(big.document.getLineContent(17_999)).toBe(`17999 ${LINE}`);
        expect(saved).toBe(1);
        // The old descriptor is closed: the lines come from the file the model names.
        expect(opener.opened.map((file) => file.disposed)).toEqual([true, false]);

        // Onto itself: nothing to copy, the model stays.
        await big.saveAs(ws.path("copy.log"));
        expect(fs.readFileSync(ws.path("copy.log")).equals(content)).toBe(true);
        expect(saved).toBe(2);
        big.dispose();
    });

    it("Save As over an existing file replaces it; a new path the opener refuses is read into memory", async () => {
        fs.writeFileSync(ws.path("taken.log"), "old content");
        const big = open("big.log", bigLog());
        await big.saveAs(ws.path("taken.log"));
        expect(fs.readFileSync(ws.path("taken.log"), "utf8")).toBe(bigLog());

        let opens = 0;
        const opener = memoryFileOpener();
        const refusingCopies: IRandomAccessFileOpener = {
            open: (path) => {
                if (opens++ > 0) throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
                return opener.open(path);
            },
        };
        const other = open("other.log", bigLog(), refusingCopies);
        await other.saveAs(ws.path("unreadable.log"));
        expect(other.isOnDisk).toBe(false);
        expect(other.uri.fsPath).toBe(ws.path("unreadable.log"));
        expect(other.document.getLineContent(17_999)).toBe(`17999 ${LINE}`);
        expect(other.isModified).toBe(false);
        big.dispose();
        other.dispose();
    });

    it("Enable Editing streams the file into memory first: the document leaves the disk and the mode", async () => {
        const opener = memoryFileOpener();
        const big = open("big.log", bigLog(), opener);
        let fired = 0;
        big.onDidChangeTooLargeForTokenization(() => fired++);
        // The synchronous door refuses a document on disk: its text has to come in first.
        expect(big.forcefullyEnableFeatures()).toBe(false);
        expect(fired).toBe(0);
        expect(await big.enableEditing()).toBeNull();
        expect(big.isOnDisk).toBe(false);
        expect(big.isTooLargeForTokenization).toBe(false);
        expect(fired).toBe(1);
        expect(opener.opened[0].disposed).toBe(true);
        expect(big.document.lineCount).toBe(18_001);
        expect(big.document.getLineContent(3)).toBe(`3 ${LINE}`);
        expect(big.isModified).toBe(false);
        big.dispose();
    });

    it("Enable Editing refuses a file no string can hold: it stays on disk and read-only", async () => {
        const opener = memoryFileOpener({ size: MAX_STRING_LENGTH + 1 });
        const big = open("big.log", bigLog(), opener);
        await indexed(big);
        let fired = 0;
        big.onDidChangeTooLargeForTokenization(() => fired++);
        expect(await big.enableEditing()).toBe("too-large");
        expect(big.isOnDisk).toBe(true);
        expect(big.isTooLargeForTokenization).toBe(true);
        expect(fired).toBe(0);
        // Refused before a byte is read: no descriptor beyond the document's own.
        expect(opener.opened).toHaveLength(1);
        big.dispose();

        // Exactly the limit still fits a string.
        const atLimit = open("limit.log", bigLog(), memoryFileOpener({ size: MAX_STRING_LENGTH }));
        await indexed(atLimit);
        expect(await atLimit.enableEditing()).toBeNull();
        expect(atLimit.isOnDisk).toBe(false);
        atLimit.dispose();
    });

    it("Reopen with Encoding reads the file into memory the old way", async () => {
        const big = open("big.log", bigLog());
        expect(await big.reopenWithEncoding("windows1251")).toBe(true);
        expect(big.isOnDisk).toBe(false);
        expect(big.encoding).toBe("windows1251");
        expect(big.isTooLargeForTokenization).toBe(true);
        expect(big.document.lineCount).toBe(18_001);
        big.dispose();
    });

    it("an unreadable path falls back to the old path, which reports the error as before", () => {
        const refusing: IRandomAccessFileOpener = {
            open: () => {
                throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
            },
        };
        const big = open("big.log", bigLog(), refusing);
        expect(big.isOnDisk).toBe(false);
        expect(big.document.lineCount).toBe(18_001);
        big.dispose();
        // A failure that is not the file system's is a bug and surfaces.
        const broken: IRandomAccessFileOpener = {
            open: () => {
                throw new TypeError("not a file system error");
            },
        };
        expect(() => open("big2.log", bigLog(), broken)).toThrow(TypeError);
    });

    it("dispose closes the descriptor", () => {
        const path = ws.path("big.log");
        fs.writeFileSync(path, bigLog());
        const opened: NodeRandomAccessFile[] = [];
        const tracking: IRandomAccessFileOpener = {
            open: (p) => {
                const file = new NodeRandomAccessFile(p);
                opened.push(file);
                return file;
            },
        };
        const big = model(tracking);
        big.openFile(Uri.file(path));
        expect(opened).toHaveLength(1);
        big.dispose();
        expect(() => opened[0].readSync(Buffer.alloc(1), 0)).toThrow(/closed/);
    });

    it("the size axis counts bytes: a file at the threshold is in memory, one byte more is on disk", () => {
        const at = open("at.log", "x".repeat(MiB));
        const above = open("above.log", "x".repeat(MiB + 1));
        expect(at.isOnDisk).toBe(false);
        expect(above.isOnDisk).toBe(true);
        at.dispose();
        above.dispose();
    });
});
