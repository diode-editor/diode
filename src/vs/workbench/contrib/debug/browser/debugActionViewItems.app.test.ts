// The launcher in the Run and Debug title on the whole workbench over a real `.diode/launch.json`: when it shows,
// its dropdown of configurations, recent dynamic ones, the types with dynamic configurations and Add Configuration,
// and ▶ that starts the selected configuration; the welcome's link that creates launch.json.

import * as fs from "node:fs";

import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { mockStateService } from "../../../../../TestUtils/mockDebug.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_DEBUG_TYPE,
    SYNTHETIC_LAUNCH_CONFIG,
    type SyntheticDebugAdapterFactory,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { codicon, iconGlyph } from "../../../../base/common/codicons.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { loadConfiguration } from "../../../../platform/configuration/node/configurationService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { resolveUserDataPaths } from "../../../../platform/environment/node/userDataPaths.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import { LayoutServiceDIToken } from "../../../services/layout/browser/layoutService.ts";
import { DebugConfigurationProviderTriggerKind, VIEWLET_ID } from "../common/debug.ts";

import { NO_CONFIGURATIONS } from "./debugActionViewItems.ts";
import { DebugServiceDIToken } from "./debugService.ts";
import { DebugViewletComponentDIToken } from "./debugViewlet.ts";

/** The harness draws the nerd font glyphs. */
const START = iconGlyph(codicon("debug-start"), true);
const GEAR = iconGlyph(codicon("gear"), true);

function launchJson(...configurations: object[]): string {
    return JSON.stringify({ version: "0.2.0", configurations }, null, 4);
}

