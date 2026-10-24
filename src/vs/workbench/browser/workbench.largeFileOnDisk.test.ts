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
     * Live run: Save As on a document on disk opened the dialog, the new name was confirmed, and nothing
     * happened — the model's refusal ("Save As is not available for a document on disk; Enable Editing
     * first") went to the log only (`fileActions.ts`, "Save As failed"), no file, no toast. A refusal the
     * user cannot see is a silent failure: whichever way the command refuses (before the dialog or after
     * it), the user must be told, like the "too large to load into memory" toast of Enable Editing.
     */
    it("Save As on a document on disk tells the user it is unavailable instead of failing silently", async () => {
        h.workbench.openFile(ws.path("huge.log"));
        h.workbench.focusEditor();
        const editor = h.activeEditor();
        expect(editor.fileModel?.isOnDisk).toBe(true);
        const notifications = h.container.get(NotificationServiceDIToken);
        // The large-file toast is not the one under test.
        notifications.clearAll();

        const dialog = fileDialogDriver(h);
        const run = h.commands.execute("workbench.action.files.saveAs") as Promise<void> | undefined;
        const newPath = ws.path("copy.log");
        // The command may refuse up front (no dialog) or after the dialog: both are fine, silence is not.
        await vi.waitFor(() => {
            expect(dialog.component.isOpen() || !notifications.isEmpty()).toBe(true);
        });
        if (dialog.component.isOpen()) {
            await dialog.settle({ query: ws.path("huge.log") });
            dialog.replaceQuery(newPath);
            await dialog.settle({ query: newPath });
            dialog.key("Enter");
            await run;
        }

        expect(fs.existsSync(newPath)).toBe(false);
        expect(editor.fileModel?.isOnDisk).toBe(true);
        await vi.waitFor(() => {
            expect(notifications.isEmpty()).toBe(false);
        });
        expect(notifications.current()?.message).toMatch(/Save As/);
        expect(screen()).toMatch(/Save As/);
    });

    it("the Save As toast offers Enable Editing: the button loads the file into memory, dismissing does not", async () => {
        h.workbench.openFile(ws.path("huge.log"));
        h.workbench.focusEditor();
        const editor = h.activeEditor();
        const notifications = h.container.get(NotificationServiceDIToken);
        notifications.clearAll();

        void h.commands.execute("workbench.action.files.saveAs");
        await vi.waitFor(() => {
            expect(notifications.current()?.message).toMatch(/Save As/);
        });
        // A toast, not a modal: the editor stays usable behind it.
        expect(notifications.current()?.modal).toBe(false);
        notifications.dismiss(notifications.current()!.id);
        await flushMicrotasks();
        expect(editor.fileModel?.isOnDisk).toBe(true);
        expect(editor.readOnly).toBe(true);

        void h.commands.execute("workbench.action.files.saveAs");
        await vi.waitFor(() => {
            expect(notifications.current()?.items).toEqual(["Enable Editing"]);
        });
        notifications.answer(notifications.current()!.id, 0);
        await flushMicrotasks();
        expect(editor.fileModel?.isOnDisk).toBe(false);
        expect(editor.model.isTooLargeForTokenization).toBe(false);
        expect(editor.readOnly).toBe(false);
        expect(editor.lineCount).toBe(18_001);
    });
});
