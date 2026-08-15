import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { quickPickByTitle, tabLabels } from "../../../TestUtils/domQueries.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../TestUtils/timing.ts";

describe("Workbench — Open File / Open Folder", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-open-",
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

    it("opens the Open File prompt empty (no scary seed error)", () => {
        h.commands.execute("workbench.action.files.openFile");
        h.testApp.render();

        const input = quickPickByTitle(h.testApp, "Open File");
        expect(input.getQuery()).toBe("");
        expect(input.validationMessage).toBeNull();
    });

    it("opens the entered absolute path in a new tab", async () => {
        h.commands.execute("workbench.action.files.openFile");
        h.testApp.render();

        const input = quickPickByTitle(h.testApp, "Open File");
        input.onQueryChange?.(ws.path("beta.txt"));
        input.setQuery(ws.path("beta.txt"));
        h.testApp.sendKey("Enter");
        await flushMicrotasks();
        h.testApp.render();

        expect(tabLabels(h.testApp).some((l) => l.includes("beta.txt"))).toBe(true);
    });

    it("resolves a relative path against the workspace root", async () => {
        h.commands.execute("workbench.action.files.openFile");
        h.testApp.render();

        const input = quickPickByTitle(h.testApp, "Open File");
        // A bare name is valid because it resolves against the workspace root.
        input.onQueryChange?.("beta.txt");
        expect(input.validationMessage).toBeNull();

        input.setQuery("beta.txt");
        h.testApp.sendKey("Enter");
        await flushMicrotasks();
        h.testApp.render();

        expect(tabLabels(h.testApp).some((l) => l.includes("beta.txt"))).toBe(true);
    });

    it("validates the Open File path", () => {
        h.commands.execute("workbench.action.files.openFile");
        h.testApp.render();
        const input = quickPickByTitle(h.testApp, "Open File");

        // Empty input is not flagged as an error (Enter is a harmless no-op).
        input.onQueryChange?.("   ");
        expect(input.validationMessage).toBeNull();

        input.onQueryChange?.(ws.path("nope.txt"));
        expect(input.validationMessage).toContain("File does not exist");

        // The workspace directory itself is a folder, not a file.
        input.onQueryChange?.(ws.dir);
        expect(input.validationMessage).toBe("That is a folder, not a file");

        input.onQueryChange?.(ws.path("alpha.txt"));
        expect(input.validationMessage).toBeNull();
    });

    it("Escape cancels Open File without opening anything", async () => {
        h.commands.execute("workbench.action.files.openFile");
        h.testApp.render();

        const input = quickPickByTitle(h.testApp, "Open File");
        input.onQueryChange?.(ws.path("beta.txt"));
        input.setQuery(ws.path("beta.txt"));
        h.testApp.sendKey("Escape");
        await flushMicrotasks();
        h.testApp.render();

        expect(tabLabels(h.testApp).some((l) => l.includes("beta.txt"))).toBe(false);
        expect(h.testApp.root.overlayLayer.hasVisibleItems()).toBe(false);
    });

    it("swaps the workspace root to the entered folder", async () => {
        const other = createTempWorkspace({
            prefix: "diode-open-other-",
            files: { "gamma.txt": "Gamma content" },
        });
        try {
            h.commands.execute("workbench.action.files.openFolder");
            h.testApp.render();

            const folderInput = quickPickByTitle(h.testApp, "Open Folder");
            folderInput.onQueryChange?.(other.dir);
            folderInput.setQuery(other.dir);
            h.testApp.sendKey("Enter");
            await flushMicrotasks();
            h.testApp.render();

            // Observable effect: relative Open File paths now resolve against the new
            // root — gamma.txt exists only there, not in the original workspace.
            h.commands.execute("workbench.action.files.openFile");
            h.testApp.render();
            const fileInput = quickPickByTitle(h.testApp, "Open File");
            fileInput.onQueryChange?.("gamma.txt");
            expect(fileInput.validationMessage).toBeNull();
        } finally {
            other.dispose();
        }
    });

    it("accepting an empty Open File prompt opens nothing and closes", async () => {
        h.commands.execute("workbench.action.files.openFile");
        h.testApp.render();

        // Empty is a valid (non-error) value, so Enter is accepted but is a no-op.
        h.testApp.sendKey("Enter");
        await flushMicrotasks();
        h.testApp.render();

        expect(tabLabels(h.testApp).some((l) => l.includes(".txt"))).toBe(false);
        expect(h.testApp.root.overlayLayer.hasVisibleItems()).toBe(false);
    });

    it("Ctrl+O opens the Open File prompt", () => {
        h.testApp.sendKey("Ctrl+O");
        h.testApp.render();

        expect(() => quickPickByTitle(h.testApp, "Open File")).not.toThrow();
    });

    it("Ctrl+K Ctrl+O opens the Open Folder prompt", () => {
        h.testApp.sendKey("Ctrl+K");
        h.testApp.sendKey("Ctrl+O");
        h.testApp.render();

        expect(() => quickPickByTitle(h.testApp, "Open Folder")).not.toThrow();
    });

    it("validates the Open Folder path", () => {
        h.commands.execute("workbench.action.files.openFolder");
        h.testApp.render();
        const input = quickPickByTitle(h.testApp, "Open Folder");

        input.onQueryChange?.(ws.path("no-such-dir"));
        expect(input.validationMessage).toContain("Folder does not exist");

        // An existing file is not a valid folder target.
        input.onQueryChange?.(ws.path("alpha.txt"));
        expect(input.validationMessage).toBe("That is a file, not a folder");

        input.onQueryChange?.(ws.dir);
        expect(input.validationMessage).toBeNull();
    });

    it("expands a leading ~ to the home directory", () => {
        h.commands.execute("workbench.action.files.openFile");
        h.testApp.render();
        const input = quickPickByTitle(h.testApp, "Open File");

        input.onQueryChange?.("~/definitely-nonexistent-xyz");
        expect(input.validationMessage).toBe(
            `File does not exist: ${path.join(os.homedir(), "definitely-nonexistent-xyz")}`,
        );
    });

    it("Escape cancels Open Folder without swapping the root", async () => {
        const other = createTempWorkspace({ prefix: "diode-open-cancel-" });
        try {
            h.commands.execute("workbench.action.files.openFolder");
            h.testApp.render();

            const folderInput = quickPickByTitle(h.testApp, "Open Folder");
            folderInput.onQueryChange?.(other.dir);
            folderInput.setQuery(other.dir);
            h.testApp.sendKey("Escape");
            await flushMicrotasks();
            h.testApp.render();

            expect(h.testApp.root.overlayLayer.hasVisibleItems()).toBe(false);
            // Root unchanged: a tmpDir-relative file still resolves.
            h.commands.execute("workbench.action.files.openFile");
            h.testApp.render();
            const fileInput = quickPickByTitle(h.testApp, "Open File");
            fileInput.onQueryChange?.("beta.txt");
            expect(fileInput.validationMessage).toBeNull();
        } finally {
            other.dispose();
        }
    });

    it("accepting an empty Open Folder prompt swaps nothing and closes", async () => {
        h.commands.execute("workbench.action.files.openFolder");
        h.testApp.render();

        h.testApp.sendKey("Enter");
        await flushMicrotasks();
        h.testApp.render();

        expect(h.testApp.root.overlayLayer.hasVisibleItems()).toBe(false);
        // Root unchanged: a tmpDir-relative file still resolves.
        h.commands.execute("workbench.action.files.openFile");
        h.testApp.render();
        const fileInput = quickPickByTitle(h.testApp, "Open File");
        fileInput.onQueryChange?.("beta.txt");
        expect(fileInput.validationMessage).toBeNull();
    });
});

describe("Workbench — Open File without a workspace folder", () => {
    it("resolves relative paths against the process cwd", () => {
        // No workspaceFolder: getRootPath() is null → cwd fallback.
        const h = createAppTestHarness();
        try {
            h.commands.execute("workbench.action.files.openFile");
            h.testApp.render();
            const input = quickPickByTitle(h.testApp, "Open File");

            input.onQueryChange?.("definitely-nonexistent-xyz.txt");
            expect(input.validationMessage).toBe(
                `File does not exist: ${path.join(process.cwd(), "definitely-nonexistent-xyz.txt")}`,
            );
        } finally {
            h.dispose();
        }
    });
});
