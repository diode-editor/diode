// The whole workbench over a real `.diode/launch.json`: F5 starts its selected configuration (an unsaved edit of the
// file included), Select and Start Debugging lists it, Open 'launch.json' creates the file, Add Configuration edits
// it in the editor.

import * as fs from "node:fs";
import * as path from "node:path";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_DEBUG_TYPE,
    SYNTHETIC_LAUNCH_CONFIG,
    type SyntheticDebugAdapterFactory,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { loadConfiguration } from "../../../../platform/configuration/node/configurationService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { resolveUserDataPaths } from "../../../../platform/environment/node/userDataPaths.ts";
import { DebugConfigurationProviderTriggerKind } from "../common/debug.ts";

import { DebugQuickAccessProviderDIToken } from "./debugQuickAccess.ts";
import { DebugServiceDIToken } from "./debugService.ts";

function launchJson(...configurations: object[]): string {
    return JSON.stringify({ version: "0.2.0", configurations }, null, 4);
}

describe("launch.json in the workbench", () => {
    let ws: ITempWorkspace;
    let userData: ITempWorkspace;
    let h: IAppHarness;
    let registration: IDisposable & { factory: SyntheticDebugAdapterFactory };

    async function boot(files: Record<string, string>): Promise<void> {
        ws = createTempWorkspace({ prefix: "diode-launch-", files });
        userData = createTempWorkspace({ prefix: "diode-launch-user-" });
        const configurationService = await loadConfiguration(
            resolveUserDataPaths({ homedir: "/never", userDataDir: userData.dir }),
            undefined,
            undefined,
            undefined,
            { folder: ws.dir },
        );
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

    function screen(): string {
        h.testApp.render();
        return h.testApp.backend.screenToString();
    }

    async function f5(): Promise<void> {
        h.testApp.sendKey("F5");
        await flushMicrotasks();
    }

    it("F5 starts the selected configuration of launch.json", async () => {
        await boot({ ".diode/launch.json": launchJson({ ...SYNTHETIC_LAUNCH_CONFIG, name: "Run hello" }) });

        await f5();

        await vi.waitFor(() => {
            expect(h.container.get(ContextKeyServiceDIToken).getRaw("debugState")).toBe("stopped");
        });
        expect(debugService().getModel().getSessions()[0].configuration.name).toBe("Run hello");
    });

    it("F5 saves an edit of launch.json in the editor and starts what it says", async () => {
        await boot({ ".diode/launch.json": launchJson({ ...SYNTHETIC_LAUNCH_CONFIG, name: "Old" }) });
        h.commands.execute("workbench.openFile", ws.path(".diode/launch.json"));
        await vi.waitFor(() => {
            expect(h.activeEditor().uri.fsPath).toBe(ws.path(".diode/launch.json"));
        });
        const editor = h.activeEditor();
        const text = editor.getText();
        const start = text.indexOf('"Old"');
        const line = text.slice(0, start).split("\n").length - 1;
        const column = start - text.lastIndexOf("\n", start - 1) - 1;
        editor.applyExternalEdits(
            [{ range: { start: { line, character: column }, end: { line, character: column + 5 } }, text: '"New"' }],
            "rename",
        );

        await f5();

        await vi.waitFor(() => {
            expect(debugService().getModel().getSessions()[0]?.configuration.name).toBe("New");
        });
        expect(fs.readFileSync(ws.path(".diode/launch.json"), "utf-8")).toContain('"New"');
    });

    /** What an extension contributes besides the synthetic debugger: initial configurations and a provider. */
    function contributeInitialConfigurations(): void {
        const adapters = debugService().getAdapterManager();
        adapters.registerDebugger({
            type: SYNTHETIC_DEBUG_TYPE,
            initialConfigurations: [{ ...SYNTHETIC_LAUNCH_CONFIG, name: "Initial" }],
        });
        debugService()
            .getConfigurationManager()
            .registerDebugConfigurationProvider({
                type: SYNTHETIC_DEBUG_TYPE,
                triggerKind: DebugConfigurationProviderTriggerKind.Initial,
                provideDebugConfigurations: () => Promise.resolve([{ ...SYNTHETIC_LAUNCH_CONFIG, name: "Provided" }]),
                // As extensions do: a configuration without a type is filled in.
                resolveDebugConfiguration: (_folder, config) =>
                    Promise.resolve(config.type ? config : { ...SYNTHETIC_LAUNCH_CONFIG, name: "Guessed" }),
            });
    }

    it("without launch.json F5 asks for a debugger and starts what it resolves for no configuration", async () => {
        await boot({});
        contributeInitialConfigurations();

        await f5();

        await vi.waitFor(() => {
            expect(screen()).toContain("Synthetic (C++ under CodeLLDB)");
        });
        expect(screen()).toContain("Install extension...");
        h.testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(debugService().getModel().getSessions()[0]?.configuration.name).toBe("Guessed");
        });
        expect(fs.existsSync(ws.path(".diode/launch.json"))).toBe(false);
    });

    it("Select and Start Debugging lists the configurations, the selected one first, and starts the picked one", async () => {
        await boot({
            ".diode/launch.json": launchJson(
                { ...SYNTHETIC_LAUNCH_CONFIG, name: "First" },
                { ...SYNTHETIC_LAUNCH_CONFIG, name: "Second" },
            ),
        });
        const provider = h.container.get(DebugQuickAccessProviderDIToken);
        expect(provider.getItems("debug ").map((i) => [i.label, i.hint])).toEqual([
            ["First", "most recent"],
            ["Second", undefined],
            ["Add Configuration...", "configure"],
        ]);

        await h.commands.execute("workbench.action.debug.selectandstart");
        await flushMicrotasks();
        h.testApp.sendKey("s");
        h.testApp.sendKey("e");
        h.testApp.sendKey("c");
        expect(screen()).toContain("Second");
        h.testApp.sendKey("Enter");

        await vi.waitFor(() => {
            expect(debugService().getModel().getSessions()[0]?.configuration.name).toBe("Second");
        });
        expect(debugService().getConfigurationManager().selectedConfiguration.name).toBe("Second");
    });

    it("without launch.json Select and Start Debugging on a type with dynamic configurations lists them and starts the picked one", async () => {
        await boot({});
        contributeInitialConfigurations();
        debugService()
            .getConfigurationManager()
            .registerDebugConfigurationProvider({
                type: SYNTHETIC_DEBUG_TYPE,
                triggerKind: DebugConfigurationProviderTriggerKind.Dynamic,
                provideDebugConfigurations: () => Promise.resolve([{ ...SYNTHETIC_LAUNCH_CONFIG, name: "Dyn" }]),
            });

        await h.commands.execute("workbench.action.debug.selectandstart");
        await vi.waitFor(() => {
            expect(screen()).toContain("Synthetic (C++ under CodeLLDB)...");
        });
        h.testApp.sendKey("Enter");

        // As upstream: the type's dynamic configurations, not the "Select debugger" guess of F5.
        await vi.waitFor(() => {
            expect(screen()).toContain("Dyn");
        });
        expect(screen()).not.toContain("Install extension...");
        h.testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(debugService().getModel().getSessions()[0]?.configuration.name).toBe("Dyn");
        });
        expect(fs.existsSync(ws.path(".diode/launch.json"))).toBe(false);
    });

    it("Open 'launch.json' with no file asks for a debugger and creates the file with its initial configurations", async () => {
        await boot({});
        contributeInitialConfigurations();

        // Not awaited: the command waits for the picker below.
        void h.commands.execute("workbench.action.debug.configure");
        await vi.waitFor(() => {
            expect(screen()).toContain("Synthetic (C++ under CodeLLDB)");
        });
        h.testApp.sendKey("Enter");

        await vi.waitFor(() => {
            expect(h.activeEditor().uri.fsPath).toBe(ws.path(".diode/launch.json"));
        });
        expect(fs.readFileSync(ws.path(".diode/launch.json"), "utf-8")).toBe(h.activeEditor().getText());
        const text = h.activeEditor().getText();
        expect(text).toContain('"version": "0.2.0"');
        expect(text.indexOf('"name": "Initial"')).toBeGreaterThan(0);
        expect(text.indexOf('"name": "Provided"')).toBeGreaterThan(text.indexOf('"name": "Initial"'));
    });

    it("Open 'launch.json' with no file and no debugger to pick creates nothing", async () => {
        await boot({});

        void h.commands.execute("workbench.action.debug.configure");
        await vi.waitFor(() => {
            expect(screen()).toContain("Install extension...");
        });
        h.testApp.sendKey("Escape");
        await flushMicrotasks();

        expect(fs.existsSync(ws.path(".diode/launch.json"))).toBe(false);
    });

    it("Add Configuration puts the caret on a new line at the start of configurations", async () => {
        await boot({ ".diode/launch.json": '{\n    "version": "0.2.0",\n    "configurations": [{ "name": "a" }]\n}' });

        await h.commands.execute("debug.addConfiguration");

        await vi.waitFor(() => {
            expect(h.activeEditor().getLinesContent()).toEqual([
                "{",
                '    "version": "0.2.0",',
                '    "configurations": [',
                "        ",
                '        { "name": "a" }]',
                "}",
            ]);
        });
        expect(h.activeEditor().viewState.selections[0].active.line).toBe(3);
    });

    it("Add Configuration adds a missing configurations array first", async () => {
        await boot({ ".diode/launch.json": '{\n    "version": "0.2.0"\n}' });

        await h.commands.execute("debug.addConfiguration");

        await vi.waitFor(() => {
            expect(h.activeEditor().getLinesContent()).toEqual([
                "{",
                '    "version": "0.2.0",',
                '    "configurations": [',
                "        ",
                "        ",
                "    ]",
                "}",
            ]);
        });
        expect(h.activeEditor().viewState.selections[0].active.line).toBe(3);
    });

    it("Add Configuration on an empty launch.json writes the array; a [ ending its line (spaces aside) needs no line break", async () => {
        await boot({ ".diode/launch.json": "" });

        await h.commands.execute("debug.addConfiguration");

        await vi.waitFor(() => {
            expect(h.activeEditor().getText()).toContain('"configurations": [');
        });
        h.dispose();
        ws.dispose();
        userData.dispose();
        await boot({ ".diode/launch.json": '{\n    "configurations": [  \n        { "name": "a" }\n    ]\n}' });

        await h.commands.execute("debug.addConfiguration");

        await vi.waitFor(() => {
            expect(h.activeEditor().getLinesContent()).toEqual([
                "{",
                '    "configurations": [  ',
                "        ",
                '        { "name": "a" }',
                "    ]",
                "}",
            ]);
        });
    });

    it("Add Configuration on the user settings adds the launch block", async () => {
        await boot({});
        const user = debugService()
            .getConfigurationManager()
            .getLaunches()
            .find((l) => l.workspace === undefined && l.uri.path.endsWith("/settings.json"))!;
        fs.mkdirSync(path.dirname(user.uri.fsPath), { recursive: true });
        fs.writeFileSync(user.uri.fsPath, '{\n    "editor.tabSize": 4\n}');

        await h.commands.execute("debug.addConfiguration", user.uri.toString());

        await vi.waitFor(() => {
            expect(h.activeEditor().getLinesContent()).toEqual([
                "{",
                '    "editor.tabSize": 4,',
                '    "launch": {',
                '        "configurations": [',
                "            ",
                "            ",
                "        ]",
                "    }",
                "}",
            ]);
        });
        expect(h.activeEditor().viewState.selections[0].active.line).toBe(4);
    });

    it("Add Configuration on the user settings goes into their existing launch.configurations", async () => {
        await boot({});
        const user = debugService()
            .getConfigurationManager()
            .getLaunches()
            .find((l) => l.workspace === undefined && l.uri.path.endsWith("/settings.json"))!;
        fs.mkdirSync(path.dirname(user.uri.fsPath), { recursive: true });
        fs.writeFileSync(user.uri.fsPath, '{\n    "launch": {\n        "configurations": [{ "name": "a" }]\n    }\n}');

        await h.commands.execute("debug.addConfiguration", user.uri.toString());

        await vi.waitFor(() => {
            expect(h.activeEditor().getLinesContent()).toEqual([
                "{",
                '    "launch": {',
                '        "configurations": [',
                "            ",
                '            { "name": "a" }]',
                "    }",
                "}",
            ]);
        });
    });
});
