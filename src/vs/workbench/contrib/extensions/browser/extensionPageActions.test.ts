import { beforeEach, describe, expect, it, vi } from "vitest";

import { Emitter } from "../../../../base/common/event.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IRegistryVersion } from "../../../../platform/extensionManagement/common/registryFormat.ts";
import { ProgressService } from "../../../../platform/progress/common/progressService.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import type { QuickPickOptions } from "../../../browser/parts/quickinput/quickInputService.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";
import type { INotificationMessage } from "../../../services/notification/browser/notificationService.ts";
import { StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";
import type {
    IExtensionInstallResult,
    IExtensionListEntry,
    IExtensionOperationResult,
    IExtensionsWorkbenchService,
} from "../common/extensionsWorkbench.ts";

import { ExtensionPageActions, type IExtensionPageActionsHost } from "./extensionPageActions.ts";

function fakeService(
    results: {
        install?: IExtensionInstallResult;
        uninstall?: IExtensionOperationResult;
        setPinned?: IExtensionOperationResult;
        versions?: readonly IRegistryVersion[] | Error;
        entries?: IExtensionListEntry[];
    } = {},
): IExtensionsWorkbenchService & { installed: string[]; uninstalled: string[]; pins: string[] } {
    const installed: string[] = [];
    const uninstalled: string[] = [];
    const pins: string[] = [];
    return {
        installed,
        uninstalled,
        pins,
        ensureLoaded: () => Promise.resolve(),
        refresh: () => Promise.resolve(),
        getEntries: () => results.entries ?? [],
        getCatalogError: () => null,
        getMeta: () => Promise.resolve(undefined),
        checkForUpdates: () => Promise.resolve(),
        getOutdated: () => [],
        updateAll: () => Promise.resolve({ updated: [], failed: [] }),
        updateExtensions: () => Promise.resolve({ updated: [], failed: [] }),
        setPinned: (id, pinned) => {
            pins.push(`${id}:${String(pinned)}`);
            return Promise.resolve(results.setPinned ?? { ok: true });
        },
        onDidReadCatalog: () => ({ dispose: () => {} }),
        getCompatibleVersions: () =>
            results.versions instanceof Error
                ? Promise.reject(results.versions)
                : Promise.resolve(results.versions ?? []),
        install: (id, options) => {
            installed.push(options?.version === undefined ? id : `${id}@${options.version}`);
            return Promise.resolve(results.install ?? { ok: true, version: options?.version ?? "1.2.0" });
        },
        uninstall: (id) => {
            uninstalled.push(id);
            return Promise.resolve(results.uninstall ?? { ok: true });
        },
        onDidChange: () => ({ dispose: () => {} }),
    };
}

interface IHarness {
    actions: ExtensionPageActions;
    autoUpdate: FakeAutoUpdate;
    statusBar: StatusBarService;
    commands: CommandRegistry;
    progress: ProgressService;
    picks: QuickPickOptions[];
    messages: INotificationMessage[];
}

/** `answer` picks the row with that label; `undefined` is Escape. */
class FakeAutoUpdate {
    public enabled = true;
    public passes = 0;
    public readonly onDidChangeEmitter = new Emitter<void>();
    public readonly onDidChangeAutoUpdate = this.onDidChangeEmitter.event;

    public isAutoUpdateEnabled(): boolean {
        return this.enabled;
    }

    public eventuallyAutoUpdate(): void {
        this.passes++;
    }
}

function createActions(service: IExtensionsWorkbenchService, answer?: string): IHarness {
    const statusBar = new StatusBarService(NULL_STATE_SERVICE);
    const commands = new CommandRegistry();
    const progress = new ProgressService();
    const picks: QuickPickOptions[] = [];
    const messages: INotificationMessage[] = [];
    const host: IExtensionPageActionsHost = {
        quickPick: (options) => {
            picks.push(options);
            return Promise.resolve(options.items.find((item: QuickPickItem) => item.label === answer));
        },
        show: (message) => {
            messages.push(message);
            return { id: messages.length, answered: Promise.resolve(undefined) };
        },
    };
    const autoUpdate = new FakeAutoUpdate();
    const actions = new ExtensionPageActions(service, progress, statusBar, commands, host, host, autoUpdate);
    actions.now = () => Date.parse("2026-10-23T12:00:00Z");
    return { actions, autoUpdate, statusBar, commands, progress, picks, messages };
}

function registryVersion(version: string, publishedAt?: string): IRegistryVersion {
    return {
        version,
        engines: { vscode: "*" },
        artifact: { type: "path", path: `${version}.vsix` },
        sha256: "a".repeat(64),
        publishedAt,
    };
}

function installedEntry(installedVersion: string | null): IExtensionListEntry {
    return {
        id: "acme.demo",
        publisher: "acme",
        name: "demo",
        displayName: "Acme Demo",
        description: "",
        kind: "native",
        support: undefined,
        latestVersion: "1.1.0",
        installedVersion,
        availability: "installed",
        pinned: false,
        needsReload: false,
    };
}

function statusTexts(statusBar: StatusBarService): string[] {
    return statusBar.entries().map((entry) => entry.text);
}

describe("ExtensionPageActions", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        return () => {
            vi.useRealTimers();
        };
    });

    it("install runs under a progress indicator", async () => {
        const service = fakeService();
        const { actions, progress } = createActions(service);

        const running = actions.install("acme.tools");
        // Buttons disable immediately, before the spinner shows: the service is already busy.
        expect(progress.isBusy()).toBe(true);
        await running;

        expect(service.installed).toEqual(["acme.tools"]);
        expect(progress.isBusy()).toBe(false);
    });

    it("the progress title names the operation and the extension — otherwise the spinner is anonymous", async () => {
        // A service that "thinks", so progress has time to become visible.
        let finishInstall = (): void => {};
        let finishUninstall = (): void => {};
        const service: IExtensionsWorkbenchService = {
            ...fakeService(),
            install: () =>
                new Promise(
                    (resolve) =>
                        (finishInstall = () => {
                            resolve({ ok: true, version: "1.2.0" });
                        }),
                ),
            uninstall: () =>
                new Promise(
                    (resolve) =>
                        (finishUninstall = () => {
                            resolve({ ok: true });
                        }),
                ),
        };
        const { actions, progress } = createActions(service);

        const installing = actions.install("acme.tools");
        await vi.advanceTimersByTimeAsync(400);
        expect(progress.windowProgress()?.title).toBe("Installing acme.tools");
        finishInstall();
        await installing;

        const uninstalling = actions.uninstall("acme.tools");
        await vi.advanceTimersByTimeAsync(400);
        expect(progress.windowProgress()?.title).toBe("Uninstalling acme.tools");
        finishUninstall();
        await uninstalling;
    });

    it("after install the message asks to reload the window and goes away by itself", async () => {
        const { actions, statusBar } = createActions(fakeService());

        await actions.install("acme.tools");

        expect(statusTexts(statusBar)).toEqual(["Installed acme.tools@1.2.0 — reload window to activate"]);
        await vi.advanceTimersByTimeAsync(5000);
        expect(statusTexts(statusBar)).toEqual([]);
    });

    it("after uninstall the message talks about applying, not activation", async () => {
        const { actions, statusBar } = createActions(fakeService());

        await actions.uninstall("acme.tools");

        expect(statusTexts(statusBar)).toEqual(["Uninstalled acme.tools — reload window to apply"]);
    });

    it("a failure stays silent in the status bar — it belongs on the page", async () => {
        const service = fakeService({
            install: { ok: false, error: "sha256 mismatch" },
            uninstall: { ok: false, error: "not installed" },
        });
        const { actions, statusBar } = createActions(service);

        const install = await actions.install("acme.tools");
        const uninstall = await actions.uninstall("acme.tools");

        expect(install).toEqual({ ok: false, error: "sha256 mismatch" });
        expect(uninstall).toEqual({ ok: false, error: "not installed" });
        expect(statusTexts(statusBar)).toEqual([]);
    });

    it("uninstall runs under its own progress and reaches the marketplace", async () => {
        const service = fakeService();
        const { actions, progress } = createActions(service);

        const running = actions.uninstall("acme.tools");
        expect(progress.isBusy()).toBe(true);
        await running;

        expect(service.uninstalled).toEqual(["acme.tools"]);
    });

    describe("pickVersion (ExtensionUpdates stage 1)", () => {
        const VERSIONS = [registryVersion("1.1.0", "2026-10-21T12:00:00Z"), registryVersion("1.0.0")];

        it("US-1.1: a quick pick of the compatible versions, the installed one marked current", async () => {
            const service = fakeService({ versions: VERSIONS, entries: [installedEntry("1.1.0")] });
            const { actions, picks } = createActions(service, "1.0.0");

            await expect(actions.pickVersion("acme.demo")).resolves.toBe("1.0.0");

            expect(picks).toHaveLength(1);
            expect(picks[0]?.placeholder).toBe("Select Version to Install");
            expect(picks[0]?.items.map((i) => [i.label, i.description])).toEqual([
                ["1.1.0", "2 days ago (current)"],
                ["1.0.0", undefined],
            ]);
        });

        it("US-1.3: the current version or Escape picks nothing", async () => {
            const service = fakeService({ versions: VERSIONS, entries: [installedEntry("1.1.0")] });

            await expect(createActions(service, "1.1.0").actions.pickVersion("acme.demo")).resolves.toBeUndefined();
            await expect(createActions(service, undefined).actions.pickVersion("acme.demo")).resolves.toBeUndefined();
        });

        it("US-1.5: not installed — every version can be picked, none is current", async () => {
            const service = fakeService({ versions: VERSIONS, entries: [installedEntry(null)] });
            const { actions, picks } = createActions(service, "1.1.0");

            await expect(actions.pickVersion("acme.demo")).resolves.toBe("1.1.0");
            expect(picks[0]?.items.map((i) => i.description)).toEqual(["2 days ago", undefined]);
        });

        it("the installed version is looked up by id: another installed extension is not current, a missing entry is fine", async () => {
            const other = { ...installedEntry("1.1.0"), id: "acme.other" };
            const { actions, picks } = createActions(
                fakeService({ versions: VERSIONS, entries: [other, installedEntry(null)] }),
                "1.1.0",
            );
            await expect(actions.pickVersion("acme.demo")).resolves.toBe("1.1.0");
            expect(picks[0]?.items.map((i) => i.description)).toEqual(["2 days ago", undefined]);

            const missing = createActions(fakeService({ versions: VERSIONS, entries: [] }), "1.1.0");
            await expect(missing.actions.pickVersion("acme.demo")).resolves.toBe("1.1.0");
        });

        it("US-1.4: no compatible versions — a modal info like upstream, and no picker", async () => {
            const { actions, picks, messages } = createActions(fakeService({ versions: [] }), "1.0.0");

            await expect(actions.pickVersion("acme.demo")).resolves.toBeUndefined();

            expect(picks).toEqual([]);
            expect(messages).toEqual([
                { severity: "info", message: "This extension has no other versions.", modal: true, items: [] },
            ]);
        });

        it("a registry failure reaches the caller", async () => {
            const { actions } = createActions(fakeService({ versions: new Error("offline") }));

            await expect(actions.pickVersion("acme.demo")).rejects.toThrow("offline");
        });

        it("US-1.2: install with a version passes it to the service, under the same progress and notice", async () => {
            const service = fakeService();
            const { actions, statusBar } = createActions(service);

            await actions.install("acme.demo", { version: "1.0.0" });

            expect(service.installed).toEqual(["acme.demo@1.0.0"]);
            expect(statusTexts(statusBar)).toEqual(["Installed acme.demo@1.0.0 — reload window to activate"]);
        });
    });

    describe("the Auto Update toggle (US-3.8)", () => {
        it("unchecking pins the entry at its version and starts nothing", async () => {
            const service = fakeService();
            const { actions, autoUpdate } = createActions(service);

            expect(await actions.setAutoUpdate("acme.demo", false)).toEqual({ ok: true });

            expect(service.pins).toEqual(["acme.demo:true"]);
            expect(autoUpdate.passes).toBe(0);
        });

        it("checking unpins it and asks for an auto-update pass right away (upstream updateAutoUpdateEnablementFor)", async () => {
            const service = fakeService();
            const { actions, autoUpdate } = createActions(service);

            await actions.setAutoUpdate("acme.demo", true);

            expect(service.pins).toEqual(["acme.demo:false"]);
            expect(autoUpdate.passes).toBe(1);
        });

        it("a failed unpin asks for nothing and returns the reason", async () => {
            const service = fakeService({ setPinned: { ok: false, error: "disk full" } });
            const { actions, autoUpdate } = createActions(service);

            expect(await actions.setAutoUpdate("acme.demo", true)).toEqual({ ok: false, error: "disk full" });
            expect(autoUpdate.passes).toBe(0);
        });

        it("tells the page whether `extensions.autoUpdate` is on, and when it changes", () => {
            const { actions, autoUpdate } = createActions(fakeService());
            const seen: boolean[] = [];
            actions.onDidChangeAutoUpdate(() => seen.push(actions.isAutoUpdateEnabled()));

            autoUpdate.enabled = false;
            autoUpdate.onDidChangeEmitter.fire();

            expect(seen).toEqual([false]);
        });
    });

    it("reload goes through the command — the same path as the command palette and menus", () => {
        const { actions, commands } = createActions(fakeService());
        const run = vi.fn();
        commands.register("workbench.action.reloadWindow", run);

        actions.reloadWindow();

        expect(run).toHaveBeenCalledOnce();
    });
});
