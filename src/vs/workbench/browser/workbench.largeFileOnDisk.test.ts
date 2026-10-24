import * as fs from "node:fs";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { fileDialogDriver } from "../../../TestUtils/fileDialogDriver.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../TestUtils/testConfigurationService.ts";
import { flushMicrotasks } from "../../../TestUtils/timing.ts";
import { NotificationServiceDIToken } from "../services/notification/browser/notificationService.ts";

const LINE = "2026-01-01T00:00:00.000Z INFO worker request handled path=/api/v1/items";

/** ~1.2 MiB: above a 1 MiB size threshold, so the file opens on disk (docs/arch/Editor.md). */
function bigLog(lines = 18_000): string {
    return Array.from({ length: lines }, (_, i) => `${String(i)} ${LINE}`).join("\n") + "\n";
}

/**
 * What the user sees of the document on disk through the workbench: the seams the model tests can't see.
 * Found by the live run of PR #799 (QA pass, 2026-10-24).
 */
describe("Workbench — the document on disk", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-on-disk-wb-", files: { "huge.log": bigLog() } });
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            size: new Size(120, 30),
            configurationService: createTestConfigurationService({ "editor.largeFileSizeThreshold": 1 }),
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

    /**
     * Until 4.5 Save As refused a document on disk with a toast (QA of #799: a refusal only in the log is a silent
     * failure). Now it copies the file through the file service and the tab follows the copy, still on disk.
     */
    it("Save As on a document on disk writes the copy through the dialog and the tab follows it", async () => {
        h.workbench.openFile(ws.path("huge.log"));
        h.workbench.focusEditor();
        const editor = h.activeEditor();
        expect(editor.fileModel?.isOnDisk).toBe(true);
        const notifications = h.container.get(NotificationServiceDIToken);
        notifications.clearAll();

        const dialog = fileDialogDriver(h);
        const run = h.commands.execute("workbench.action.files.saveAs") as Promise<void>;
        const newPath = ws.path("copy.log");
        await vi.waitFor(() => {
            expect(dialog.component.isOpen()).toBe(true);
        });
        await dialog.settle({ query: ws.path("huge.log") });
        dialog.replaceQuery(newPath);
        await dialog.settle({ query: newPath });
        dialog.key("Enter");
        await run;

        expect(fs.readFileSync(newPath, "utf8")).toBe(bigLog());
        expect(editor.uri.fsPath).toBe(newPath);
        expect(editor.fileModel?.isOnDisk).toBe(true);
        expect(editor.readOnly).toBe(true);
        expect(notifications.isEmpty()).toBe(true);
        expect(screen()).toContain("copy.log");
    });

    it("the toast's Enable Editing streams the file in: the tab becomes writable, and a save writes the edit", async () => {
        h.workbench.openFile(ws.path("huge.log"));
        h.workbench.focusEditor();
        const editor = h.activeEditor();
        const notifications = h.container.get(NotificationServiceDIToken);
        expect(notifications.current()?.items).toEqual(["Enable Editing"]);

        notifications.answer(notifications.current()!.id, 0);
        await vi.waitFor(() => {
            expect(editor.readOnly).toBe(false);
        });
        expect(editor.fileModel?.isOnDisk).toBe(false);
        expect(editor.model.isTooLargeForTokenization).toBe(false);
        expect(editor.lineCount).toBe(18_001);
        // The status bar's progress went with the load.
        expect(screen()).not.toMatch(/Loading \d+%|Indexing \d+%/);

        editor.viewState.type("x");
        await h.commands.execute("workbench.action.files.save");
        await vi.waitFor(() => {
            expect(editor.model.isModified).toBe(false);
        });
        expect(fs.readFileSync(ws.path("huge.log"), "utf8")).toBe(`x${bigLog()}`);
        await flushMicrotasks();
    });
});
