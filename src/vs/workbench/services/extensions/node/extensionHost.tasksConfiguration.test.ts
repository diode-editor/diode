import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeFileWatcher } from "../../../../../TestUtils/configurationLayersFixture.ts";
import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { ConfigurationRegistry } from "../../../../platform/configuration/common/configurationRegistry.ts";
import { loadConfiguration } from "../../../../platform/configuration/node/configurationService.ts";
import { resolveUserDataPaths } from "../../../../platform/environment/node/userDataPaths.ts";

const ID = "test.updatesTasksConfiguration";
const WORKSPACE = 2;
const GLOBAL = 1;
const BUILD_TASK = {
    label: "Run this task",
    type: "shell",
    command: "sleep 1",
    problemMatcher: [],
    group: { kind: "build", isDefault: true },
};

interface ITasksResult {
    readonly version?: unknown;
    readonly tasks?: unknown;
    readonly workspaceValue?: unknown;
    readonly globalValue?: unknown;
    readonly changes?: number;
    readonly error?: string;
}

describe("ExtensionHost — the tasks configuration section (subprocess → .diode/tasks.json)", () => {
    let userData: ITempWorkspace;
    let folder: ITempWorkspace;
    let tasksFile: string;

    beforeEach(() => {
        userData = createTempWorkspace({ prefix: "diode-ext-tasks-user-" });
        folder = createTempWorkspace({ prefix: "diode-ext-tasks-ws-" });
        tasksFile = folder.path(".diode/tasks.json");
    });

    afterEach(() => {
        userData.dispose();
        folder.dispose();
    });

    function userPaths() {
        return resolveUserDataPaths({ homedir: "/never", userDataDir: userData.dir });
    }

    async function withHarness(
        run: (harness: IExtensionHarness, watcher: FakeFileWatcher) => Promise<void>,
    ): Promise<void> {
        const watcher = new FakeFileWatcher();
        const service = await loadConfiguration(userPaths(), undefined, watcher, new ConfigurationRegistry(), {
            folder: folder.dir,
        });
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture(ID, "updatesTasksConfiguration.cjs")],
            workspaceFolders: [folder.dir],
            extensionConfigurationService: service,
        });
        try {
            await run(harness, watcher);
        } finally {
            await harness.dispose();
            service.dispose();
        }
    }

    function update(harness: IExtensionHarness, key: string, value: unknown, target: number | null) {
        return harness.commandRegistry.execute("test.tasks.update", key, value, target) as Promise<ITasksResult>;
    }

    function readJson(file: string): unknown {
        return JSON.parse(fs.readFileSync(file, "utf-8"));
    }

    it("[api:workspace.getConfiguration] update('tasks', …, Workspace) writes .diode/tasks.json and get() reads it", async () => {
        await withHarness(async (harness) => {
            // The upstream test `A task can be fetched with default task group information`, step by step.
            expect(await update(harness, "version", "2.0.0", WORKSPACE)).toMatchObject({
                version: "2.0.0",
                changes: 1,
            });
            expect(await update(harness, "tasks", [BUILD_TASK], WORKSPACE)).toEqual({
                version: "2.0.0",
                tasks: [BUILD_TASK],
                workspaceValue: [BUILD_TASK],
                globalValue: null,
                changes: 1,
            });
            expect(readJson(tasksFile)).toEqual({ version: "2.0.0", tasks: [BUILD_TASK] });
            expect(fs.existsSync(folder.path(".diode/settings.json"))).toBe(false);

            // Its reset: no target goes to the workspace too.
            expect(await update(harness, "tasks", [], null)).toMatchObject({ tasks: [], changes: 1 });
            expect(readJson(tasksFile)).toEqual({ version: "2.0.0", tasks: [] });
        });
    });

    it("[api:workspace.getConfiguration] ConfigurationTarget.Global writes the profile's tasks.json", async () => {
        await withHarness(async (harness) => {
            expect(await update(harness, "version", "2.0.0", GLOBAL)).toMatchObject({ version: "2.0.0" });
            const userTasks = path.join(path.dirname(userPaths().settingsFile), "tasks.json");
            expect(readJson(userTasks)).toEqual({ version: "2.0.0", tasks: [] });
            expect(fs.existsSync(userPaths().settingsFile)).toBe(false);
        });
    });

    it("[api:workspace.onDidChangeConfiguration] an edit of tasks.json on disk fires affectsConfiguration('tasks')", async () => {
        await withHarness(async (harness, watcher) => {
            folder.writeFile(".diode/tasks.json", JSON.stringify({ version: "2.0.0", tasks: [BUILD_TASK] }));
            watcher.fire(tasksFile);

            await vi.waitFor(async () => {
                expect(await harness.commandRegistry.execute("test.tasks.read")).toEqual({
                    tasks: [BUILD_TASK],
                    changes: 1,
                });
            });
        });
    });
});
