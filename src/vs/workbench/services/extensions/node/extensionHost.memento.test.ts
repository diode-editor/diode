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

    beforeEach(() => {
        userData = createTempWorkspace({ prefix: "diode-ext-memento-" });
    });

    afterEach(() => {
        userData.dispose();
    });

    function newState(): StateService {
        return loadState(resolveUserDataPaths({ homedir: "/never", userDataDir: userData.dir }));
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

    it("memento переживает перезапуск: глобальный и воркспейсный, и доступен прямо в activate()", async () => {
        const first = newState();
        await withHarness(first, async (harness) => {
            expect(await harness.commandRegistry.execute("test.memento.shownAtActivate")).toBe(false);
            await harness.commandRegistry.execute("test.memento.update", true, "shown", true);
            await harness.commandRegistry.execute("test.memento.update", false, "lastFile", "a.ts");
        });
        first.flushSync();

        const second = newState();
        await withHarness(second, async (harness) => {
            // Значение с прошлого запуска — синхронно в activate(), без round-trip.
            expect(await harness.commandRegistry.execute("test.memento.shownAtActivate")).toBe(true);
            expect(await harness.commandRegistry.execute("test.memento.get", false, "lastFile")).toBe("a.ts");
            expect(await harness.commandRegistry.execute("test.memento.keys", true)).toEqual(["shown"]);
        });
    });

    it("опустевший memento удаляет запись в сторе", async () => {
        const state = newState();
        await withHarness(state, async (harness) => {
            await harness.commandRegistry.execute("test.memento.update", true, "k", 1);
            await harness.commandRegistry.execute("test.memento.update", true, "k", null);
        });

        expect(createExtensionStateStore(state).get(ID, true)).toEqual({});
    });

    it("workspaceState из чужого воркспейса отбрасывается с предупреждением, globalState пишется", async () => {
        const state = newState();
        let workspaceHome: string | null = "/storage/alpha";
        const warn = vi.fn();
        const logger = { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn, error: vi.fn(), isEnabled: () => true };
        await withHarness(
            state,
            async (harness) => {
                // Папку сменили после активации расширения.
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
});
