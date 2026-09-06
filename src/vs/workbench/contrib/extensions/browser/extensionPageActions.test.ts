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

/** Магазин-фейк: интересны только исходы операций и то, что их звали. */
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

/** Тексты записей статус-бара — сообщение о результате видно именно там. */
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

    it("установка идёт под индикатором прогресса", async () => {
        const service = fakeService();
        const { actions, progress } = createActions(service);

        const running = actions.install("acme.tools");
        // Кнопки гаснут сразу, не дожидаясь появления спиннера: сервис уже занят.
        expect(progress.isBusy()).toBe(true);
        await running;

        expect(service.installed).toEqual(["acme.tools"]);
        expect(progress.isBusy()).toBe(false);
    });

    it("подпись прогресса называет операцию и расширение — иначе спиннер безымянный", async () => {
        // Сервис, который «думает»: прогресс успевает стать видимым.
        let finishInstall = (): void => {};
        let finishUninstall = (): void => {};
        const service: IExtensionsWorkbenchService = {
            ...fakeService(),
            install: () => new Promise((resolve) => (finishInstall = () => resolve({ ok: true, version: "1.2.0" }))),
            uninstall: () => new Promise((resolve) => (finishUninstall = () => resolve({ ok: true }))),
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

    it("после установки сообщение зовёт перезагрузить окно и само уходит", async () => {
        const { actions, statusBar } = createActions(fakeService());

        await actions.install("acme.tools");

        expect(statusTexts(statusBar)).toEqual(["Installed acme.tools@1.2.0 — reload window to activate"]);
        await vi.advanceTimersByTimeAsync(5000);
        expect(statusTexts(statusBar)).toEqual([]);
    });

    it("после удаления сообщение говорит про применение, а не про активацию", async () => {
        const { actions, statusBar } = createActions(fakeService());

        await actions.uninstall("acme.tools");

        expect(statusTexts(statusBar)).toEqual(["Uninstalled acme.tools — reload window to apply"]);
    });

    it("неудача молчит в статус-баре — её место на странице", async () => {
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

    it("удаление идёт под своим прогрессом и доходит до магазина", async () => {
        const service = fakeService();
        const { actions, progress } = createActions(service);

        const running = actions.uninstall("acme.tools");
        expect(progress.isBusy()).toBe(true);
        await running;

        expect(service.uninstalled).toEqual(["acme.tools"]);
    });

    it("перезагрузка идёт командой — тем же путём, что палитра и меню", () => {
        const { actions, commands } = createActions(fakeService());
        const run = vi.fn();
        commands.register("workbench.action.reloadWindow", run);

        actions.reloadWindow();

        expect(run).toHaveBeenCalledOnce();
    });
});
