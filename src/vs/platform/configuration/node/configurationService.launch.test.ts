import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeFileWatcher, testRegistry } from "../../../../TestUtils/configurationLayersFixture.ts";
import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../TestUtils/disposableLeaks.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import { resolveUserDataPaths } from "../../environment/node/userDataPaths.ts";
import type { IFileWatcher } from "../../files/common/iFileWatcher.ts";
import { LAUNCH_INVALID_CONFIGURATION_ERROR, NO_WORKSPACE_OPENED_ERROR } from "../common/workspaceSettings.ts";

import { type ConfigurationService, loadConfiguration } from "./configurationService.ts";

const disposables = ensureNoDisposablesAreLeakedInTestSuite();

const RUN = { name: "Run", type: "synthetic", request: "launch" };

describe("ConfigurationService — the standalone launch section", () => {
    let userData: ITempWorkspace;
    let folder: ITempWorkspace;
    let launchFile: string;

    beforeEach(() => {
        userData = createTempWorkspace({ prefix: "diode-cfg-user-" });
        folder = createTempWorkspace({ prefix: "diode-cfg-ws-" });
        launchFile = folder.path(".diode/launch.json");
    });

    afterEach(() => {
        userData.dispose();
        folder.dispose();
    });

    async function load(
        options: { folder?: string; configuration?: string; watcher?: IFileWatcher } = {},
    ): Promise<ConfigurationService> {
        const cfg = await loadConfiguration(
            resolveUserDataPaths({ homedir: "/never", userDataDir: userData.dir }),
            undefined,
            options.watcher,
            testRegistry(),
            options.folder === undefined ? undefined : { folder: options.folder, configuration: options.configuration },
        );
        return disposables.add(cfg);
    }

    describe("read", () => {
        it("the folder's .diode/launch.json is the launch section of the workspace layer, over settings.json", async () => {
            folder.writeFile(".diode/settings.json", `{ "launch": { "version": "0.1.0" }, "editor.tabSize": 8 }`);
            folder.writeFile(
                ".diode/launch.json",
                `{\n // run\n "version": "0.2.0", "configurations": [${JSON.stringify(RUN)}], }`,
            );

            const cfg = await load({ folder: folder.dir });

            expect(cfg.inspect("launch").workspace).toEqual({ version: "0.2.0", configurations: [RUN] });
            expect(cfg.get("editor.tabSize")).toBe(8);
        });

        it("without launch.json the launch of settings.json stays", async () => {
            folder.writeFile(".diode/settings.json", `{ "launch": { "configurations": [] } }`);

            const cfg = await load({ folder: folder.dir });

            expect(cfg.inspect("launch").workspace).toEqual({ configurations: [] });
        });

        it("a .code-workspace window: the file's top-level launch block is the workspace layer, launch.json the folder's", async () => {
            const workspaceFile = folder.writeFile(
                "web.code-workspace",
                JSON.stringify({ folders: [{ path: "." }], launch: { configurations: [RUN] }, settings: {} }),
            );
            folder.writeFile(".diode/launch.json", `{ "version": "0.2.0" }`);
            const watcher = new FakeFileWatcher();

            const cfg = await load({ folder: folder.dir, configuration: workspaceFile, watcher });

            expect(cfg.inspect("launch")).toMatchObject({
                workspace: { configurations: [RUN] },
                workspaceFolder: { version: "0.2.0" },
            });
            expect(watcher.watched()).toEqual(expect.arrayContaining([workspaceFile, launchFile]));
        });

        it("a .code-workspace file without a launch block gives the workspace layer none", async () => {
            const workspaceFile = folder.writeFile("web.code-workspace", `{ "folders": [{ "path": "." }] }`);

            const cfg = await load({ folder: folder.dir, configuration: workspaceFile });

            expect(cfg.inspect("launch").workspace).toBeUndefined();
        });
    });

    describe("write", () => {
        it("launch.<x> in Workspace creates .diode/launch.json and edits <x>", async () => {
            const cfg = await load({ folder: folder.dir });

            await cfg.updateValue("launch.configurations", [RUN], "workspace");

            expect(JSON.parse(fs.readFileSync(launchFile, "utf-8"))).toEqual({ configurations: [RUN] });
            expect(cfg.inspect("launch").workspace).toEqual({ configurations: [RUN] });
        });

        it("the launch key replaces the whole file, even a broken one; launch.<x> refuses a broken file", async () => {
            folder.writeFile(".diode/launch.json", `{ "configurations": [ `);
            const cfg = await load({ folder: folder.dir });

            await expect(cfg.updateValue("launch.version", "0.2.0", "workspaceFolder")).rejects.toThrow(
                LAUNCH_INVALID_CONFIGURATION_ERROR,
            );
            await cfg.updateValue("launch", { version: "0.2.0" }, "workspaceFolder");

            expect(JSON.parse(fs.readFileSync(launchFile, "utf-8"))).toEqual({ version: "0.2.0" });
        });

        it("a .code-workspace window writes Workspace to the folder's launch.json", async () => {
            const workspaceFile = folder.writeFile("web.code-workspace", `{ "folders": [{ "path": "." }] }`);
            const cfg = await load({ folder: folder.dir, configuration: workspaceFile });

            await cfg.updateValue("launch.version", "0.2.0", "workspace");

            expect(JSON.parse(fs.readFileSync(launchFile, "utf-8"))).toEqual({ version: "0.2.0" });
            expect(fs.readFileSync(workspaceFile, "utf-8")).not.toContain("0.2.0");
        });

        it("Workspace without a folder is refused as upstream; User is an ordinary settings key", async () => {
            const cfg = await load();

            await expect(cfg.updateValue("launch.version", "0.2.0", "workspace")).rejects.toThrow(
                NO_WORKSPACE_OPENED_ERROR,
            );
            await cfg.updateValue("launch.version", "0.2.0", "user");

            expect(cfg.inspect("launch.version").user).toBe("0.2.0");
        });
    });

    it("live-reload: an edit of launch.json on disk fires affectsConfiguration('launch')", async () => {
        const watcher = new FakeFileWatcher();
        const cfg = await load({ folder: folder.dir, watcher });
        const affected: boolean[] = [];
        disposables.add(cfg.onDidChangeConfiguration((e) => affected.push(e.affectsConfiguration("launch"))));

        folder.writeFile(".diode/launch.json", JSON.stringify({ configurations: [RUN] }));
        watcher.fire(launchFile);

        await vi.waitFor(() => {
            expect(affected).toEqual([true]);
        });
        expect(cfg.get("launch.configurations")).toEqual([RUN]);
    });
});
