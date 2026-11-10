import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeFileWatcher, testRegistry } from "../../../../TestUtils/configurationLayersFixture.ts";
import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../TestUtils/disposableLeaks.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import { resolveUserDataPaths } from "../../environment/node/userDataPaths.ts";
import type { IFileWatcher } from "../../files/common/iFileWatcher.ts";
import type { IConfigurationChangeEvent } from "../common/iConfigurationService.ts";
import { NO_WORKSPACE_OPENED_ERROR } from "../common/workspaceSettings.ts";

import { type ConfigurationService, loadConfiguration } from "./configurationService.ts";

const disposables = ensureNoDisposablesAreLeakedInTestSuite();

const BUILD_TASK = { label: "Build", type: "shell", command: "make", group: { kind: "build", isDefault: true } };

describe("ConfigurationService — the standalone tasks section", () => {
    let userData: ITempWorkspace;
    let folder: ITempWorkspace;
    let tasksFile: string;

    beforeEach(() => {
        userData = createTempWorkspace({ prefix: "diode-cfg-user-" });
        folder = createTempWorkspace({ prefix: "diode-cfg-ws-" });
        tasksFile = folder.path(".diode/tasks.json");
    });

    afterEach(() => {
        userData.dispose();
        folder.dispose();
    });

    function paths(profile?: string) {
        return resolveUserDataPaths({ homedir: "/never", userDataDir: userData.dir, profile });
    }

    async function load(
        options: { folder?: string; configuration?: string; watcher?: IFileWatcher; profile?: string } = {},
    ): Promise<ConfigurationService> {
        const cfg = await loadConfiguration(
            paths(options.profile),
            undefined,
            options.watcher,
            testRegistry(),
            options.folder === undefined ? undefined : { folder: options.folder, configuration: options.configuration },
        );
        return disposables.add(cfg);
    }

    function events(cfg: ConfigurationService): IConfigurationChangeEvent[] {
        const seen: IConfigurationChangeEvent[] = [];
        disposables.add(cfg.onDidChangeConfiguration((e) => seen.push(e)));
        return seen;
    }

    describe("read", () => {
        it("the folder's .diode/tasks.json is the tasks section of the workspace layer, over settings.json", async () => {
            folder.writeFile(".diode/settings.json", `{ "tasks": { "version": "0.1.0" }, "editor.tabSize": 8 }`);
            folder.writeFile(".diode/tasks.json", `{\n // build\n "version": "2.0.0", "tasks": [], }`);

            const cfg = await load({ folder: folder.dir });

            expect(cfg.get("tasks")).toEqual({ version: "2.0.0", tasks: [] });
            expect(cfg.get("tasks.version")).toBe("2.0.0");
            expect(cfg.get("editor.tabSize")).toBe(8);
            expect(cfg.inspect("tasks.version").workspace).toBe("2.0.0");
            expect(cfg.getConfigurationData().workspace).toEqual({
                tasks: { version: "2.0.0", tasks: [] },
                editor: { tabSize: 8 },
            });
        });

        it("without tasks.json there is no tasks section", async () => {
            const cfg = await load({ folder: folder.dir });

            expect(cfg.get("tasks")).toBeUndefined();
            expect(cfg.getConfigurationData().workspace).toEqual({});
        });

        it("a .code-workspace window reads the folder's tasks.json into the folder layer", async () => {
            const workspaceFile = folder.writeFile("web.code-workspace", `{ "folders": [{ "path": "." }] }`);
            folder.writeFile(".diode/tasks.json", `{ "version": "2.0.0" }`);

            const cfg = await load({ folder: folder.dir, configuration: workspaceFile });

            expect(cfg.inspect("tasks.version")).toMatchObject({ workspace: undefined, workspaceFolder: "2.0.0" });
        });

        it("the profile's tasks.json is the tasks section of the user layer; a named profile has its own", async () => {
            const defaultTasks = path.join(path.dirname(paths().settingsFile), "tasks.json");
            fs.mkdirSync(path.dirname(defaultTasks), { recursive: true });
            fs.writeFileSync(defaultTasks, `{ "version": "1.0.0" }`);

            expect((await load()).inspect("tasks.version").user).toBe("1.0.0");

            const profileTasks = path.join(path.dirname(paths("work").settingsFile), "tasks.json");
            fs.mkdirSync(path.dirname(profileTasks), { recursive: true });
            fs.writeFileSync(profileTasks, `{ "version": "2.0.0" }`);

            expect((await load({ profile: "work" })).inspect("tasks.version")).toMatchObject({
                user: undefined,
                profile: "2.0.0",
            });
        });
    });

    describe("write", () => {
        it("tasks.<x> in Workspace creates .diode/tasks.json from the default content and edits <x>", async () => {
            const cfg = await load({ folder: folder.dir });
            const seen = events(cfg);

            await cfg.updateValue("tasks.version", "2.0.0", "workspace");
            await cfg.updateValue("tasks.tasks", [BUILD_TASK], "workspace");

            expect(JSON.parse(fs.readFileSync(tasksFile, "utf-8"))).toEqual({ version: "2.0.0", tasks: [BUILD_TASK] });
            expect(fs.readFileSync(tasksFile, "utf-8")).toMatch(
                /^\{\n\t"version": "2\.0\.0",\n\t"tasks": \[\n\t\t\{\n/,
            );
            expect(cfg.get("tasks.tasks")).toEqual([BUILD_TASK]);
            expect(fs.existsSync(folder.path(".diode/settings.json"))).toBe(false);
            // The first write only adds the default content, the same version: one event for the tasks list.
            expect(seen.map((e) => e.affectsConfiguration("tasks"))).toEqual([true, true]);
            expect(seen[1].affectsConfiguration("tasks.tasks")).toBe(true);
        });

        it("keeps the rest of the file: comments and formatting", async () => {
            folder.writeFile(".diode/tasks.json", `{\n    // keep me\n    "version": "2.0.0",\n    "tasks": []\n}\n`);
            const cfg = await load({ folder: folder.dir });

            await cfg.updateValue("tasks.tasks", [], "workspaceFolder");
            await cfg.updateValue("tasks.options", { cwd: "src" }, "workspace");

            expect(fs.readFileSync(tasksFile, "utf-8")).toBe(
                `{\n    // keep me\n    "version": "2.0.0",\n    "tasks": [],\n    "options": {\n        "cwd": "src"\n    }\n}\n`,
            );
        });

        it("the tasks key replaces the whole file; undefined removes a key", async () => {
            folder.writeFile(".diode/tasks.json", `{ "version": "2.0.0", "tasks": [] }`);
            const cfg = await load({ folder: folder.dir });

            await cfg.updateValue("tasks", { version: "2.0.0", tasks: [BUILD_TASK] }, "workspace");
            expect(cfg.get("tasks")).toEqual({ version: "2.0.0", tasks: [BUILD_TASK] });

            await cfg.updateValue("tasks.tasks", undefined, "workspace");
            expect(JSON.parse(fs.readFileSync(tasksFile, "utf-8"))).toEqual({ version: "2.0.0" });
            expect(cfg.get("tasks.tasks")).toBeUndefined();
        });

        it("a .code-workspace window writes Workspace and WorkspaceFolder to the folder's tasks.json", async () => {
            const workspaceFile = folder.writeFile("web.code-workspace", `{ "folders": [{ "path": "." }] }`);
            const cfg = await load({ folder: folder.dir, configuration: workspaceFile });

            await cfg.updateValue("tasks.version", "2.0.0", "workspace");
            await cfg.updateValue("tasks.tasks", [BUILD_TASK], "workspaceFolder");

            expect(JSON.parse(fs.readFileSync(tasksFile, "utf-8"))).toEqual({ version: "2.0.0", tasks: [BUILD_TASK] });
            expect(fs.readFileSync(workspaceFile, "utf-8")).toBe(`{ "folders": [{ "path": "." }] }`);
            expect(cfg.inspect("tasks.tasks").workspaceFolder).toEqual([BUILD_TASK]);
        });

        it("Workspace without a folder is refused as upstream", async () => {
            const cfg = await load();

            await expect(cfg.updateValue("tasks.version", "2.0.0", "workspace")).rejects.toThrow(
                NO_WORKSPACE_OPENED_ERROR,
            );
        });

        it("User writes the profile's tasks.json, not settings.json", async () => {
            const cfg = await load({ folder: folder.dir });

            await cfg.updateValue("tasks.version", "2.0.0", "user");

            const userTasks = path.join(path.dirname(paths().settingsFile), "tasks.json");
            expect(JSON.parse(fs.readFileSync(userTasks, "utf-8"))).toEqual({ version: "2.0.0", tasks: [] });
            expect(fs.existsSync(paths().settingsFile)).toBe(false);
            expect(cfg.inspect("tasks.version").user).toBe("2.0.0");

            const work = await load({ profile: "work" });
            await work.updateValue("tasks.version", "3.0.0", "user");
            expect(work.inspect("tasks.version")).toMatchObject({ user: undefined, profile: "3.0.0" });
        });
    });

    describe("live-reload", () => {
        it("watches tasks.json next to the settings files; an edit on disk fires affectsConfiguration('tasks')", async () => {
            const watcher = new FakeFileWatcher();
            const cfg = await load({ folder: folder.dir, watcher });
            const seen = events(cfg);
            const userTasks = path.join(path.dirname(paths().settingsFile), "tasks.json");
            expect(watcher.watched()).toEqual(expect.arrayContaining([tasksFile, userTasks]));

            folder.writeFile(".diode/tasks.json", JSON.stringify({ version: "2.0.0", tasks: [BUILD_TASK] }));
            watcher.fire(tasksFile);
            await vi.waitFor(() => {
                expect(cfg.get("tasks.tasks")).toEqual([BUILD_TASK]);
            });
            expect(seen).toHaveLength(1);
            expect(seen[0].affectsConfiguration("tasks")).toBe(true);

            fs.mkdirSync(path.dirname(userTasks), { recursive: true });
            fs.writeFileSync(userTasks, `{ "version": "1.0.0" }`);
            watcher.fire(userTasks);
            await vi.waitFor(() => {
                expect(cfg.inspect("tasks.version").user).toBe("1.0.0");
            });
        });
    });
});
