import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { EditorTabStripElement } from "@tuidom/elements/editorgroup/editorTabStripElement";
import type { QuickPickElement } from "./parts/quickinput/quickPickElement.ts";
import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import type { TestApp } from "../../../TestUtils/TestApp.ts";
import { flushMicrotasks } from "../../../TestUtils/timing.ts";
import { DialogServiceDIToken } from "../services/dialogs/browser/dialogService.ts";

/** The visible Save As InputBox is the QuickPickElement carrying a seeded query. */
function openInputBox(testApp: TestApp): QuickPickElement {
    const pickers = testApp.querySelectorAll("QuickPickElement") as QuickPickElement[];
    const input = pickers.find((p) => p.getQuery().length > 0);
    if (!input) throw new Error("Save As input box not found");
    return input;
}

describe("Workbench — Save As", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-saveas-",
            files: {
                "alpha.txt": "Alpha content",
                "beta.txt": "Beta content",
            },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("seeds the input with the current file path", () => {
        const filePath = ws.path("alpha.txt");
        h.commands.execute("workbench.openFile", filePath);
        h.testApp.render();

        h.commands.execute("workbench.action.files.saveAs");
        h.testApp.render();

        expect(openInputBox(h.testApp).getQuery()).toBe(filePath);
    });

    it("saves the active editor to a new path and renames the tab", async () => {
        const filePath = ws.path("alpha.txt");
        h.commands.execute("workbench.openFile", filePath);
        h.testApp.render();

        h.commands.execute("workbench.action.files.saveAs");
        h.testApp.render();

        const newPath = ws.path("renamed.md");
        openInputBox(h.testApp).setQuery(newPath);
        h.testApp.sendKey("Enter");
        await flushMicrotasks();
        h.testApp.render();

        expect(fs.readFileSync(newPath, "utf-8")).toBe("Alpha content");

        const tabStrip = h.testApp.querySelector("EditorTabStripElement") as EditorTabStripElement;
        const labels = tabStrip.getItemElements().map((el) => el.getLabel());
        expect(labels.some((l) => l.includes("renamed.md"))).toBe(true);
    });

    it("prompts before overwriting a different existing file", async () => {
        h.commands.execute("workbench.openFile", ws.path("alpha.txt"));
        h.testApp.render();
        h.commands.execute("workbench.action.files.saveAs");
        h.testApp.render();

        const betaPath = ws.path("beta.txt");
        openInputBox(h.testApp).setQuery(betaPath);
        h.testApp.sendKey("Enter");
        await flushMicrotasks();
        h.testApp.render();

        // A confirm dialog appears and beta.txt is NOT overwritten yet.
        const dialog = h.container.get(DialogServiceDIToken).getOpenConfirmDialog();
        expect(dialog).not.toBeNull();
        expect(fs.readFileSync(betaPath, "utf-8")).toBe("Beta content");

        dialog!.onConfirm?.();
        h.testApp.render();

        expect(fs.readFileSync(betaPath, "utf-8")).toBe("Alpha content");
    });

    it("validates the target path", () => {
        h.commands.execute("workbench.openFile", ws.path("alpha.txt"));
        h.testApp.render();
        h.commands.execute("workbench.action.files.saveAs");
        h.testApp.render();

        const input = openInputBox(h.testApp);

        input.onQueryChange?.("   ");
        expect(input.validationMessage).toBe("Please enter a file name");

        const missingDir = ws.path("no/such/dir/file.txt");
        input.onQueryChange?.(missingDir);
        expect(input.validationMessage).toContain("Directory does not exist");

        // The workspace directory itself is a folder, not a valid file target.
        input.onQueryChange?.(ws.dir);
        expect(input.validationMessage).toBe("A folder with that name already exists");

        input.onQueryChange?.(ws.path("fresh.txt"));
        expect(input.validationMessage).toBeNull();
    });

    it("does nothing when there is no active editor", () => {
        // No file opened → no active editor → the command is a no-op (no prompt shown).
        h.commands.execute("workbench.action.files.saveAs");
        h.testApp.render();

        const anySeeded = (h.testApp.querySelectorAll("QuickPickElement") as QuickPickElement[]).some(
            (p) => p.getQuery().length > 0,
        );
        expect(anySeeded).toBe(false);
    });

    it("Escape cancels without writing anything", async () => {
        h.commands.execute("workbench.openFile", ws.path("alpha.txt"));
        h.testApp.render();
        h.commands.execute("workbench.action.files.saveAs");
        h.testApp.render();

        const newPath = ws.path("should-not-exist.txt");
        openInputBox(h.testApp).setQuery(newPath);
        h.testApp.sendKey("Escape");
        await flushMicrotasks();
        h.testApp.render();

        expect(fs.existsSync(newPath)).toBe(false);
        expect(h.testApp.root.overlayLayer.hasVisibleItems()).toBe(false);
    });
});
