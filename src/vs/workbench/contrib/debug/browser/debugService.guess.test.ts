// A start without a configuration type: the debugger is guessed, and the choice is remembered for the active file.

import { afterEach, describe, expect, it } from "vitest";

import { createDebugServiceFixture, type IDebugServiceFixture } from "../../../../../TestUtils/debugServiceFixture.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_DEBUG_TYPE,
    SYNTHETIC_LAUNCH_CONFIG,
    type SyntheticDebugAdapterFactory,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IWorkspaceFolder } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import {
    DebugConfigurationProviderTriggerKind,
    type IConfig,
    type IDebugConfigurationProvider,
} from "../common/debug.ts";

const FOLDER: IWorkspaceFolder = { uri: Uri.file("/w"), name: "w", index: 0 };
const MAIN = "file:///w/main.txt";

describe("DebugService — a start without a type", () => {
    let fx: IDebugServiceFixture;
    let factory: SyntheticDebugAdapterFactory;
    let resolved: IConfig[];

    function create(folders: IWorkspaceFolder[] = [FOLDER]): void {
        fx = createDebugServiceFixture({ folders });
        factory = registerSyntheticDebugger(fx.service.getAdapterManager(), NO_DELAY_TIMING).factory;
        fx.service.getAdapterManager().registerDebugger({ type: SYNTHETIC_DEBUG_TYPE, initialConfigurations: [] });
        resolved = [];
        // As extensions do: a configuration without a name is filled in.
        provide({
            resolveDebugConfiguration: (_folder, config) => {
                resolved.push(config);
                return Promise.resolve(Object.assign({}, SYNTHETIC_LAUNCH_CONFIG, { name: "Filled" }, config));
            },
        });
        // A language without a name and without a debugger: the user picks one.
        fx.activeEditor = { resource: MAIN, languageId: "x" };
    }

    function provide(
        provider: Partial<IDebugConfigurationProvider>,
        triggerKind: DebugConfigurationProviderTriggerKind = DebugConfigurationProviderTriggerKind.Initial,
    ): void {
        fx.service.getConfigurationManager().registerDebugConfigurationProvider({
            type: SYNTHETIC_DEBUG_TYPE,
            triggerKind,
            ...provider,
        });
    }

    afterEach(async () => {
        await fx.service.stopSession(undefined);
        for (const adapter of factory.adapters) adapter.dispose();
        fx.service.dispose();
    });

    const sessions = () => fx.service.getModel().getSessions();

    it("asks for the debugger, starts with it and remembers it for the file: the next start does not ask", async () => {
        create();
        fx.pickLabel = "Synthetic (C++ under CodeLLDB)";

        expect(await fx.service.startDebugging(undefined)).toBe(true);
        await fx.service.stopSession(undefined);
        fx.pickLabel = undefined;
        expect(await fx.service.startDebugging(undefined)).toBe(true);

        expect(fx.picks).toHaveLength(1);
        expect(sessions().at(-1)?.configuration.name).toBe("Filled");
        expect(fx.state.values.get("debug.chosenenvironment")).toEqual({ [MAIN]: { type: SYNTHETIC_DEBUG_TYPE } });
    });

    it("a dynamic configuration picked for the debugger starts and is found again by its label", async () => {
        create();
        provide(
            {
                provideDebugConfigurations: (folder) =>
                    Promise.resolve([
                        { type: SYNTHETIC_DEBUG_TYPE, request: "launch", name: `dyn of ${folder?.path}` },
                    ]),
            },
            DebugConfigurationProviderTriggerKind.Dynamic,
        );
        fx.pickLabel = ["More Synthetic (C++ under CodeLLDB) options...", "dyn of /w"];

        expect(await fx.service.startDebugging(undefined)).toBe(true);
        await fx.service.stopSession(undefined);
        expect(await fx.service.startDebugging(undefined)).toBe(true);

        expect(fx.picks).toHaveLength(2);
        expect(resolved.map((c) => c.name)).toEqual(["dyn of /w", "dyn of /w"]);
        expect(sessions()[0].root).toBe(FOLDER);
        expect(fx.state.values.get("debug.chosenenvironment")).toEqual({
            [MAIN]: { type: SYNTHETIC_DEBUG_TYPE, dynamicLabel: "dyn of /w" },
        });
    });

    it("a remembered dynamic configuration that is gone starts with the debugger alone", async () => {
        create();
        fx.state.values.set("debug.chosenenvironment", {
            [MAIN]: { type: SYNTHETIC_DEBUG_TYPE, dynamicLabel: "gone" },
        });
        fx.service.dispose();
        const state = fx.state;
        fx = createDebugServiceFixture({ folders: [FOLDER], state });
        factory = registerSyntheticDebugger(fx.service.getAdapterManager(), NO_DELAY_TIMING).factory;
        fx.activeEditor = { resource: MAIN, languageId: "plaintext" };
        fx.service.getConfigurationManager().registerDebugConfigurationProvider({
            type: SYNTHETIC_DEBUG_TYPE,
            triggerKind: DebugConfigurationProviderTriggerKind.Initial,
            resolveDebugConfiguration: (_folder, config) => Promise.resolve({ ...SYNTHETIC_LAUNCH_CONFIG, ...config }),
        });

        expect(await fx.service.startDebugging(undefined)).toBe(true);

        expect(fx.picks).toEqual([]);
        expect(sessions()[0].configuration.name).toBe(SYNTHETIC_LAUNCH_CONFIG.name);
    });

    it("a start that fails is not remembered; without an active editor nothing is", async () => {
        create();
        fx.pickLabel = "Synthetic (C++ under CodeLLDB)";
        provide({ resolveDebugConfiguration: () => Promise.resolve(undefined) });

        expect(await fx.service.startDebugging(undefined)).toBe(false);
        fx.activeEditor = undefined;
        provide({ resolveDebugConfiguration: (_folder, config) => Promise.resolve(config) });
        expect(await fx.service.startDebugging(undefined)).toBe(false);

        expect(fx.state.values.has("debug.chosenenvironment")).toBe(false);
    });

    it("no debugger picked: nothing starts", async () => {
        create();

        expect(await fx.service.startDebugging(undefined)).toBe(false);

        expect(resolved).toEqual([]);
        expect(sessions()).toEqual([]);
    });

    it("in a window without a folder, a failure without a message says the file can not be debugged", async () => {
        create([]);
        fx.pickLabel = "Synthetic (C++ under CodeLLDB)";
        provide({
            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- an extension may reject with anything
            resolveDebugConfigurationWithSubstitutedVariables: () => Promise.reject(undefined),
        });

        expect(await fx.service.startDebugging(undefined)).toBe(false);

        expect(fx.shown.map((m) => m.message)).toEqual([
            "The active file can not be debugged. Make sure it is saved and that you have a debug extension installed for that file type.",
        ]);
    });
});
