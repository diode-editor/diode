import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeFileWatcher, makeLogger, testRegistry } from "../../../../TestUtils/configurationLayersFixture.ts";
import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../TestUtils/disposableLeaks.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import { resolveUserDataPaths } from "../../environment/node/userDataPaths.ts";
import type { IFileWatcher } from "../../files/common/iFileWatcher.ts";
import type { ILogger } from "../../log/common/iLogger.ts";
import type { IConfigurationChangeEvent } from "../common/iConfigurationService.ts";

import { type ConfigurationService, loadConfiguration } from "./configurationService.ts";

const disposables = ensureNoDisposablesAreLeakedInTestSuite();

describe("ConfigurationService — window from a .code-workspace file", () => {
    let userData: ITempWorkspace;
    let repo: ITempWorkspace;
    let webFile: string;
    let folderFile: string;

    beforeEach(() => {
        userData = createTempWorkspace({ prefix: "diode-cfg-user-" });
        repo = createTempWorkspace({ prefix: "diode-cfg-repo-" });
        webFile = repo.path("web.code-workspace");
        folderFile = repo.path(".diode/settings.json");
    });

    afterEach(() => {
        userData.dispose();
        repo.dispose();
    });

    function writeWorkspaceFile(settings: Record<string, unknown>, file = webFile): void {
        fs.writeFileSync(file, JSON.stringify({ folders: [{ path: "." }], settings }, null, 4));
    }

    function writeFolderSettings(settings: Record<string, unknown>): void {
        repo.writeFile(".diode/settings.json", JSON.stringify(settings));
    }

    async function load(
        options: { configuration?: string; logger?: ILogger; watcher?: IFileWatcher } = {},
    ): Promise<ConfigurationService> {
        const cfg = await loadConfiguration(
            resolveUserDataPaths({ homedir: "/never", userDataDir: userData.dir }),
            options.logger,
            options.watcher,
            testRegistry(),
            { folder: repo.dir, configuration: options.configuration ?? webFile },
        );
        return disposables.add(cfg);
    }

    function events(cfg: ConfigurationService): IConfigurationChangeEvent[] {
        const seen: IConfigurationChangeEvent[] = [];
        disposables.add(cfg.onDidChangeConfiguration((e) => seen.push(e)));
        return seen;
    }

    describe("read", () => {
        it("file's settings are the workspace layer; inspect and host data see it", async () => {
            writeWorkspaceFile({ "editor.tabSize": 2, "workbench.colorTheme": "Solar" });

            const cfg = await load();

            expect(cfg.get("editor.tabSize")).toBe(2);
            expect(cfg.get("workbench.colorTheme")).toBe("Solar");
            expect(cfg.inspect("editor.tabSize")).toEqual({
                default: 4,
                user: undefined,
                profile: undefined,
                workspace: 2,
                workspaceFolder: undefined,
                value: 2,
            });
            expect(cfg.getConfigurationData().workspace).toEqual({
                editor: { tabSize: 2 },
                workbench: { colorTheme: "Solar" },
            });
            expect(cfg.getConfigurationData().workspaceFolder).toEqual({});
        });

        // Maintainer's decision (option "a", upstream): what is shared by all monorepo modes
        // lives in `.diode/settings.json` and overrides the workspace file for the folder's
        // keys; mode differences live only in workspace files.
        it("folder's .diode/settings.json is a layer on top of the workspace file for resource/language-overridable", async () => {
            writeWorkspaceFile({ "editor.tabSize": 2, "files.exclude": { dist: true, out: true } });
            writeFolderSettings({ "editor.tabSize": 8, "files.exclude": { out: false } });

            const cfg = await load();

            expect(cfg.get("editor.tabSize")).toBe(8);
            // Object values merge by key, as between any layers.
            expect(cfg.get("files.exclude")).toEqual({ dist: true, out: false });
            expect(cfg.inspect("editor.tabSize")).toMatchObject({ workspace: 2, workspaceFolder: 8, value: 8 });
            expect(cfg.getConfigurationData().workspaceFolder).toEqual({
                editor: { tabSize: 8 },
                files: { exclude: { out: false } },
            });
        });

        it("folder's window key does not apply — the window takes it from the workspace file; the log names it", async () => {
            writeWorkspaceFile({ "workbench.colorTheme": "Solar" });
            writeFolderSettings({ "workbench.colorTheme": "Folder", "java.home": "/jdk" });
            const logger = makeLogger();

            const cfg = await load({ logger });

            expect(cfg.get("workbench.colorTheme")).toBe("Solar");
            expect(cfg.inspect("workbench.colorTheme").workspaceFolder).toBeUndefined();
            // An extension's `machine-overridable` is a machine property the folder may refine.
            expect(cfg.get("java.home")).toBe("/jdk");
            expect(logger.warn).toHaveBeenCalledWith(
                `${folderFile}: ignored settings that cannot be applied in this workspace (set them in the workspace file): workbench.colorTheme`,
            );
        });

        it("workspace file's application/machine keys do not apply; the log names them", async () => {
            writeWorkspaceFile({ "terminal.tier": "kitty", "update.mode": "none", "editor.tabSize": 2 });
            const logger = makeLogger();

            const cfg = await load({ logger });

            expect(cfg.get("terminal.tier")).toBe("auto");
            expect(cfg.get("update.mode")).toBe("default");
            expect(cfg.get("editor.tabSize")).toBe(2);
            expect(logger.warn).toHaveBeenCalledWith(
                `${webFile}: ignored settings that can be set only in User settings: terminal.tier, update.mode`,
            );
        });

        it("file without settings or with non-object settings — empty layer", async () => {
            fs.writeFileSync(webFile, `{ "folders": [{ "path": "." }] }`);
            expect((await load()).getConfigurationData().workspace).toEqual({});

            fs.writeFileSync(webFile, `{ "folders": [{ "path": "." }], "settings": 1 }`);
            expect((await load()).getConfigurationData().workspace).toEqual({});

            fs.writeFileSync(webFile, `[]`);
            expect((await load()).getConfigurationData().workspace).toEqual({});

            fs.writeFileSync(webFile, `null`);
            expect((await load()).getConfigurationData().workspace).toEqual({});
        });

        it("language section in the file's settings applies to the language", async () => {
            writeWorkspaceFile({ "[go]": { "editor.tabSize": 8 } });

            const cfg = await load();

            expect(cfg.get("editor.tabSize")).toBe(4);
            expect(cfg.get("editor.tabSize", { overrideIdentifier: "go" })).toBe(8);
        });
    });

    describe("workspace change", () => {
        // Monorepo scenario: same folder and `.diode/settings.json`, a different file
        // gives different settings.
        it("another file over the same folder — its settings and an event", async () => {
            const backendFile = repo.path("backend.code-workspace");
            writeWorkspaceFile({ "editor.tabSize": 2 });
            writeWorkspaceFile({ "editor.tabSize": 3 }, backendFile);
            const cfg = await load();
            const seen = events(cfg);

            await cfg.setWorkspace([repo.dir], backendFile);

            expect(cfg.get("editor.tabSize")).toBe(3);
            expect(seen.map((e) => e.affectedKeys)).toEqual([["editor.tabSize"]]);
        });

        it("the same file and folder pair is a no-op: no event, no watch rewiring", async () => {
            writeWorkspaceFile({ "editor.tabSize": 2 });
            const watcher = new FakeFileWatcher();
            const cfg = await load({ watcher });
            const seen = events(cfg);
            const watchFile = vi.spyOn(watcher, "watchFile");

            await cfg.setWorkspace([path.join(repo.dir, ".")], webFile);

            expect(seen).toHaveLength(0);
            expect(watchFile).not.toHaveBeenCalled();
        });

        it("same folder but a different workspace file — not a no-op", async () => {
            const watcher = new FakeFileWatcher();
            writeWorkspaceFile({});
            const cfg = await load({ watcher });
            const watchFile = vi.spyOn(watcher, "watchFile");

            await cfg.setWorkspace([repo.dir], repo.path("backend.code-workspace"));

            expect(watchFile).toHaveBeenCalledWith(repo.path("backend.code-workspace"), expect.any(Function));
        });

        it("from the file to the same folder directly: .diode/settings.json is the workspace layer again", async () => {
            writeWorkspaceFile({ "workbench.colorTheme": "Solar", "editor.tabSize": 2 });
            writeFolderSettings({ "workbench.colorTheme": "Folder" });
            const cfg = await load();
            expect(cfg.get("workbench.colorTheme")).toBe("Solar");

            await cfg.setWorkspace([repo.dir]);

            expect(cfg.get("workbench.colorTheme")).toBe("Folder");
            expect(cfg.get("editor.tabSize")).toBe(4);
            expect(cfg.getConfigurationData().workspaceFolder).toEqual({});
        });
    });

    describe("live-reload", () => {
        it("watches both the workspace file and the folder file", async () => {
            writeWorkspaceFile({ "editor.tabSize": 2 });
            const watcher = new FakeFileWatcher();
            const cfg = await load({ watcher });
            const seen = events(cfg);
            expect(watcher.watched()).toEqual(expect.arrayContaining([webFile, folderFile]));

            writeWorkspaceFile({ "editor.tabSize": 3 });
            watcher.fire(webFile);
            await expect.poll(() => cfg.get("editor.tabSize")).toBe(3);

            writeFolderSettings({ "editor.tabSize": 5 });
            watcher.fire(folderFile);
            await expect.poll(() => cfg.get("editor.tabSize")).toBe(5);
            expect(seen.map((e) => e.affectedKeys)).toEqual([["editor.tabSize"], ["editor.tabSize"]]);
        });

        it("from the file to a folder directly — the workspace file watch is removed", async () => {
            writeWorkspaceFile({});
            const watcher = new FakeFileWatcher();
            const cfg = await load({ watcher });

            await cfg.setWorkspace([repo.dir]);

            expect(watcher.watched()).not.toContain(webFile);
            expect(watcher.watched()).toContain(folderFile);
        });
    });

    describe("write", () => {
        it("workspace target goes into the file's settings block: other contents and comments stay intact", async () => {
            fs.writeFileSync(
                webFile,
                `{
    // frontend mode
    "folders": [{ "path": "." }],
    "settings": {
        "editor.tabSize": 2
    }
}`,
            );
            const cfg = await load();
            const seen = events(cfg);

            await cfg.updateValue("files.exclude", { dist: true }, "workspace");

            expect(cfg.get("files.exclude")).toEqual({ dist: true });
            expect(seen.map((e) => e.affectedKeys)).toEqual([["files.exclude.dist"]]);
            const text = fs.readFileSync(webFile, "utf8");
            expect(text).toContain("// frontend mode");
            expect(JSON.parse(text.replace(/\/\/.*\n/, ""))).toEqual({
                folders: [{ path: "." }],
                settings: { "editor.tabSize": 2, "files.exclude": { dist: true } },
            });
            expect(fs.existsSync(folderFile)).toBe(false);
        });

        it("file without a settings block — the block is created", async () => {
            fs.writeFileSync(webFile, `{ "folders": [{ "path": "." }] }`);
            const cfg = await load();

            await cfg.updateValue("editor.tabSize", 3, "workspace");

            expect(JSON.parse(fs.readFileSync(webFile, "utf8"))).toEqual({
                folders: [{ path: "." }],
                settings: { "editor.tabSize": 3 },
            });
            expect(cfg.get("editor.tabSize")).toBe(3);
        });

        it("workspaceFolder target goes to the folder's .diode/settings.json, on top of the workspace file", async () => {
            writeWorkspaceFile({ "editor.tabSize": 2 });
            const cfg = await load();

            await cfg.updateValue("editor.tabSize", 6, "workspaceFolder");

            expect(cfg.get("editor.tabSize")).toBe(6);
            expect(cfg.inspect("editor.tabSize")).toMatchObject({ workspace: 2, workspaceFolder: 6 });
            expect(JSON.parse(fs.readFileSync(folderFile, "utf8"))).toEqual({ "editor.tabSize": 6 });
        });

        it("a window key to folder settings is rejected with the upstream message, no file is created", async () => {
            writeWorkspaceFile({});
            const cfg = await load();

            await expect(cfg.updateValue("workbench.colorTheme", "X", "workspaceFolder")).rejects.toThrow(
                "Unable to write to Folder Settings because workbench.colorTheme does not support the folder resource scope.",
            );
            expect(fs.existsSync(folderFile)).toBe(false);
        });

        it("an application key to the workspace file is rejected", async () => {
            writeWorkspaceFile({});
            const cfg = await load();

            await expect(cfg.updateValue("update.mode", "none", "workspace")).rejects.toThrow(
                "Unable to write update.mode to Workspace Settings. This setting can be written only into User settings.",
            );
        });
    });
});

