import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IFileWatcher } from "../../../../platform/files/common/iFileWatcher.ts";

import { ORPHAN_CHECK_DELAY_MS, type TextFileModel } from "./textFileModel.ts";

class FakeFileWatcher implements IFileWatcher {
    private readonly handlers = new Map<string, () => void>();

    public watchFile(filePath: string, onChange: () => void): IDisposable {
        this.handlers.set(filePath, onChange);
        return { dispose: () => this.handlers.delete(filePath) };
    }

    public fire(filePath: string): void {
        this.handlers.get(filePath)?.();
    }
}

describe("TextFileModel — deleted file (orphaned)", () => {
    let ws: ITempWorkspace;
    let watcher: FakeFileWatcher;
    let pane: TextEditorPane<TextFileModel>;
    let orphanedEvents: number;
    let diskStateEvents: number;

    beforeEach(() => {
        // Fake only the timers under test: setImmediate stays real, since background
        // tokenization of the open buffer (DocumentTokenStore) runs on it, and its
        // queued chunk is not a leak of this scenario.
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
        ws = createTempWorkspace({ prefix: "diode-orphaned-" });
        watcher = new FakeFileWatcher();
        pane = createEditorPane();
        pane.model.fileWatcher = watcher;
        orphanedEvents = 0;
        diskStateEvents = 0;
    });

    afterEach(() => {
        pane.dispose();
        ws.dispose();
        vi.useRealTimers();
    });

    function open(name: string, content: string): string {
        const fp = ws.writeFile(name, content);
        pane.openFile(Uri.file(fp));
        pane.model.onDidChangeOrphaned(() => orphanedEvents++);
        pane.onDidChangeDiskState(() => diskStateEvents++);
        return fp;
    }

    function deleteExternally(fp: string): void {
        fs.rmSync(fp);
        watcher.fire(fp);
        vi.advanceTimersByTime(ORPHAN_CHECK_DELAY_MS);
    }

    /** By rename, like the trash: mtime and size stay identical to the nanosecond. */
    function trashAndRestore(fp: string): void {
        fs.renameSync(fp, `${fp}.trashed`);
        watcher.fire(fp);
        vi.advanceTimersByTime(ORPHAN_CHECK_DELAY_MS);
        expect(pane.model.isOrphaned).toBe(true);
        fs.renameSync(`${fp}.trashed`, fp);
        watcher.fire(fp);
    }

    it("a missing file after recheck is orphaned; the buffer text survives and is not dirty", () => {
        const fp = open("a.txt", "keep\n");

        fs.rmSync(fp);
        watcher.fire(fp);
        // Before the delay ends it is not yet a deletion (it may be an atomic write).
        vi.advanceTimersByTime(ORPHAN_CHECK_DELAY_MS - 1);
        expect(pane.model.isOrphaned).toBe(false);
        expect(orphanedEvents).toBe(0);

        vi.advanceTimersByTime(1);
        expect(pane.model.isOrphaned).toBe(true);
        expect(orphanedEvents).toBe(1);
        expect(diskStateEvents).toBe(1);
        expect(pane.getText()).toBe("keep\n");
        expect(pane.isModified).toBe(false);
    });

    it("a file that returns within the delay (atomic write) is not orphaned, the clean buffer is reread", () => {
        const fp = open("a.txt", "v1\n");

        fs.rmSync(fp);
        watcher.fire(fp);
        fs.writeFileSync(fp, "v2 longer\n");
        watcher.fire(fp);
        expect(vi.getTimerCount()).toBe(0);
        vi.advanceTimersByTime(ORPHAN_CHECK_DELAY_MS);

        expect(pane.model.isOrphaned).toBe(false);
        expect(orphanedEvents).toBe(0);
        expect(pane.getText()).toBe("v2 longer\n");
    });

    it("a file that vanishes and returns before recheck without an event: the recheck sees the file", () => {
        const fp = open("a.txt", "v1\n");

        fs.rmSync(fp);
        watcher.fire(fp);
        fs.writeFileSync(fp, "v1\n");
        vi.advanceTimersByTime(ORPHAN_CHECK_DELAY_MS);

        expect(pane.model.isOrphaned).toBe(false);
    });

    it("a returned file clears the flag; new content is reread into the clean buffer", () => {
        const fp = open("a.txt", "v1\n");
        deleteExternally(fp);

        fs.writeFileSync(fp, "restored differently\n");
        watcher.fire(fp);

        expect(pane.model.isOrphaned).toBe(false);
        expect(orphanedEvents).toBe(2);
        expect(pane.getText()).toBe("restored differently\n");
    });

    it("a file returned unchanged (restore from trash keeps mtime) clears the flag, the text stays", () => {
        const fp = open("a.txt", "v1\n");
        trashAndRestore(fp);

        expect(pane.model.isOrphaned).toBe(false);
        expect(pane.getText()).toBe("v1\n");
        expect(pane.isModified).toBe(false);
        // Only flag changes (set, cleared): the same file does not trigger a reload.
        expect(diskStateEvents).toBe(2);
    });

    it("the same file returning under a dirty buffer clears the flag without a false conflict", () => {
        const fp = open("a.txt", "v1\n");
        pane.viewState.type("Z");
        trashAndRestore(fp);

        expect(pane.model.isOrphaned).toBe(false);
        expect(pane.hasDiskConflict).toBe(false);
        expect(pane.getText()).toBe("Zv1\n");
    });

    it("a file returned without a watcher event clears the flag by a reread, with an event", () => {
        const fp = open("a.txt", "v1\n");
        deleteExternally(fp);
        fs.writeFileSync(fp, "back\n");

        pane.revertToDisk();

        expect(pane.model.isOrphaned).toBe(false);
        expect(orphanedEvents).toBe(2);
        expect(pane.getText()).toBe("back\n");
    });

    it("a file missing at open that appears externally is neither reread nor orphaned", () => {
        const fp = ws.path("late.txt");
        pane.openFile(Uri.file(fp));
        pane.viewState.type("draft");

        fs.writeFileSync(fp, "someone else\n");
        watcher.fire(fp);

        expect(pane.getText()).toBe("draft");
        expect(pane.hasDiskConflict).toBe(false);
        expect(pane.model.isOrphaned).toBe(false);
    });

    it("a dirty orphaned model stays dirty; a returned file raises a conflict, not a reread", () => {
        const fp = open("a.txt", "v1\n");
        pane.viewState.type("Z");
        deleteExternally(fp);
        expect(pane.model.isOrphaned).toBe(true);
        expect(pane.isModified).toBe(true);

        fs.writeFileSync(fp, "other process wrote\n");
        watcher.fire(fp);

        expect(pane.model.isOrphaned).toBe(false);
        expect(pane.hasDiskConflict).toBe(true);
        expect(pane.getText()).toBe("Zv1\n");
    });

    it("a repeated event for a missing file does not restart the check and sends no events", () => {
        const fp = open("a.txt", "v1\n");
        deleteExternally(fp);

        watcher.fire(fp);
        vi.advanceTimersByTime(ORPHAN_CHECK_DELAY_MS);

        expect(orphanedEvents).toBe(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("a second event within the delay restarts the countdown without extra timers", () => {
        const fp = open("a.txt", "v1\n");
        fs.rmSync(fp);
        watcher.fire(fp);
        vi.advanceTimersByTime(ORPHAN_CHECK_DELAY_MS - 1);
        watcher.fire(fp);

        expect(vi.getTimerCount()).toBe(1);
        vi.advanceTimersByTime(ORPHAN_CHECK_DELAY_MS - 1);
        expect(pane.model.isOrphaned).toBe(false);
        vi.advanceTimersByTime(1);
        expect(pane.model.isOrphaned).toBe(true);
    });

    it("save recreates the deleted file and clears the flag", async () => {
        const fp = open("a.txt", "v1\n");
        deleteExternally(fp);

        expect(await pane.save()).toBe("saved");

        expect(fs.readFileSync(fp, "utf-8")).toBe("v1\n");
        expect(pane.model.isOrphaned).toBe(false);
        expect(orphanedEvents).toBe(2);
    });

    it("saveAs clears the flag and cancels the recheck of the old path", async () => {
        const fp = open("a.txt", "v1\n");
        deleteExternally(fp);
        expect(pane.model.isOrphaned).toBe(true);

        await pane.saveAs(ws.path("b.txt"));
        expect(pane.model.isOrphaned).toBe(false);

        // The old path's delay started before saveAs does not bring the flag back.
        const pane2 = createEditorPane();
        pane2.model.fileWatcher = watcher;
        const other = ws.writeFile("c.txt", "c\n");
        pane2.openFile(Uri.file(other));
        fs.rmSync(other);
        watcher.fire(other);
        await pane2.saveAs(ws.path("d.txt"));
        vi.advanceTimersByTime(ORPHAN_CHECK_DELAY_MS);
        expect(pane2.model.isOrphaned).toBe(false);
        pane2.dispose();
    });

    it("a file missing already at open has nothing to lose, never orphaned", () => {
        const fp = ws.path("missing.txt");
        pane.openFile(Uri.file(fp));

        watcher.fire(fp);
        vi.advanceTimersByTime(ORPHAN_CHECK_DELAY_MS);

        expect(pane.model.isOrphaned).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("rereading a missing file does not clear the flag", () => {
        const fp = open("a.txt", "v1\n");
        deleteExternally(fp);

        pane.revertToDisk();

        expect(pane.model.isOrphaned).toBe(true);
    });

    it("closing the model cancels the pending recheck", () => {
        const fp = open("a.txt", "v1\n");
        fs.rmSync(fp);
        watcher.fire(fp);

        pane.model.dispose();

        expect(vi.getTimerCount()).toBe(0);
    });
});
