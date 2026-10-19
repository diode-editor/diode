import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { tabLabels } from "../../../TestUtils/domQueries.ts";
import { fileDialogDriver } from "../../../TestUtils/fileDialogDriver.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { IWorkspaceContextServiceDIToken } from "../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";

// File: Open File / Open Folder — диалог файлов (порт SimpleFileDialog эталона)
// в настоящем приложении на настоящем диске: путь в строке, каталог под ней.

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

    it("Open File открывает диалог в папке воркспейса: путь в строке, каталог под ней", async () => {
        const dialog = fileDialogDriver(h);
        h.commands.execute("workbench.action.files.openFile");
        await dialog.settle({
            title: "Open File",
            query: ws.dir + path.sep,
            items: ["..", "sub", "alpha.txt", "beta.txt"],
        });
        dialog.key("Escape");
    });

    it("начало имени и Enter открывают файл во вкладке", async () => {
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

    it("набранный абсолютный путь — в каталог и к файлу", async () => {
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

    it("несуществующий файл — сообщение эталона, ничего не открыто", async () => {
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

    it("Open File: Enter на каталоге без подсветки — «Please select a file.»", async () => {
        const dialog = fileDialogDriver(h);
        h.commands.execute("workbench.action.files.openFile");
        await dialog.settle({ query: ws.dir + path.sep, items: ["..", "sub", "alpha.txt", "beta.txt"] });
        dialog.key("Enter");
        await vi.waitFor(() => {
            expect(dialog.validationMessage()).toBe("Please select a file.");
        });
        dialog.key("Escape");
    });

    it("«~/» переводит в домашний каталог", async () => {
        const dialog = fileDialogDriver(h);
        h.commands.execute("workbench.action.files.openFile");
        await dialog.settle({ query: ws.dir + path.sep });
        dialog.replaceQuery("~/");
        await dialog.settle({ query: os.homedir() + path.sep });
        dialog.key("Escape");
    });

    it("Escape отменяет Open File: вкладок нет, оверлей закрыт", async () => {
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

    it("Ctrl+O открывает Open File, Ctrl+K Ctrl+O — Open Folder", async () => {
        const dialog = fileDialogDriver(h);
        h.testApp.sendKey("Ctrl+O");
        await dialog.settle({ title: "Open File" });
        dialog.key("Escape");
        h.testApp.sendKey("Ctrl+K");
        h.testApp.sendKey("Ctrl+O");
        await dialog.settle({ title: "Open Folder" });
        dialog.key("Escape");
    });

    it("Open Folder: только каталоги; войти и Enter на пути — новый корень воркспейса", async () => {
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

    it("Open Folder: файл вместо папки — «Please select a folder.»", async () => {
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

    it("Escape отменяет Open Folder без смены корня", async () => {
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

describe("Workbench — Open File без папки", () => {
    it("диалог стоит в домашнем каталоге (`defaultFilePath` эталона)", async () => {
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
