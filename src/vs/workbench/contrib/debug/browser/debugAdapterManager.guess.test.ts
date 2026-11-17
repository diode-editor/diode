// Guessing a debugger (upstream `guessDebugger`): the debugger of the active file's language, else the user's pick
// among the debuggers that can make a configuration, and the Marketplace when there is none.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDebugServiceFixture, type IDebugServiceFixture } from "../../../../../TestUtils/debugServiceFixture.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_LAUNCH_CONFIG,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { Uri } from "../../../../base/common/uri.ts";
import {
    DebugConfigurationProviderTriggerKind,
    type IAdapterManager,
    type IDebuggerContribution,
} from "../common/debug.ts";

const FOLDER = { uri: Uri.file("/w"), name: "w", index: 0 };

describe("AdapterManager.guessDebugger", () => {
    let fx: IDebugServiceFixture;
    let adapters: IAdapterManager;

    beforeEach(() => {
        fx = createDebugServiceFixture({ folders: [FOLDER] });
        adapters = fx.service.getAdapterManager();
    });

    afterEach(() => {
        fx.service.dispose();
    });

    function contribute(contribution: IDebuggerContribution): void {
        adapters.registerDebugger(contribution);
    }

    function editing(languageId: string, languageName?: string): void {
        fx.activeEditor = { resource: `file:///w/main.${languageId}`, languageId, languageName };
    }

    it("the only enabled debugger of the active file's language, without asking", async () => {
        contribute({ type: "lldb", label: "LLDB", languages: ["cpp"] });
        contribute({ type: "off", label: "Off", languages: ["cpp"], when: "never" });
        editing("cpp", "C++");

        const guess = await adapters.guessDebugger(false);

        expect(guess?.debugger.type).toBe("lldb");
        expect(guess?.withConfig).toBeUndefined();
        expect(fx.picks).toEqual([]);
        expect(fx.activated).toEqual([]);
    });

    it("several debuggers of the language: the user picks among them, sorted, the hidden ones left out", async () => {
        contribute({ type: "z", label: "Zeta", languages: ["cpp"] });
        contribute({ type: "a", label: "Alpha", languages: ["cpp"] });
        contribute({ type: "h", label: "Hidden", languages: ["cpp"], hiddenWhen: "true" });
        editing("cpp", "C++");
        fx.pickLabel = "Zeta";

        const guess = await adapters.guessDebugger(false);

        expect(guess?.debugger.type).toBe("z");
        expect(fx.picks).toEqual([
            { placeholder: "Select debugger", rows: ["Alpha", "Zeta", "Install an extension for C++..."] },
        ]);
    });

    it("without an active file: the debuggers that can make a configuration, after `onDebugInitialConfigurations`", async () => {
        contribute({ type: "init", label: "With initial", initialConfigurations: [] });
        contribute({ type: "prov", label: "With a provider" });
        contribute({ type: "dyn", label: "With dynamic" });
        contribute({ type: "none", label: "Nothing" });
        const manager = fx.service.getConfigurationManager();
        manager.registerDebugConfigurationProvider({
            type: "prov",
            triggerKind: DebugConfigurationProviderTriggerKind.Initial,
            provideDebugConfigurations: () => Promise.resolve([]),
        });
        manager.registerDebugConfigurationProvider({
            type: "dyn",
            triggerKind: DebugConfigurationProviderTriggerKind.Dynamic,
            provideDebugConfigurations: () => Promise.resolve([]),
        });

        expect(await adapters.guessDebugger(true)).toBeUndefined();

        expect(fx.activated).toContain("onDebugInitialConfigurations");
        expect(fx.picks[0].rows).toEqual([
            "With a provider",
            "With dynamic",
            "With initial",
            "More With dynamic options...",
            "Install extension...",
        ]);
    });

    it("a debugger that ran a session in this window is suggested first", async () => {
        contribute({ type: "a", label: "Alpha", initialConfigurations: [] });
        const factory = registerSyntheticDebugger(adapters, NO_DELAY_TIMING).factory;
        adapters.registerDebugger({ type: "synthetic", initialConfigurations: [] });
        await fx.service.startDebugging(undefined, { ...SYNTHETIC_LAUNCH_CONFIG, name: "Run" });
        await fx.service.stopSession(undefined);
        for (const adapter of factory.adapters) adapter.dispose();

        fx.pickLabel = "Synthetic (C++ under CodeLLDB)";

        const guess = await adapters.guessDebugger(true);

        expect(fx.picks[0].rows.slice(0, 2)).toEqual(["Synthetic (C++ under CodeLLDB) | suggested", "Alpha"]);
        expect(guess?.debugger.type).toBe("synthetic");
    });

    it("a dynamic type's row picks one of its configurations, which comes with the guess", async () => {
        contribute({ type: "dyn", label: "Dyn" });
        fx.service.getConfigurationManager().registerDebugConfigurationProvider({
            type: "dyn",
            triggerKind: DebugConfigurationProviderTriggerKind.Dynamic,
            provideDebugConfigurations: () => Promise.resolve([{ type: "dyn", request: "launch", name: "cargo" }]),
        });
        fx.pickLabel = ["More Dyn options...", "cargo"];

        const guess = await adapters.guessDebugger(true);

        expect(guess?.debugger.type).toBe("dyn");
        expect(guess?.withConfig).toMatchObject({ label: "cargo", config: { name: "cargo" }, launch: { name: "w" } });
    });

    it("a language no debugger names asks to find one in the Marketplace, its name quoted when it has a space", async () => {
        contribute({ type: "init", label: "With initial", initialConfigurations: [] });
        editing("plaintext", "Plain Text");
        fx.confirmAnswer = true;

        expect(await adapters.guessDebugger(false)).toBeUndefined();
        fx.confirmAnswer = false;
        editing("go", "Go");
        expect(await adapters.guessDebugger(false)).toBeUndefined();

        expect(fx.confirms).toEqual([
            "You don't have an extension for debugging 'Plain Text'. Should we find a 'Plain Text' extension in the Marketplace?",
            "You don't have an extension for debugging Go. Should we find a Go extension in the Marketplace?",
        ]);
        expect(fx.installs).toEqual(["'Plain Text'"]);
        expect(fx.picks).toEqual([]);
    });

    it("a language that takes breakpoints is a hint an extension handles it: the user picks a debugger", async () => {
        contribute({ type: "init", label: "With initial", initialConfigurations: [] });
        adapters.registerBreakpoints({ language: "go" });
        editing("go", "Go");
        fx.pickLabel = "With initial";

        const guess = await adapters.guessDebugger(false);

        expect(guess?.debugger.type).toBe("init");
        expect(fx.confirms).toEqual([]);
    });

    it("for a new launch.json a language without a debugger falls back to those that make configurations", async () => {
        contribute({ type: "init", label: "With initial", initialConfigurations: [] });
        editing("go", "Go");
        fx.pickLabel = "Install an extension for Go...";

        expect(await adapters.guessDebugger(true)).toBeUndefined();

        expect(fx.picks[0].rows).toEqual(["With initial", "Install an extension for Go..."]);
        expect(fx.installs).toEqual(["Go"]);
        expect(fx.confirms).toEqual([]);
    });

    it("a language without a display name is not named: its debuggers are looked for as without a file", async () => {
        editing("x");
        fx.pickLabel = "Install extension...";

        await adapters.guessDebugger(false);

        expect(fx.installs).toEqual([undefined]);
        expect(fx.confirms).toEqual([]);
    });

    it("the label of a debug type is its debugger's", () => {
        contribute({ type: "lldb", label: "LLDB" });

        expect(adapters.getDebuggerLabel("lldb")).toBe("LLDB");
        expect(adapters.getDebuggerLabel("nope")).toBeUndefined();
    });
});
