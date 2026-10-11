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

/**
 * Окно, открытое файлом `.code-workspace` (раскладка эталона): слой воркспейса —
 * блок `settings` файла, `.diode/settings.json` папки — слой папки поверх него
 * с ключами `FOLDER_SCOPES`.
 */
describe("ConfigurationService — окно из файла .code-workspace", () => {
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

    describe("чтение", () => {
        it("settings файла — слой воркспейса; inspect и данные для хоста видят его", async () => {
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

        // Решение человека (вариант «а», эталон): общее для всех режимов монорепы
        // живёт в `.diode/settings.json` и перебивает файл воркспейса по ключам
        // папки; различия режимов — только в файлах воркспейса.
        it(".diode/settings.json папки — слой поверх файла воркспейса по resource/language-overridable", async () => {
            writeWorkspaceFile({ "editor.tabSize": 2, "files.exclude": { dist: true, out: true } });
            writeFolderSettings({ "editor.tabSize": 8, "files.exclude": { out: false } });

            const cfg = await load();

            expect(cfg.get("editor.tabSize")).toBe(8);
            // Объектные значения сливаются по ключам, как между любыми слоями.
            expect(cfg.get("files.exclude")).toEqual({ dist: true, out: false });
            expect(cfg.inspect("editor.tabSize")).toMatchObject({ workspace: 2, workspaceFolder: 8, value: 8 });
            expect(cfg.getConfigurationData().workspaceFolder).toEqual({
                editor: { tabSize: 8 },
                files: { exclude: { out: false } },
            });
        });

        it("window-ключ папки не действует — его окно берёт из файла воркспейса; лог называет", async () => {
            writeWorkspaceFile({ "workbench.colorTheme": "Solar" });
            writeFolderSettings({ "workbench.colorTheme": "Folder", "java.home": "/jdk" });
            const logger = makeLogger();

            const cfg = await load({ logger });

            expect(cfg.get("workbench.colorTheme")).toBe("Solar");
            expect(cfg.inspect("workbench.colorTheme").workspaceFolder).toBeUndefined();
            // `machine-overridable` расширения — свойство машины, которое папке можно уточнить.
            expect(cfg.get("java.home")).toBe("/jdk");
            expect(logger.warn).toHaveBeenCalledWith(
                `${folderFile}: ignored settings that cannot be applied in this workspace (set them in the workspace file): workbench.colorTheme`,
            );
        });

        it("application/machine-ключи файла воркспейса не действуют; лог называет", async () => {
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

        it("файл без settings или с settings-не-объектом — слой пуст", async () => {
            fs.writeFileSync(webFile, `{ "folders": [{ "path": "." }] }`);
            expect((await load()).getConfigurationData().workspace).toEqual({});

            fs.writeFileSync(webFile, `{ "folders": [{ "path": "." }], "settings": 1 }`);
            expect((await load()).getConfigurationData().workspace).toEqual({});

            fs.writeFileSync(webFile, `[]`);
            expect((await load()).getConfigurationData().workspace).toEqual({});

            fs.writeFileSync(webFile, `null`);
            expect((await load()).getConfigurationData().workspace).toEqual({});
        });

        it("секция языка в settings файла действует для языка", async () => {
            writeWorkspaceFile({ "[go]": { "editor.tabSize": 8 } });

            const cfg = await load();

            expect(cfg.get("editor.tabSize")).toBe(4);
            expect(cfg.get("editor.tabSize", { overrideIdentifier: "go" })).toBe(8);
        });
    });

    describe("смена воркспейса", () => {
        // Сценарий монорепы: те же папка и `.diode/settings.json`, другой файл —
        // другие настройки.
        it("другой файл над той же папкой — его настройки и событие", async () => {
            const backendFile = repo.path("backend.code-workspace");
            writeWorkspaceFile({ "editor.tabSize": 2 });
            writeWorkspaceFile({ "editor.tabSize": 3 }, backendFile);
            const cfg = await load();
            const seen = events(cfg);

            await cfg.setWorkspace([repo.dir], backendFile);

            expect(cfg.get("editor.tabSize")).toBe(3);
            expect(seen.map((e) => e.affectedKeys)).toEqual([["editor.tabSize"]]);
        });

        it("та же пара файла и папки — no-op: ни события, ни перестановки watch'ей", async () => {
            writeWorkspaceFile({ "editor.tabSize": 2 });
            const watcher = new FakeFileWatcher();
            const cfg = await load({ watcher });
            const seen = events(cfg);
            const watchFile = vi.spyOn(watcher, "watchFile");

            await cfg.setWorkspace([path.join(repo.dir, ".")], webFile);

            expect(seen).toHaveLength(0);
            expect(watchFile).not.toHaveBeenCalled();
        });

        it("та же папка, но другой файл воркспейса — не no-op", async () => {
            const watcher = new FakeFileWatcher();
            writeWorkspaceFile({});
            const cfg = await load({ watcher });
            const watchFile = vi.spyOn(watcher, "watchFile");

            await cfg.setWorkspace([repo.dir], repo.path("backend.code-workspace"));

            expect(watchFile).toHaveBeenCalledWith(repo.path("backend.code-workspace"), expect.any(Function));
        });

        // Open Folder на ту же папку: файл воркспейса уходит, `.diode/settings.json`
        // снова сам — слой воркспейса, и его window-ключи снова действуют.
        it("из файла в ту же папку напрямую: .diode/settings.json снова слой воркспейса", async () => {
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
        it("следит и за файлом воркспейса, и за файлом папки", async () => {
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

        it("из файла в папку напрямую — watch файла воркспейса снят", async () => {
            writeWorkspaceFile({});
            const watcher = new FakeFileWatcher();
            const cfg = await load({ watcher });

            await cfg.setWorkspace([repo.dir]);

            expect(watcher.watched()).not.toContain(webFile);
            expect(watcher.watched()).toContain(folderFile);
        });
    });

    describe("запись", () => {
        it("цель workspace — в блок settings файла: остальное содержимое и комментарии целы", async () => {
            fs.writeFileSync(
                webFile,
                `{
    // режим фронтенда
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
            expect(text).toContain("// режим фронтенда");
            expect(JSON.parse(text.replace(/\/\/.*\n/, ""))).toEqual({
                folders: [{ path: "." }],
                settings: { "editor.tabSize": 2, "files.exclude": { dist: true } },
            });
            expect(fs.existsSync(folderFile)).toBe(false);
        });

        it("файл без блока settings — блок заводится", async () => {
            fs.writeFileSync(webFile, `{ "folders": [{ "path": "." }] }`);
            const cfg = await load();

            await cfg.updateValue("editor.tabSize", 3, "workspace");

            expect(JSON.parse(fs.readFileSync(webFile, "utf8"))).toEqual({
                folders: [{ path: "." }],
                settings: { "editor.tabSize": 3 },
            });
            expect(cfg.get("editor.tabSize")).toBe(3);
        });

        it("цель workspaceFolder — в .diode/settings.json папки, поверх файла воркспейса", async () => {
            writeWorkspaceFile({ "editor.tabSize": 2 });
            const cfg = await load();

            await cfg.updateValue("editor.tabSize", 6, "workspaceFolder");

            expect(cfg.get("editor.tabSize")).toBe(6);
            expect(cfg.inspect("editor.tabSize")).toMatchObject({ workspace: 2, workspaceFolder: 6 });
            expect(JSON.parse(fs.readFileSync(folderFile, "utf8"))).toEqual({ "editor.tabSize": 6 });
        });

        it("window-ключ в настройки папки отклоняется текстом эталона, файл не создаётся", async () => {
            writeWorkspaceFile({});
            const cfg = await load();

            await expect(cfg.updateValue("workbench.colorTheme", "X", "workspaceFolder")).rejects.toThrow(
                "Unable to write to Folder Settings because workbench.colorTheme does not support the folder resource scope.",
            );
            expect(fs.existsSync(folderFile)).toBe(false);
        });

        it("application-ключ в файл воркспейса отклоняется", async () => {
            writeWorkspaceFile({});
            const cfg = await load();

            await expect(cfg.updateValue("update.mode", "none", "workspace")).rejects.toThrow(
                "Unable to write update.mode to Workspace Settings. This setting can be written only into User settings.",
            );
        });
    });
});

/** Окно из папки напрямую: цель-папка — тот же `.diode/settings.json`, что у воркспейса. */
describe("ConfigurationService — цель workspaceFolder у окна из папки", () => {
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

    it("пишет в .diode/settings.json папки — слой воркспейса", async () => {
        const cfg = await load(true);

        await cfg.updateValue("editor.tabSize", 6, "workspaceFolder");

        expect(cfg.inspect("editor.tabSize")).toMatchObject({ workspace: 6, workspaceFolder: undefined, value: 6 });
        expect(JSON.parse(fs.readFileSync(folder.path(".diode/settings.json"), "utf8"))).toEqual({
            "editor.tabSize": 6,
        });
    });

    it("проверка скоупа — папочная, даже когда файл тот же", async () => {
        const cfg = await load(true);

        await expect(cfg.updateValue("workbench.colorTheme", "X", "workspaceFolder")).rejects.toThrow(
            "does not support the folder resource scope",
        );
    });

    it("без папки — отказ эталона", async () => {
        const cfg = await load(false);

        await expect(cfg.updateValue("editor.tabSize", 6, "workspaceFolder")).rejects.toThrow(
            "Unable to write to Workspace Settings because no workspace is opened.",
        );
    });
});