describe("ConfigurationService — workspaceFolder target in a folder window", () => {
    let userData: ITempWorkspace;
    let folder: ITempWorkspace;

    beforeEach(() => {
        userData = createTempWorkspace({ prefix: "diode-cfg-user-" });
        folder = createTempWorkspace({ prefix: "diode-cfg-ws-" });
    });

    afterEach(() => {
        userData.dispose();
        folder.dispose();
    });

    async function load(withFolder: boolean): Promise<ConfigurationService> {
        const cfg = await loadConfiguration(
            resolveUserDataPaths({ homedir: "/never", userDataDir: userData.dir }),
            undefined,
            undefined,
            testRegistry(),
            withFolder ? { folder: folder.dir } : undefined,
        );
        return disposables.add(cfg);
    }

    it("writes to the folder's .diode/settings.json — the workspace layer", async () => {
        const cfg = await load(true);

        await cfg.updateValue("editor.tabSize", 6, "workspaceFolder");

        expect(cfg.inspect("editor.tabSize")).toMatchObject({ workspace: 6, workspaceFolder: undefined, value: 6 });
        expect(JSON.parse(fs.readFileSync(folder.path(".diode/settings.json"), "utf8"))).toEqual({
            "editor.tabSize": 6,
        });
    });

    it("scope check is the folder one, even when the file is the same", async () => {
        const cfg = await load(true);

        await expect(cfg.updateValue("workbench.colorTheme", "X", "workspaceFolder")).rejects.toThrow(
            "does not support the folder resource scope",
        );
    });

    it("no folder — upstream rejection", async () => {
        const cfg = await load(false);

        await expect(cfg.updateValue("editor.tabSize", 6, "workspaceFolder")).rejects.toThrow(
            "Unable to write to Workspace Settings because no workspace is opened.",
        );
    });
});
