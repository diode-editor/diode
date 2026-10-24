import * as fs from "node:fs";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { FakeFileWatcher } from "../../../TestUtils/configurationLayersFixture.ts";
import { MemoryRandomAccessFile } from "../../../TestUtils/memoryRandomAccessFile.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../TestUtils/testConfigurationService.ts";
import { IFileWatcherDIToken } from "../../platform/files/common/iFileWatcherDIToken.ts";
import { IRandomAccessFileOpenerDIToken } from "../../platform/files/common/iRandomAccessFile.ts";
import { IMemoryProbeDIToken } from "../../platform/memory/common/iMemoryProbe.ts";
import { ENABLE_LARGE_FILE_EDITING_COMMAND_ID } from "../contrib/largeFile/browser/largeFileActions.ts";
import { NotificationServiceDIToken } from "../services/notification/browser/notificationService.ts";
import { READ_CHUNK_SIZE } from "../services/textfile/common/textFileModel.ts";

const LINE = "2026-01-01T00:00:00.000Z INFO worker request handled path=/api/v1/items";

/** More than two read chunks: above a 1 MiB size threshold, and the stream into memory takes three reads. */
function bigLog(): string {
    const lines: string[] = [];
    let bytes = 0;
    for (let i = 0; bytes < 2 * READ_CHUNK_SIZE + 12_345; i++) {
        const line = `${String(i)} ${LINE}`;
        lines.push(line);
        bytes += line.length + 1;
    }
    return lines.join("\n") + "\n";
}

/**
 * QA of PR #803 (OpenPerformance 4.5): "Enable Editing" while the log on disk changes under it. The opener gates every
 * open after the first (the document on disk indexes at once), so the test steps the stream; the watcher is fired by
 * hand where the real one would fire, while the stream is still reading.
 */