describe("the launcher in the Run and Debug title", () => {
    let ws: ITempWorkspace;
    let userData: ITempWorkspace;
    let h: IAppHarness;
    let registration: IDisposable & { factory: SyntheticDebugAdapterFactory };

    async function boot(files: Record<string, string>): Promise<void> {
        ws = createTempWorkspace({ prefix: "diode-launcher-", files });
        userData = createTempWorkspace({ prefix: "diode-launcher-user-" });
        const configurationService = await loadConfiguration(
            resolveUserDataPaths({ homedir: "/never", userDataDir: userData.dir }),
            undefined,
            undefined,
            undefined,
            { folder: ws.dir },
        );
        // The recent dynamic configurations live in the workspace store.
        const state = mockStateService();
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            size: new Size(120, 30),
            configurationService,
            stateService: { ...NULL_STATE_SERVICE, get: state.get, store: state.store, remove: state.remove },
        });
        await h.workbench.activate();
        registration = registerSyntheticDebugger(debugService().getAdapterManager(), NO_DELAY_TIMING);
        await h.commands.execute(VIEWLET_ID);
        // Room for the whole title: the launcher shrinks in a narrow one.
        h.container.get(LayoutServiceDIToken).nudgeSidebarWidth(20);
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

    function lines(): string[] {
        h.testApp.render();
        return h.testApp.backend.screenToString().split("\n");
    }

    function title(): string {
        return lines().find((line) => line.startsWith(" RUN AND")) ?? "";
    }

    function find(text: string): Point {
        const rows = lines();
        const y = rows.findIndex((row) => row.includes(text));
        expect(y, `"${text}" on screen`).toBeGreaterThanOrEqual(0);
        return new Point(rows[y].indexOf(text), y);
    }

    function click(point: Point): void {
        for (const action of ["press", "release"] as const) {
            h.testApp.backend.simulateMouse({
                kind: "mouse",
                button: "left",
                action,
                x: point.x + 1,
                y: point.y + 1,
                shiftKey: false,
                altKey: false,
                ctrlKey: false,
                raw: "",
            });
        }
    }

    function dropdownRows(): unknown {
        return h.container.get(DebugViewletComponentDIToken).launcher.dropdown.inspectState().options;
    }

    function provideDynamic(): void {
        debugService()
            .getConfigurationManager()
            .registerDebugConfigurationProvider({
                type: SYNTHETIC_DEBUG_TYPE,
                triggerKind: DebugConfigurationProviderTriggerKind.Dynamic,
                provideDebugConfigurations: () => Promise.resolve([{ ...SYNTHETIC_LAUNCH_CONFIG, name: "Dyn" }]),
            });
    }

    const twoConfigs = {
        ".diode/launch.json": launchJson(
            { ...SYNTHETIC_LAUNCH_CONFIG, name: "First" },
            { ...SYNTHETIC_LAUNCH_CONFIG, name: "Second" },
        ),
    };

    it("shows the start button, the selected configuration and the gear; the dropdown selects another, the button starts it", async () => {
        await boot(twoConfigs);

        expect(title()).toMatch(new RegExp(`RUN AND.* ${START} First ⌄ ${GEAR} │ ⋯`));
        click(find("First ⌄"));
        expect(lines().join("\n")).toContain("Add Configuration...");
        // The separator before the actions is the menu's line, not a row to pick.
        expect(lines()[find("Add Configuration...").y - 1]).toMatch(/├─+┤/u);
        h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(title()).toContain(`${START} Second ⌄`);
        });
        expect(debugService().getConfigurationManager().selectedConfiguration.name).toBe("Second");

        click(find(`${START} Second`));

        await vi.waitFor(() => {
            expect(debugService().getModel().getSessions()[0]?.configuration.name).toBe("Second");
        });
    });

    it("lists the dynamic types after the configurations; picking one selects its configuration", async () => {
        await boot(twoConfigs);
        provideDynamic();
        await vi.waitFor(() => {
            expect(dropdownRows()).toEqual([
                "First",
                "Second",
                "─",
                "Synthetic (C++ under CodeLLDB)...",
                "Add Configuration...",
            ]);
        });

        const launcher = h.container.get(DebugViewletComponentDIToken).launcher;
        launcher.dropdown.onDidSelect?.({ selected: "", index: 3 });
        await vi.waitFor(() => {
            expect(lines().join("\n")).toContain("Select Launch Configuration");
            expect(lines().join("\n")).toContain("Dyn");
        });
        h.testApp.sendKey("Enter");

        await vi.waitFor(() => {
            expect(title()).toContain(`${START} Dyn ⌄`);
        });
        expect(dropdownRows()).toEqual([
            "First",
            "Second",
            "─",
            "Dyn",
            "─",
            "Synthetic (C++ under CodeLLDB)...",
            "Add Configuration...",
        ]);
        // ▶ starts the dynamic configuration its provider gives again.
        launcher.start.focus();
        h.testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(debugService().getModel().getSessions()[0]?.configuration.name).toBe("Dyn");
        });
    });

    it("a row that selects nothing leaves the selection; Add Configuration... edits launch.json", async () => {
        await boot(twoConfigs);
        provideDynamic();
        const launcher = h.container.get(DebugViewletComponentDIToken).launcher;
        await vi.waitFor(() => {
            expect(dropdownRows()).toHaveLength(5);
        });

        launcher.dropdown.onDidSelect?.({ selected: "", index: 3 });
        await vi.waitFor(() => {
            expect(lines().join("\n")).toContain("Select Launch Configuration");
        });
        h.testApp.sendKey("Escape");
        await vi.waitFor(() => {
            expect(launcher.dropdown.inspectState().selectedText).toBe("First");
        });
        launcher.dropdown.onDidSelect?.({ selected: "", index: 4 });

        await vi.waitFor(() => {
            expect(h.activeEditor().uri.fsPath).toBe(ws.path(".diode/launch.json"));
        });
        expect(launcher.dropdown.inspectState().selectedText).toBe("First");
        expect(debugService().getConfigurationManager().selectedConfiguration.name).toBe("First");
    });

    it("hidden without launch.json, where the welcome's link creates it for the picked debugger", async () => {
        await boot({});
        debugService()
            .getAdapterManager()
            .registerDebugger({
                type: SYNTHETIC_DEBUG_TYPE,
                initialConfigurations: [{ ...SYNTHETIC_LAUNCH_CONFIG, name: "Initial" }],
            });
        expect(title()).not.toContain(START);
        expect(title()).not.toContain(GEAR);

        click(find("create a launch.json"));
        await flushMicrotasks();
        await vi.waitFor(() => {
            expect(lines().join("\n")).toContain("Select debugger");
        });
        h.testApp.sendKey("Enter");

        await vi.waitFor(() => {
            expect(h.activeEditor().uri.fsPath).toBe(ws.path(".diode/launch.json"));
        });
        expect(fs.readFileSync(ws.path(".diode/launch.json"), "utf-8")).toContain('"name": "Initial"');
        // A fresh launch.json gets no empty line of a new configuration.
        expect(h.activeEditor().isModified).toBe(false);
        // The launcher comes with the configuration once the settings read the new file.
        await h.container.get(IConfigurationServiceDIToken).reloadConfiguration?.();
        await vi.waitFor(() => {
            expect(title()).toContain(`${START} Initial ⌄`);
        });
    });

    it("the welcome's link on an existing launch.json opens it on a new line of configurations", async () => {
        await boot({ ".diode/launch.json": '{\n    "configurations": [\n    ]\n}' });
        // Only a session or a configuration leaves the welcome: here neither.
        expect(title()).not.toContain(START);

        click(find("create a launch.json"));

        await vi.waitFor(() => {
            expect(h.activeEditor().getLinesContent()).toEqual([
                "{",
                '    "configurations": [',
                "        ",
                "    ]",
                "}",
            ]);
        });
    });

    it("while debugging: shown, unless docked or debug.hideLauncherWhileDebugging; then the ⋯ starts another session", async () => {
        await boot(twoConfigs);
        await h.commands.execute("debug.startFromConfig", { ...SYNTHETIC_LAUNCH_CONFIG });
        await vi.waitFor(() => {
            expect(h.container.get(ContextKeyServiceDIToken).getRaw("debugState")).toBe("stopped");
        });
        expect(title()).toContain(`${START} First ⌄`);

        const configuration = h.container.get(IConfigurationServiceDIToken);
        await configuration.updateValue("debug.hideLauncherWhileDebugging", true);
        expect(title()).not.toContain("First ⌄");
        await configuration.updateValue("debug.hideLauncherWhileDebugging", false);
        expect(title()).toContain(`${START} First ⌄`);
        await configuration.updateValue("debug.toolBarLocation", "docked");
        expect(title()).not.toContain("First ⌄");
        expect(title()).not.toContain(GEAR);

        click(find("⋯"));
        expect(lines().join("\n")).toContain("Start Additional Session");
        expect(lines().join("\n")).toContain("Open 'launch.json'");
        h.testApp.sendKey("Escape");

        await debugService().stopSession(undefined);
        await vi.waitFor(() => {
            expect(title()).toContain(`${START} First ⌄`);
        });
        expect(title()).toContain(GEAR);
    });

    it(`without configurations while debugging says "${NO_CONFIGURATIONS}"`, async () => {
        await boot({});
        await h.commands.execute("debug.startFromConfig", { ...SYNTHETIC_LAUNCH_CONFIG });
        await vi.waitFor(() => {
            expect(title()).toContain(`${START} ${NO_CONFIGURATIONS} ⌄`);
        });
        await flushMicrotasks();
    });
});
