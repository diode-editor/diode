import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeFileWatcher } from "../../../../../TestUtils/configurationLayersFixture.ts";
import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { type ILanguageService, NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import type { IDocumentContentChange } from "../../../../editor/common/model/iDocumentContentChange.ts";
import type { ILargeFileOptions } from "../../../../editor/common/model/largeFileOptions.ts";
import { nodeRandomAccessFileOpener } from "../../../../platform/files/node/nodeRandomAccessFile.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";

import { TextFileModel } from "./textFileModel.ts";

/** Above 1 MiB the file stays on disk. */
const ON_DISK: ILargeFileOptions = { largeFileOptimizations: true, sizeThresholdMb: 1, lineCountThreshold: 1_000_000 };
const LINE = "2026-01-01T00:00:00.000Z INFO worker request handled path=/api/v1/items";
const LOG_LANGUAGE_SERVICE: ILanguageService = { ...NULL_LANGUAGE_SERVICE, getLanguageIdForResource: () => "log" };

/** ~1.2 MiB of numbered log lines. */
function bigLog(lines = 18_000, from = 0): string {
    return Array.from({ length: lines }, (_, i) => `${String(from + i)} ${LINE}`).join("\n") + "\n";
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

/** Touch the file's mtime past the stat's resolution: a same-second write would look unchanged. */
function bumpMtime(path: string): void {
    const future = new Date(fs.statSync(path).mtimeMs + 2000);
    fs.utimesSync(path, future, future);
}

describe("TextFileModel — follow: the file under the document on disk grows", () => {
    let ws: ITempWorkspace;
    let watcher: FakeFileWatcher;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-textfile-follow-" });
        watcher = new FakeFileWatcher();
    });
    afterEach(() => {
        ws.dispose();
    });

    async function open(name = "big.log", content = bigLog()) {
        const model = new TextFileModel(LOG_LANGUAGE_SERVICE, new UndoRedoService(), diskFileService());
        model.largeFileOptions = () => ON_DISK;
        model.randomAccessFiles = nodeRandomAccessFileOpener;
        model.fileWatcher = watcher;
        const path = ws.path(name);
        fs.writeFileSync(path, content);
        model.openFile(Uri.file(path));
        await indexed(model);
        const changes: IDocumentContentChange[] = [];
        model.document.onDidChangeContent((change) => changes.push(change));
        let diskStateChanges = 0;
        model.onDidChangeDiskState(() => diskStateChanges++);
        return { model, path, changes, diskStateChanges: () => diskStateChanges, disk: model.document.onDisk };
    }

    it("lines appended to the file arrive as growth of the same document: no reload, no version bump", async () => {
        const { model, path, changes, disk, diskStateChanges } = await open();
        expect(model.document.lineCount).toBe(18_001);
        const version = model.document.versionId;
        fs.appendFileSync(path, bigLog(3, 18_000));
        bumpMtime(path);
        watcher.fire(path);

        expect(model.document.lineCount).toBe(18_004);
        expect(model.document.getLineContent(18_002)).toBe(`18002 ${LINE}`);
        expect(model.document.versionId).toBe(version);
        expect(model.document.onDisk).toBe(disk);
        expect(changes).toEqual([{ startLine: 18_000, oldEndLine: 18_000, newEndLine: 18_003, isAppend: true }]);
        expect(diskStateChanges()).toBe(0);
        expect(model.isModified).toBe(false);

        // A second growth builds on the first.
        fs.appendFileSync(path, "tail without a line feed");
        bumpMtime(path);
        watcher.fire(path);
        expect(model.document.lineCount).toBe(18_004);
        expect(model.document.getLineContent(18_003)).toBe("tail without a line feed");
        model.dispose();
    });

    it("the same event twice (the stat did not move) does nothing", async () => {
        const { model, path, changes } = await open();
        fs.appendFileSync(path, "x\n");
        bumpMtime(path);
        watcher.fire(path);
        watcher.fire(path);
        expect(changes).toHaveLength(1);
        model.dispose();
    });

    it("a truncated file is re-indexed from scratch: a reload, as before", async () => {
        const { model, path, changes, disk } = await open();
        fs.writeFileSync(path, bigLog(17_000));
        bumpMtime(path);
        watcher.fire(path);
        expect(model.document.lineCount).toBe(17_001);
        expect(changes[0]).toMatchObject({ isFlush: true });
        expect(model.document.onDisk).not.toBe(disk);
        model.dispose();
    });

    it("a rotated log (renamed, a bigger new file under the same name) is a reload, although the size grew", async () => {
        const { model, path, changes } = await open();
        fs.renameSync(path, `${path}.1`);
        fs.writeFileSync(path, bigLog(19_000, 100_000));
        watcher.fire(path);
        expect(changes[0]).toMatchObject({ isFlush: true });
        expect(model.document.lineCount).toBe(19_001);
        expect(model.document.getLineContent(0)).toBe(`100000 ${LINE}`);
        model.dispose();
    });

    it("a file rewritten in place past its old size, with a different tail, is a reload: the buffer's tail check", async () => {
        const { model, path, changes } = await open();
        // The end was on screen: its page is cached.
        expect(model.document.getLineContent(17_999)).toBe(`17999 ${LINE}`);
        fs.writeFileSync(path, bigLog(17_999) + "REWRITTEN\n" + bigLog(5, 18_000));
        bumpMtime(path);
        watcher.fire(path);
        expect(changes[0]).toMatchObject({ isFlush: true });
        expect(model.document.getLineContent(17_999)).toBe("REWRITTEN");
        model.dispose();
    });

    it("the same size with a new mtime (touched, or rewritten byte for byte) is a reload, as before", async () => {
        const { model, path, changes } = await open();
        bumpMtime(path);
        watcher.fire(path);
        expect(changes[0]).toMatchObject({ isFlush: true });
        model.dispose();
    });

    it("growth while the index is still being built is picked up by the pass", async () => {
        const model = new TextFileModel(LOG_LANGUAGE_SERVICE, new UndoRedoService(), diskFileService());
        model.largeFileOptions = () => ON_DISK;
        model.randomAccessFiles = nodeRandomAccessFileOpener;
        model.fileWatcher = watcher;
        const path = ws.path("growing.log");
        fs.writeFileSync(path, bigLog(60_000));
        model.openFile(Uri.file(path));
        expect(model.diskIndexing?.done).toBe(false);
        fs.appendFileSync(path, bigLog(2, 60_000));
        bumpMtime(path);
        watcher.fire(path);
        await indexed(model);
        expect(model.document.lineCount).toBe(60_003);
        expect(model.document.getLineContent(60_001)).toBe(`60001 ${LINE}`);
        model.dispose();
    });

    it("a document in memory (below the threshold) reloads on growth, as before", async () => {
        const { model, path, changes } = await open("small.log", bigLog(10));
        expect(model.isOnDisk).toBe(false);
        fs.appendFileSync(path, bigLog(2, 10));
        bumpMtime(path);
        watcher.fire(path);
        expect(changes[0]).toMatchObject({ isFlush: true });
        expect(model.document.lineCount).toBe(13);
        model.dispose();
    });
});
