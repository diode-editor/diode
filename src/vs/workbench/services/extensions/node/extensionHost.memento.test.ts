import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { resolveUserDataPaths } from "../../../../platform/environment/node/userDataPaths.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { StateService } from "../../../../platform/state/node/stateService.ts";
import { loadState } from "../../../../platform/state/node/stateService.ts";

import { createExtensionStateStore } from "./extensionStateStore.ts";
import type { IExtensionStorageHomes } from "./extensionStoragePaths.ts";

const ID = "test.memento";

describe("ExtensionHost — ExtensionContext.globalState / workspaceState", () => {
    let userData: ITempWorkspace;

    let writers: StateService[];

    beforeEach(() => {
        writers = [];
        userData = createTempWorkspace({ prefix: "diode-ext-memento-" });
    });

    afterEach(() => {
        // Silence the writers BEFORE removing the directories: a debounced write
        // that fires after `rmSync` recreates the directory.
        for (const writer of writers) writer.dispose();
        userData.dispose();
    });

    function newState(): StateService {
        const state = loadState(resolveUserDataPaths({ homedir: "/never", userDataDir: userData.dir }));
        writers.push(state);
        return state;
    }

    async function withHarness(
        state: StateService,
        run: (harness: IExtensionHarness) => Promise<void>,
        options: { storageHomes?: () => IExtensionStorageHomes; logger?: ILogger } = {},
    ): Promise<void> {
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture(ID, "usesMemento.cjs")],
            extensionState: createExtensionStateStore(state),
            ...options,
        });
        try {
            await run(harness);
        } finally {
            await harness.dispose();
        }
    }

    it("memento survives a restart, both global and workspace, and is available right in activate()", async () => {
        const first = newState();
        await withHarness(first, async (harness) => {
            expect(await harness.commandRegistry.execute("test.memento.shownAtActivate")).toBe(false);
            await harness.commandRegistry.execute("test.memento.update", true, "shown", true);
            await harness.commandRegistry.execute("test.memento.update", false, "lastFile", "a.ts");
        });
        first.flushSync();

        const second = newState();
        await withHarness(second, async (harness) => {
            // The value from the previous run is available synchronously in activate(), with no round-trip.
            expect(await harness.commandRegistry.execute("test.memento.shownAtActivate")).toBe(true);
            expect(await harness.commandRegistry.execute("test.memento.get", false, "lastFile")).toBe("a.ts");
            expect(await harness.commandRegistry.execute("test.memento.keys", true)).toEqual(["shown"]);
        });
    });

    it("an emptied memento deletes the store entry", async () => {
        const state = newState();
        await withHarness(state, async (harness) => {
            await harness.commandRegistry.execute("test.memento.update", true, "k", 1);
            await harness.commandRegistry.execute("test.memento.update", true, "k", null);
        });

        expect(createExtensionStateStore(state).get(ID, true)).toEqual({});
    });

    it("workspaceState from another workspace is dropped with a warning, globalState is written", async () => {
        const state = newState();
        let workspaceHome: string | null = "/storage/alpha";
        const warn = vi.fn();
        const logger = { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn, error: vi.fn(), isEnabled: () => true };
        await withHarness(
            state,
            async (harness) => {
                // The folder changed after the extension activated.
                workspaceHome = "/storage/beta";
                await harness.commandRegistry.execute("test.memento.update", false, "lastFile", "b.ts");
                await harness.commandRegistry.execute("test.memento.update", true, "shown", true);
            },
            {
                storageHomes: () => ({ globalStorageHome: "/g", workspaceStorageHome: workspaceHome, logsHome: "/l" }),
                logger,
            },
        );

        const store = createExtensionStateStore(state);
        expect(store.get(ID, false)).toEqual({});
        expect(store.get(ID, true)).toEqual({ shown: true });
        expect(warn).toHaveBeenCalledWith(
            `memento.update: "${ID}" activated in another workspace — workspaceState write dropped`,
        );
    });

    it("even without a logger a dropped write does not fail the extension's update", async () => {
        const state = newState();
        let workspaceHome: string | null = "/storage/alpha";
        await withHarness(
            state,
            async (harness) => {
                workspaceHome = "/storage/beta";
                await expect(
                    harness.commandRegistry.execute("test.memento.update", false, "lastFile", "b.ts"),
                ).resolves.toBeNull();
            },
            { storageHomes: () => ({ globalStorageHome: "/g", workspaceStorageHome: workspaceHome, logsHome: "/l" }) },
        );

        expect(createExtensionStateStore(state).get(ID, false)).toEqual({});
    });
});