describe("Workbench — Enable Editing while the file changes on disk", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    const watcher = new FakeFileWatcher();
    const opened: MemoryRandomAccessFile[] = [];
    let availableBytes = Number.MAX_SAFE_INTEGER;

    beforeEach(() => {
        opened.length = 0;
        availableBytes = Number.MAX_SAFE_INTEGER;
        ws = createTempWorkspace({ prefix: "diode-stream-wb-", files: { "app.log": bigLog() } });
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            size: new Size(120, 30),
            configurationService: createTestConfigurationService({ "editor.largeFileSizeThreshold": 1 }),
            containerOverrides: (container) => {
                container.bind(IFileWatcherDIToken, () => watcher);
                container.bind(IMemoryProbeDIToken, () => ({ availableBytes: () => availableBytes }));
                container.bind(IRandomAccessFileOpenerDIToken, () => ({
                    open: (path: string) => {
                        const file = new MemoryRandomAccessFile(fs.readFileSync(path), { gated: opened.length > 0 });
                        opened.push(file);
                        return file;
                    },
                }));
            },
        });
    });

    afterEach(() => {
        for (const file of opened) file.openGate();
        h.dispose();
        ws.dispose();
    });

    function screen(): string {
        h.testApp.render();
        return h.testApp.backend.screenToString();
    }

    async function pendingRead(file: MemoryRandomAccessFile | undefined): Promise<MemoryRandomAccessFile> {
        await vi.waitFor(() => {
            expect(file?.pendingReads).toBe(1);
        });
        return file!;
    }

    async function startEnableEditing(): Promise<MemoryRandomAccessFile> {
        h.workbench.openFile(ws.path("app.log"));
        h.workbench.focusEditor();
        expect(h.activeEditor().fileModel?.isOnDisk).toBe(true);
        void h.commands.execute(ENABLE_LARGE_FILE_EDITING_COMMAND_ID);
        const stream = await pendingRead(opened[1]);
        stream.release();
        await pendingRead(stream);
        expect(screen()).toMatch(/Loading \d+%/);
        return stream;
    }

    /** Lets every later open stream through on its own and waits until the load has ended either way. */
    async function letStreamsFinish(): Promise<void> {
        for (const file of opened) file.openGate();
        await vi.waitFor(() => {
            for (const file of opened) file.openGate();
            expect(screen()).not.toMatch(/Loading \d+%/);
        });
    }

    it("nothing changes on disk meanwhile: the load ends editable (the control for the cases below)", async () => {
        const stream = await startEnableEditing();

        stream.openGate();
        await letStreamsFinish();

        expect(h.activeEditor().readOnly).toBe(false);
        expect(h.activeEditor().fileModel?.isOnDisk).toBe(false);
    });

    it("a line appended to the log while it streams in: the tab still becomes editable and shows the line", async () => {
        const stream = await startEnableEditing();

        // A log is written to while the user waits: the watcher fires in the middle of the load.
        fs.appendFileSync(ws.path("app.log"), "appended while loading\n");
        watcher.fire(ws.path("app.log"));
        stream.openGate();
        await letStreamsFinish();

        const editor = h.activeEditor();
        expect(editor.readOnly).toBe(false);
        expect(editor.fileModel?.isOnDisk).toBe(false);
        expect(editor.model.document.getLineContent(editor.lineCount - 1)).toBe("appended while loading");
        expect(h.container.get(NotificationServiceDIToken).isEmpty()).toBe(true);
    });

    it("the log truncated while it streams in (rotation): the tab still becomes editable with what the file holds now", async () => {
        const stream = await startEnableEditing();

        fs.writeFileSync(ws.path("app.log"), "rotated\n");
        watcher.fire(ws.path("app.log"));
        stream.openGate();
        await letStreamsFinish();

        const editor = h.activeEditor();
        expect(editor.readOnly).toBe(false);
        expect(editor.model.document.getLineContent(0)).toBe("rotated");
        expect(editor.lineCount).toBe(2);
    });

    it("memory runs out in the middle of the load: a toast on the frame, the tab stays read-only, the editor answers", async () => {
        const stream = await startEnableEditing();

        availableBytes = 100 * 1024 * 1024;
        stream.openGate();
        await letStreamsFinish();

        const editor = h.activeEditor();
        expect(editor.readOnly).toBe(true);
        expect(editor.fileModel?.isOnDisk).toBe(true);
        expect(screen()).toContain("There is not enough free memory to load this");
        h.container.get(NotificationServiceDIToken).clearAll();
        editor.goToPosition(1000);
        expect(screen()).toContain(`1000 ${LINE}`);
    });

    it("a read error in the middle of the load: a toast on the frame, the tab stays read-only on disk", async () => {
        const stream = await startEnableEditing();

        stream.failAsync = Object.assign(new Error("EIO: i/o error, read"), { code: "EIO" });
        stream.openGate();
        await letStreamsFinish();

        expect(h.activeEditor().readOnly).toBe(true);
        expect(screen()).toContain("The file could not be read into memory for");
    });
});

describe("Workbench — a reload of a large buffer in memory", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    const watcher = new FakeFileWatcher();

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-stream-reload-wb-", files: { "app.log": bigLog() } });
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            size: new Size(120, 30),
            configurationService: createTestConfigurationService({ "editor.largeFileSizeThreshold": 1 }),
            containerOverrides: (container) => {
                container.bind(IFileWatcherDIToken, () => watcher);
            },
        });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    function screen(): string {
        h.testApp.render();
        return h.testApp.backend.screenToString();
    }

    it("the log appended to after Enable Editing: the clean buffer reloads, the cursor and the view stay where they were", async () => {
        h.workbench.openFile(ws.path("app.log"));
        h.workbench.focusEditor();
        await h.commands.execute(ENABLE_LARGE_FILE_EDITING_COMMAND_ID);
        const editor = h.activeEditor();
        expect(editor.readOnly).toBe(false);
        h.container.get(NotificationServiceDIToken).clearAll();
        editor.goToPosition(50_000, 3);
        expect(screen()).toContain(`50000 ${LINE}`);

        fs.appendFileSync(ws.path("app.log"), "appended after enabling\n");
        watcher.fire(ws.path("app.log"));
        await vi.waitFor(() => {
            expect(editor.model.document.getLineContent(editor.lineCount - 2)).toBe("appended after enabling");
        });

        expect(editor.readOnly).toBe(false);
        expect(editor.primaryCursorLine).toBe(50_000);
        const frame = screen();
        expect(frame).toContain(`50000 ${LINE}`);
        expect(frame).not.toMatch(/Loading \d+%/);
    });
});
