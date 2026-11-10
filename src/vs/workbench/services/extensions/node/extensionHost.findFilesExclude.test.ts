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

// The layout of upstream's `findFiles - null exclude` (vscode-api-tests testWorkspace).
const SETTINGS = {
    "files.exclude": { "**/files-exclude/**": true },
    "search.exclude": { "**/search-exclude/**": true },
};

describe("ExtensionHost — findFiles and the folder's files.exclude", () => {
    let userData: ITempWorkspace;
    let folder: ITempWorkspace;

    beforeEach(() => {
        userData = createTempWorkspace({ prefix: "diode-ext-find-user-" });
        folder = createTempWorkspace({ prefix: "diode-ext-find-ws-" });
        folder.writeFile("files-exclude/file.txt", "x");
        folder.writeFile("search-exclude/file.txt", "x");
    });

    afterEach(() => {
        userData.dispose();
        folder.dispose();
    });

    async function withHarness(
        run: (harness: IExtensionHarness, watcher: FakeFileWatcher) => Promise<void>,
    ): Promise<void> {
        const watcher = new FakeFileWatcher();
        const paths = resolveUserDataPaths({ homedir: "/never", userDataDir: userData.dir });
        const service = await loadConfiguration(paths, undefined, watcher, new ConfigurationRegistry(), {
            folder: folder.dir,
        });
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.findsFiles", "findsFiles.cjs")],
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

    function findFiles(harness: IExtensionHarness, nullExclude: boolean): Promise<unknown> {
        return harness.commandRegistry.execute("test.findFiles", "**/file.txt", nullExclude) as Promise<unknown>;
    }

    it("[api:workspace.findFiles] .diode/settings.json files.exclude applies from the start, search.exclude does not; null exclude applies nothing", async () => {
        folder.writeFile(".diode/settings.json", JSON.stringify(SETTINGS));
        await withHarness(async (harness) => {
            await expect(findFiles(harness, false)).resolves.toEqual(["search-exclude/file.txt"]);
            await expect(findFiles(harness, true)).resolves.toEqual([
                "files-exclude/file.txt",
                "search-exclude/file.txt",
            ]);
        });
    });

    it("[api:workspace.findFiles] an edit of .diode/settings.json reaches findFiles without a restart", async () => {
        await withHarness(async (harness, watcher) => {
            await expect(findFiles(harness, false)).resolves.toEqual([
                "files-exclude/file.txt",
                "search-exclude/file.txt",
            ]);

            folder.writeFile(".diode/settings.json", JSON.stringify(SETTINGS));
            watcher.fire(folder.path(".diode/settings.json"));

            await vi.waitFor(async () => {
                await expect(findFiles(harness, false)).resolves.toEqual(["search-exclude/file.txt"]);
            });
        });
    });
});
