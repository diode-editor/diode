import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { tabLabels } from "../../../TestUtils/domQueries.ts";
import { fileDialogDriver } from "../../../TestUtils/fileDialogDriver.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { IWorkspaceContextServiceDIToken } from "../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";

describe("Workbench — Open File / Open Folder", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-open-",
            files: {
                "alpha.txt": "Alpha content",
                "beta.txt": "Beta content",
                "sub/inner.txt": "Inner",
            },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    const root = (): string =>
        h.container.get(IWorkspaceContextServiceDIToken).getWorkspace().folders[0]?.uri.fsPath ?? "";

    it("Open File opens the dialog in the workspace folder: path in the input, directory below it", async () => {
        const dialog = fileDialogDriver(h);
        h.commands.execute("workbench.action.files.openFile");
        await dialog.settle({
            title: "Open File",
            query: ws.dir + path.sep,
            items: ["..", "sub", "alpha.txt", "beta.txt"],
        });
        dialog.key("Escape");
    });

    it("a name prefix and Enter open the file in a tab", async () => {
        const dialog = fileDialogDriver(h);
        h.commands.execute("workbench.action.files.openFile");
        await dialog.settle({ query: ws.dir + path.sep });
        for (const ch of "be") h.testApp.sendKey(ch);
        await dialog.settle({ activeIndex: 3 });
        dialog.key("Enter");
        await vi.waitFor(() => {
            h.testApp.render();
            expect(tabLabels(h.testApp).some((l) => l.includes("beta.txt"))).toBe(true);
        });
    });

    it("a typed absolute path goes to the directory and the file", async () => {
        const dialog = fileDialogDriver(h);
        h.commands.execute("workbench.action.files.openFile");
        await dialog.settle({ query: ws.dir + path.sep });
        dialog.replaceQuery(ws.path("sub/inner.txt"));
        await dialog.settle({ items: ["..", "inner.txt"] });
        dialog.key("Enter");
        await vi.waitFor(() => {
            h.testApp.render();
            expect(tabLabels(h.testApp).some((l) => l.includes("inner.txt"))).toBe(true);
        });
    });

    it("a nonexistent file shows the upstream message, nothing is opened", async () => {
        const dialog = fileDialogDriver(h);
        h.commands.execute("workbench.action.files.openFile");
        await dialog.settle({ query: ws.dir + path.sep });
        for (const ch of "nope.txt") h.testApp.sendKey(ch);
        await dialog.settle({ query: ws.path("nope.txt") });
        dialog.key("Enter");
        await vi.waitFor(() => {
            expect(dialog.validationMessage()).toBe("Please enter a path that exists.");
        });
        expect(tabLabels(h.testApp).some((l) => l.includes("nope.txt"))).toBe(false);
    });

    it("Open File: Enter on a directory without a highlight shows 'Please select a file.'", async () => {
        const dialog = fileDialogDriver(h);
        h.commands.execute("workbench.action.files.openFile");
        await dialog.settle({ query: ws.dir + path.sep, items: ["..", "sub", "alpha.txt", "beta.txt"] });
        dialog.key("Enter");
        await vi.waitFor(() => {
            expect(dialog.validationMessage()).toBe("Please select a file.");
        });
        dialog.key("Escape");
    });

    it("'~/' goes to the home directory", async () => {
        const dialog = fileDialogDriver(h);
        h.commands.execute("workbench.action.files.openFile");
        await dialog.settle({ query: ws.dir + path.sep });
        dialog.replaceQuery("~/");
        await dialog.settle({ query: os.homedir() + path.sep });
        dialog.key("Escape");
    });

    it("Escape cancels Open File: no tabs, the overlay is closed", async () => {
        const dialog = fileDialogDriver(h);
        const run = h.commands.execute("workbench.action.files.openFile") as Promise<void>;
        await dialog.settle({ query: ws.dir + path.sep });
        dialog.key("Escape");
        await expect(run).resolves.toBeUndefined();
        await vi.waitFor(() => {
            expect(h.testApp.root.overlayLayer.hasVisibleItems()).toBe(false);
        });
        expect(tabLabels(h.testApp).some((l) => l.includes(".txt"))).toBe(false);
    });

    it("Ctrl+O opens Open File, Ctrl+K Ctrl+O opens Open Folder", async () => {
        const dialog = fileDialogDriver(h);
        h.testApp.sendKey("Ctrl+O");
        await dialog.settle({ title: "Open File" });
        dialog.key("Escape");
        h.testApp.sendKey("Ctrl+K");
        h.testApp.sendKey("Ctrl+O");
        await dialog.settle({ title: "Open Folder" });
        dialog.key("Escape");
    });

    it("Open Folder: directories only; entering one and Enter on the path sets a new workspace root", async () => {
        const dialog = fileDialogDriver(h);
        h.commands.execute("workbench.action.files.openFolder");
        await dialog.settle({ title: "Open Folder", query: ws.dir + path.sep, items: ["..", "sub"] });
        dialog.replaceQuery(ws.path("sub") + path.sep);
        await dialog.settle({ query: ws.path("sub") + path.sep, items: [".."], activeIndex: -1 });
        dialog.key("Enter");
        await vi.waitFor(() => {
            expect(root()).toBe(ws.path("sub"));
        });
    });

    it("Open Folder: a file instead of a folder shows 'Please select a folder.'", async () => {
        const dialog = fileDialogDriver(h);
        h.commands.execute("workbench.action.files.openFolder");
        await dialog.settle({ query: ws.dir + path.sep });
        dialog.replaceQuery(ws.path("alpha.txt"));
        await dialog.settle({ query: ws.path("alpha.txt") });
        dialog.key("Enter");
        await vi.waitFor(() => {
            expect(dialog.validationMessage()).toBe("Please select a folder.");
        });
        expect(root()).toBe(ws.dir);
    });

    it("Escape cancels Open Folder without changing the root", async () => {
        const dialog = fileDialogDriver(h);
        const run = h.commands.execute("workbench.action.files.openFolder") as Promise<void>;
        await dialog.settle({ query: ws.dir + path.sep });
        dialog.key("Escape");
        await expect(run).resolves.toBeUndefined();
        await vi.waitFor(() => {
            expect(h.testApp.root.overlayLayer.hasVisibleItems()).toBe(false);
        });
        expect(root()).toBe(ws.dir);
    });
});

describe("Workbench: Open File without a folder", () => {
    it("the dialog starts in the home directory (upstream `defaultFilePath`)", async () => {
        const h = createAppTestHarness();
        try {
            const dialog = fileDialogDriver(h);
            h.commands.execute("workbench.action.files.openFile");
            await dialog.settle({ query: os.homedir() + path.sep });
            dialog.key("Escape");
        } finally {
            h.dispose();
        }
    });
});
