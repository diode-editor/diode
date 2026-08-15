import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../TestUtils/timing.ts";
import { DialogServiceDIToken } from "../services/dialogs/browser/dialogService.ts";

import type { ConfirmDialog } from "./parts/dialogs/confirmDialog.ts";

describe("Workbench — save conflict (dirty-write protection)", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let filePath: string;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-saveconflict-",
            files: { "doc.txt": "original\n" },
        });
        filePath = ws.path("doc.txt");
        h = createAppTestHarness({ workspaceFolder: ws.dir });

        h.commands.execute("workbench.openFile", filePath);
        h.testApp.render();
        // Make the buffer dirty (editor is focused after openFile).
        h.testApp.sendKey("X");
        h.testApp.render();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    function dialog(): ConfirmDialog | null {
        return h.container.get(DialogServiceDIToken).getOpenConfirmDialog();
    }

    it("prompts to overwrite when the file changed on disk, leaving it untouched", async () => {
        fs.writeFileSync(filePath, "external edit\n", "utf-8");

        h.commands.execute("workbench.action.files.save");
        await flushMicrotasks();
        h.testApp.render();

        expect(dialog()).not.toBeNull();
        // The parallel change is preserved until the user decides.
        expect(fs.readFileSync(filePath, "utf-8")).toBe("external edit\n");
    });

    it("writes the buffer over the disk version once the user confirms", async () => {
        fs.writeFileSync(filePath, "external edit\n", "utf-8");

        h.commands.execute("workbench.action.files.save");
        await flushMicrotasks();
        h.testApp.render();

        dialog()!.onConfirm?.();
        await flushMicrotasks();
        h.testApp.render();

        const written = fs.readFileSync(filePath, "utf-8");
        expect(written).not.toBe("external edit\n");
        expect(written).toContain("X");
    });

    it("keeps the disk version when the user cancels", async () => {
        fs.writeFileSync(filePath, "external edit\n", "utf-8");

        h.commands.execute("workbench.action.files.save");
        await flushMicrotasks();
        h.testApp.render();

        dialog()!.onCancel?.();
        await flushMicrotasks();
        h.testApp.render();

        expect(fs.readFileSync(filePath, "utf-8")).toBe("external edit\n");
    });

    it("saves without a prompt when the file was not changed externally", async () => {
        h.commands.execute("workbench.action.files.save");
        await flushMicrotasks();
        h.testApp.render();

        expect(dialog()).toBeNull();
        expect(fs.readFileSync(filePath, "utf-8")).toContain("X");
    });
});
