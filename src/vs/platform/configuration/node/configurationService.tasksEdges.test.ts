import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeFileWatcher, testRegistry } from "../../../../TestUtils/configurationLayersFixture.ts";
import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../TestUtils/disposableLeaks.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import { resolveUserDataPaths } from "../../environment/node/userDataPaths.ts";
import type { IFileWatcher } from "../../files/common/iFileWatcher.ts";

import { type ConfigurationService, loadConfiguration } from "./configurationService.ts";

const disposables = ensureNoDisposablesAreLeakedInTestSuite();

const BUILD_TASK = { label: "Build", type: "shell", command: "make", group: { kind: "build", isDefault: true } };

describe("ConfigurationService — tasks.json and settings.json edits on the edges", () => {
    let userData: ITempWorkspace;
    let folder: ITempWorkspace;
    let tasksFile: string;
    let settingsFile: string;

    beforeEach(() => {
        userData = createTempWorkspace({ prefix: "diode-cfg-user-" });
        folder = createTempWorkspace({ prefix: "diode-cfg-ws-" });
        tasksFile = folder.path(".diode/tasks.json");
        settingsFile = folder.path(".diode/settings.json");
    });

    afterEach(() => {
        userData.dispose();
        folder.dispose();
    });

    async function load(watcher?: IFileWatcher): Promise<ConfigurationService> {
        const cfg = await loadConfiguration(
            resolveUserDataPaths({ homedir: "/never", userDataDir: userData.dir }),
            undefined,
            watcher,
            testRegistry(),
            { folder: folder.dir },
        );
        return disposables.add(cfg);
    }

    describe("indentation", () => {
        it("a 2-space tasks.json keeps 2-space indentation after an edit", async () => {
            folder.writeFile(".diode/tasks.json", `{\n  "version": "2.0.0"\n}`);
            const cfg = await load();

            await cfg.updateValue("tasks.options", { cwd: "src" }, "workspace");

            expect(fs.readFileSync(tasksFile, "utf-8")).toBe(
                `{\n  "version": "2.0.0",\n  "options": {\n    "cwd": "src"\n  }\n}`,
            );
        });

        it("a 2-space settings.json keeps 2-space indentation after an edit", async () => {
            folder.writeFile(".diode/settings.json", `{\n  "editor.tabSize": 2\n}`);
            const cfg = await load();

            await cfg.updateValue("editor.insertSpaces", true, "workspace");

            expect(fs.readFileSync(settingsFile, "utf-8")).toBe(
                `{\n  "editor.tabSize": 2,\n  "editor.insertSpaces": true\n}`,
            );
        });

        it("a new settings.json is indented with 4 spaces, a tab-indented one keeps tabs", async () => {
            const cfg = await load();

            await cfg.updateValue("editor.tabSize", 2, "workspace");
            expect(fs.readFileSync(settingsFile, "utf-8")).toBe(`{\n    "editor.tabSize": 2\n}`);

            folder.writeFile(".diode/settings.json", `{\n\t"editor.tabSize": 2\n}`);
            await cfg.updateValue("editor.insertSpaces", false, "workspace");
            expect(fs.readFileSync(settingsFile, "utf-8")).toBe(
                `{\n\t"editor.tabSize": 2,\n\t"editor.insertSpaces": false\n}`,
            );
        });
    });

    describe("a tasks.json with a syntax error", () => {
        it("refuses an edit of tasks.<x> and leaves the file as it was, as upstream", async () => {
            const broken = `{\n\t"version": "2.0.0",\n\t"tasks": [ { "label": \n}\n`;
            folder.writeFile(".diode/tasks.json", broken);
            const cfg = await load();

            await expect(cfg.updateValue("tasks.tasks", [BUILD_TASK], "workspace")).rejects.toThrow(Error);
            expect(fs.readFileSync(tasksFile, "utf-8")).toBe(broken);
        });

        it("is replaced as a whole by the tasks key", async () => {
            folder.writeFile(".diode/tasks.json", `{ "version": "2.0.0", "tasks": [ {`);
            const cfg = await load();

            await cfg.updateValue("tasks", { version: "2.0.0", tasks: [BUILD_TASK] }, "workspace");

            expect(JSON.parse(fs.readFileSync(tasksFile, "utf-8"))).toEqual({ version: "2.0.0", tasks: [BUILD_TASK] });
        });
    });

    it("an existing empty tasks.json is edited, not filled with the default content", async () => {
        folder.writeFile(".diode/tasks.json", "");
        const cfg = await load();

        await cfg.updateValue("tasks.tasks", [BUILD_TASK], "workspace");

        expect(JSON.parse(fs.readFileSync(tasksFile, "utf-8"))).toEqual({ tasks: [BUILD_TASK] });
    });

    it("concurrent writes of different keys all land in tasks.json", async () => {
        const cfg = await load();

        await Promise.all([
            cfg.updateValue("tasks.version", "2.0.0", "workspace"),
            cfg.updateValue("tasks.tasks", [BUILD_TASK], "workspace"),
            cfg.updateValue("tasks.options", { cwd: "src" }, "workspace"),
        ]);

        expect(JSON.parse(fs.readFileSync(tasksFile, "utf-8"))).toEqual({
            version: "2.0.0",
            tasks: [BUILD_TASK],
            options: { cwd: "src" },
        });
    });

    it("a CRLF tasks.json stays CRLF and unicode labels round-trip", async () => {
        folder.writeFile(".diode/tasks.json", `{\r\n    "version": "2.0.0",\r\n    "tasks": []\r\n}\r\n`);
        const cfg = await load();
        const task = { label: "Сборка 🚀 测试", type: "shell", command: "echo 'é'" };

        await cfg.updateValue("tasks.tasks", [task], "workspace");

        const text = fs.readFileSync(tasksFile, "utf-8");
        expect(text.replace(/\r\n/g, "")).not.toContain("\n");
        expect((JSON.parse(text) as { tasks?: unknown }).tasks).toEqual([task]);
        expect(cfg.get("tasks.tasks")).toEqual([task]);
    });

    it("deleting tasks.json on disk drops the section and fires affectsConfiguration('tasks')", async () => {
        folder.writeFile(".diode/tasks.json", JSON.stringify({ version: "2.0.0", tasks: [BUILD_TASK] }));
        const watcher = new FakeFileWatcher();
        const cfg = await load(watcher);
        const seen: boolean[] = [];
        disposables.add(cfg.onDidChangeConfiguration((e) => seen.push(e.affectsConfiguration("tasks"))));

        fs.rmSync(tasksFile);
        watcher.fire(tasksFile);

        await vi.waitFor(() => {
            expect(cfg.get("tasks")).toBeUndefined();
        });
        expect(seen).toEqual([true]);
    });
});
