// Edges of launch.json in the whole workbench, seen as the user sees them: the configurations offered by Select and
// Start Debugging and the session F5 starts.

import * as fs from "node:fs";
import * as path from "node:path";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_LAUNCH_CONFIG,
    type SyntheticDebugAdapterFactory,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { loadConfiguration } from "../../../../platform/configuration/node/configurationService.ts";
import { resolveUserDataPaths } from "../../../../platform/environment/node/userDataPaths.ts";

import { DebugQuickAccessProviderDIToken } from "./debugQuickAccess.ts";
import { DebugServiceDIToken } from "./debugService.ts";

function launchJson(...configurations: object[]): string {
    return JSON.stringify({ version: "0.2.0", configurations }, null, 4);
}

describe("launch.json edges in the workbench", () => {
    let ws: ITempWorkspace;
    let userData: ITempWorkspace;
    let h: IAppHarness;
    let registration: IDisposable & { factory: SyntheticDebugAdapterFactory };

    async function boot(files: Record<string, string>, userSettings?: object): Promise<void> {
        ws = createTempWorkspace({ prefix: "diode-launch-", files });
        userData = createTempWorkspace({ prefix: "diode-launch-user-" });
        const paths = resolveUserDataPaths({ homedir: "/never", userDataDir: userData.dir });
        if (userSettings) {
            fs.mkdirSync(path.dirname(paths.settingsFile), { recursive: true });
            fs.writeFileSync(paths.settingsFile, JSON.stringify(userSettings));
        }
        const configurationService = await loadConfiguration(paths, undefined, undefined, undefined, {
            folder: ws.dir,
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(120, 30), configurationService });
        await h.workbench.activate();
        registration = registerSyntheticDebugger(debugService().getAdapterManager(), NO_DELAY_TIMING);
    }

    afterEach(async () => {
        await debugService().stopSession(undefined);
        registration.factory.adapters.forEach((a) => {
            a.dispose();
        });
        registration.dispose();
        h.dispose();
        ws.dispose();
        userData.dispose();
    });

    function debugService() {
        return h.container.get(DebugServiceDIToken);
    }

    function picks(): (string | undefined)[] {
        return h.container
            .get(DebugQuickAccessProviderDIToken)
            .getItems("debug ")
            .map((i) => i.label);
    }

    async function f5(): Promise<void> {
        h.testApp.sendKey("F5");
        await flushMicrotasks();
    }

    function sessionNames(): string[] {
        return debugService()
            .getModel()
            .getSessions()
            .map((s) => s.configuration.name);
    }

    it("the launch of the user settings is offered and started by F5 without launch.json", async () => {
        await boot(
            { "main.c": "" },
            { launch: { configurations: [{ ...SYNTHETIC_LAUNCH_CONFIG, name: "From user settings" }] } },
        );

        expect(picks()).toContain("From user settings");
        await f5();

        await vi.waitFor(() => {
            expect(sessionNames()).toEqual(["From user settings"]);
        });
    });

    it("hidden configurations are not offered; presentation.order sorts the rest", async () => {
        await boot({
            ".diode/launch.json": launchJson(
                { ...SYNTHETIC_LAUNCH_CONFIG, name: "Zed", presentation: { order: 2 } },
                { ...SYNTHETIC_LAUNCH_CONFIG, name: "Hidden one", presentation: { hidden: true } },
                { ...SYNTHETIC_LAUNCH_CONFIG, name: "Alpha", presentation: { order: 1 } },
            ),
        });

        const labels = picks();
        expect(labels).not.toContain("Hidden one");
        expect(labels.indexOf("Alpha")).toBeLessThan(labels.indexOf("Zed"));
    });

    it("a unicode name is offered and started", async () => {
        await boot({ ".diode/launch.json": launchJson({ ...SYNTHETIC_LAUNCH_CONFIG, name: "Запуск 日本 🚀" }) });

        expect(picks()).toContain("Запуск 日本 🚀");
        await f5();

        await vi.waitFor(() => {
            expect(sessionNames()).toEqual(["Запуск 日本 🚀"]);
        });
    });

    it("a broken launch.json does not break F5: the picker opens", async () => {
        await boot({ ".diode/launch.json": '{ "version": "0.2.0", "configurations": [ { "name": ' });

        await f5();

        await vi.waitFor(() => {
            h.testApp.render();
            expect(h.testApp.backend.screenToString()).toContain("Add Configuration...");
        });
        expect(sessionNames()).toEqual([]);
    });

    it("duplicate names are both offered", async () => {
        await boot({
            ".diode/launch.json": launchJson(
                { ...SYNTHETIC_LAUNCH_CONFIG, name: "Same" },
                { ...SYNTHETIC_LAUNCH_CONFIG, name: "Same" },
            ),
        });

        expect(picks().filter((l) => l?.startsWith("Same"))).toHaveLength(2);
    });

    it("the platform block of the configuration applies on this platform", async () => {
        await boot({
            ".diode/launch.json": launchJson({
                ...SYNTHETIC_LAUNCH_CONFIG,
                name: "Plat",
                program: "generic",
                linux: { program: "linux" },
                osx: { program: "osx" },
                windows: { program: "windows" },
            }),
        });

        await f5();

        const expected = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "osx" : "linux";
        await vi.waitFor(() => {
            expect(debugService().getModel().getSessions()[0]?.configuration.program).toBe(expected);
        });
    });
});
