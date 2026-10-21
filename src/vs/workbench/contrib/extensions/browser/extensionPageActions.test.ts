import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ProgressService } from "../../../../platform/progress/common/progressService.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import { StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";
import type {
    IExtensionInstallResult,
    IExtensionOperationResult,
    IExtensionsWorkbenchService,
} from "../common/extensionsWorkbench.ts";

import { ExtensionPageActions } from "./extensionPageActions.ts";

function fakeService(
    results: {
        install?: IExtensionInstallResult;
        uninstall?: IExtensionOperationResult;
    } = {},
): IExtensionsWorkbenchService & { installed: string[]; uninstalled: string[] } {
    const installed: string[] = [];
    const uninstalled: string[] = [];
    return {
        installed,
        uninstalled,
        ensureLoaded: () => Promise.resolve(),
        refresh: () => Promise.resolve(),
        getEntries: () => [],
        getCatalogError: () => null,
        getMeta: () => Promise.resolve(undefined),
        install: (id) => {
            installed.push(id);
            return Promise.resolve(results.install ?? { ok: true, version: "1.2.0" });
        },
        uninstall: (id) => {
            uninstalled.push(id);
            return Promise.resolve(results.uninstall ?? { ok: true });
        },
        onDidChange: () => ({ dispose: () => {} }),
    };
}

function createActions(service: IExtensionsWorkbenchService): {
    actions: ExtensionPageActions;
    statusBar: StatusBarService;
    commands: CommandRegistry;
    progress: ProgressService;
} {
    const statusBar = new StatusBarService(NULL_STATE_SERVICE);
    const commands = new CommandRegistry();
    const progress = new ProgressService();
    return { actions: new ExtensionPageActions(service, progress, statusBar, commands), statusBar, commands, progress };
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

    it("reload goes through the command — the same path as the command palette and menus", () => {
        const { actions, commands } = createActions(fakeService());
        const run = vi.fn();
        commands.register("workbench.action.reloadWindow", run);

        actions.reloadWindow();

        expect(run).toHaveBeenCalledOnce();
    });
});
