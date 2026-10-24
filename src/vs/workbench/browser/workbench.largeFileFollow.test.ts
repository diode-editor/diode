import * as fs from "node:fs";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { FakeFileWatcher } from "../../../TestUtils/configurationLayersFixture.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../TestUtils/testConfigurationService.ts";
import { flushMicrotasks } from "../../../TestUtils/timing.ts";
import { IFileWatcherDIToken } from "../../platform/files/common/iFileWatcherDIToken.ts";
import { NotificationServiceDIToken } from "../services/notification/browser/notificationService.ts";

const LINE = "2026-01-01T00:00:00.000Z INFO worker request handled path=/api/v1/items";

/** ~1.2 MiB: above a 1 MiB size threshold, so the file opens on disk (docs/arch/Editor.md). */
function bigLog(lines = 18_000): string {
    return Array.from({ length: lines }, (_, i) => `${String(i)} ${LINE}`).join("\n") + "\n";
}

/** More lines than the 30-row screen holds: the last one is on screen only if the view rode along. */
const NEW_LINES = 60;

function newLine(i: number): string {
    return `rotated-${String(i).padStart(3, "0")} ${LINE}`;
}

/**
 * Follow of a document on disk (OpenPerformance 4.4) across log rotation, as the user sees it: the frame and the
 * status bar. A logger rotates by `mv app.log app.log.1` and a NEW, EMPTY `app.log` (or by logrotate's
 * `copytruncate`: copy, then truncate to zero), and goes on writing into the new file. The user had the cursor
 * on the last line (Ctrl+End, `Follow: On`) and expects `tail -F`: the new file's lines ride into view.
 * Found by the live run of PR #802 (QA pass, 2026-10-24): after the rotation the screen stays on line 1 of the
 * new file while it grows, the cursor is on `Ln 1`, and the `Follow` entry is gone from the status bar.
 */
describe("Workbench — follow of the document on disk across log rotation", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let watcher: FakeFileWatcher;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-follow-wb-", files: { "app.log": bigLog() } });
        watcher = new FakeFileWatcher();
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            size: new Size(140, 30),
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

    async function openFollowing(): Promise<string> {
        const path = ws.path("app.log");
        h.workbench.openFile(path);
        h.workbench.focusEditor();
        expect(h.activeEditor().fileModel?.isOnDisk).toBe(true);
        // The large-file toast covers the right half of the text; it is not the one under test.
        h.container.get(NotificationServiceDIToken).clearAll();
        h.testApp.sendKey("Ctrl+End");
        await flushMicrotasks();
        expect(screen()).toContain("Follow: On");
        return path;
    }

    /** The logger goes on writing into the new file, ten lines per watcher window. */
    async function writeNewFile(path: string): Promise<void> {
        for (let i = 0; i < NEW_LINES; i += 10) {
            fs.appendFileSync(path, Array.from({ length: 10 }, (_, k) => newLine(i + k) + "\n").join(""));
            watcher.fire(path);
            await flushMicrotasks();
        }
    }

    function expectFollowedNewFile(): void {
        const frame = screen();
        expect(frame).toContain(newLine(NEW_LINES - 1));
        expect(frame).toContain(`Ln ${String(NEW_LINES + 1)}`);
        expect(frame).toContain("Follow: On");
    }

    it("mv app.log app.log.1 and a new empty app.log: the new file's lines ride into view, Follow: On", async () => {
        const path = await openFollowing();

        fs.renameSync(path, ws.path("app.log.1"));
        fs.writeFileSync(path, "");
        watcher.fire(path);
        await flushMicrotasks();
        await writeNewFile(path);

        expectFollowedNewFile();
    });

    it("logrotate copytruncate (copy, truncate to zero): the lines written after it ride into view, Follow: On", async () => {
        const path = await openFollowing();

        fs.copyFileSync(path, ws.path("app.log.1"));
        fs.truncateSync(path, 0);
        watcher.fire(path);
        await flushMicrotasks();
        await writeNewFile(path);

        expectFollowedNewFile();
    });

    /**
     * The same loss without a small file: the new log is above the threshold and on disk, but it fits the first
     * chunk of the index, so the reload does not clamp the cursor — and follow is decided by the clamp, not
     * carried over. The cursor stays on the old last line's number, which is no longer the end: `Follow: Off`.
     * Found by the e2e of this QA pass (threshold 1 MiB, a 1.2 MiB log written whole under the old name).
     */
    it("mv app.log app.log.1 and a new log on disk, longer than the old one: the cursor goes to its end, Follow: On", async () => {
        const path = await openFollowing();
        const tail = "new-log-tail-line";

        fs.renameSync(path, ws.path("app.log.1"));
        fs.writeFileSync(path, bigLog() + `${tail}\n`);
        watcher.fire(path);
        await flushMicrotasks();

        expect(h.activeEditor().fileModel?.isOnDisk).toBe(true);
        const frame = screen();
        expect(frame).toContain(tail);
        expect(frame).toContain("Ln 18002");
        expect(frame).toContain("Follow: On");
    });
});
