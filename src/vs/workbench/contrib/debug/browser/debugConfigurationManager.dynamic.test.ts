// The dynamic configurations of the configuration manager: which debug types have them (activating nothing), the
// picker of a type's configurations, selecting one, the recent ones and restoring the selection in a new window.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDebugServiceFixture, type IDebugServiceFixture } from "../../../../../TestUtils/debugServiceFixture.ts";
import type { MockStateService } from "../../../../../TestUtils/mockDebug.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { IExtensionManifest } from "../../../../platform/extensions/common/iExtensionManifest.ts";
import {
    DebugConfigurationProviderTriggerKind,
    type IConfig,
    type IConfigurationManager,
    type IDebugConfigurationProvider,
} from "../common/debug.ts";

const FOLDER = { uri: Uri.file("/w"), name: "w", index: 0 };

function extension(manifest: Partial<IExtensionManifest>): IExtension {
    return {
        id: "pub.ext",
        manifest: { name: "ext", version: "1.0.0", publisher: "pub", engines: { vscode: "*" }, ...manifest },
        location: "/ext/",
        isBuiltin: false,
    };
}

function cfg(name: string, type = "dyn"): IConfig {
    return { type, request: "launch", name };
}

describe("ConfigurationManager — dynamic configurations", () => {
    let fx: IDebugServiceFixture;
    let manager: IConfigurationManager;
    let asked: (string | undefined)[];

    function create(state?: MockStateService, launch: unknown = { configurations: [cfg("Run", "synthetic")] }): void {
        fx = createDebugServiceFixture({ workspaceLaunch: launch, folders: [FOLDER], state });
        manager = fx.service.getConfigurationManager();
        asked = [];
    }

    function provideDynamic(configs: IConfig[], type = "dyn"): IDebugConfigurationProvider {
        const provider: IDebugConfigurationProvider = {
            type,
            triggerKind: DebugConfigurationProviderTriggerKind.Dynamic,
            provideDebugConfigurations: (folder) => {
                asked.push(folder?.toString());
                return Promise.resolve(configs);
            },
        };
        manager.registerDebugConfigurationProvider(provider);
        return provider;
    }

    beforeEach(() => {
        create();
    });

    afterEach(() => {
        fx.service.dispose();
    });

    describe("the types with dynamic configurations", () => {
        it("come from activation events and Dynamic providers, labeled by their debugger, activating nothing", async () => {
            fx.extensions = [
                extension({
                    activationEvents: ["onDebugDynamicConfigurations:node", "onDebugDynamicConfigurations:chrome"],
                }),
                extension({
                    activationEvents: ["onDebugDynamicConfigurations", "onDebugDynamicConfigurations:lldb"],
                    contributes: { debuggers: [{ type: "ignored" }] } as never,
                }),
                extension({
                    activationEvents: ["onDebugDynamicConfigurations"],
                    contributes: { debuggers: [{ type: "cppdbg" }, { type: "second" }] } as never,
                }),
                extension({
                    activationEvents: ["onDebugDynamicConfigurations"],
                    contributes: { debuggers: "x" } as never,
                }),
                extension({
                    activationEvents: ["onDebugDynamicConfigurations"],
                    contributes: { debuggers: [{}] } as never,
                }),
                extension({ activationEvents: ["onDebugResolve:other"] }),
                extension({}),
            ];
            fx.service.getAdapterManager().registerDebugger({ type: "node", label: "Node.js" });
            manager.registerDebugConfigurationProvider({
                type: "init",
                triggerKind: DebugConfigurationProviderTriggerKind.Initial,
                provideDebugConfigurations: () => Promise.resolve([]),
            });
            provideDynamic([]);
            fx.activated.length = 0;

            const providers = await manager.getDynamicProviders();

            expect(providers.map((p) => [p.type, p.label])).toEqual([
                ["node", "Node.js"],
                ["chrome", "chrome"],
                ["lldb", "lldb"],
                ["cppdbg", "cppdbg"],
                ["dyn", "dyn"],
            ]);
            expect(fx.activated).toEqual([]);
        });

        it("a type's provider comes after its activation", async () => {
            const provider = provideDynamic([]);
            fx.activated.length = 0;

            const [dynamic] = await manager.getDynamicProviders();

            expect(await dynamic.getProvider()).toBe(provider);
            expect(fx.activated).toEqual([
                "onDebugDynamicConfigurations",
                "onDebug",
                "onDebugDynamicConfigurations:dyn",
            ]);
        });

        it("picking lists the type's configurations of each launch; Escape picks none", async () => {
            provideDynamic([cfg("cargo build"), cfg("cargo test")]);
            const [dynamic] = await manager.getDynamicProviders();
            fx.pickLabel = ["cargo test", undefined as never];

            const picked = await dynamic.pick();
            const cancelled = await dynamic.pick();

            expect(picked).toMatchObject({
                label: "cargo test",
                config: { name: "cargo test" },
                launch: { name: "w" },
            });
            expect(cancelled).toBeUndefined();
            expect(fx.picks[0]).toEqual({
                placeholder: "Select Launch Configuration",
                rows: ["cargo build", "cargo test", "cargo build", "cargo test"],
            });
            // The folder's launch and the user settings' one.
            expect(asked).toEqual(["file:///w", undefined, "file:///w", undefined]);
        });

        it("a type without a Dynamic provider has no configurations", async () => {
            fx.extensions = [extension({ activationEvents: ["onDebugDynamicConfigurations:node"] })];
            manager.registerDebugConfigurationProvider({
                type: "node",
                triggerKind: DebugConfigurationProviderTriggerKind.Dynamic,
            });

            expect(await manager.getDynamicConfigurationsByType("node")).toEqual([]);
            const [node] = await manager.getDynamicProviders();
            expect(await node.getProvider()).toBeUndefined();
        });
    });

    describe("a selected dynamic configuration", () => {
        it("is the selection with its type, asked of its provider by name, and the latest of the recent ones", async () => {
            provideDynamic([cfg("cargo build"), cfg("cargo test")]);
            await manager.selectConfiguration(undefined, "cargo build", undefined, { type: "dyn" });
            await manager.selectConfiguration(undefined, "cargo test", undefined, { type: "dyn" });
            await manager.selectConfiguration(undefined, "cargo build", undefined, { type: "dyn" });

            const selected = manager.selectedConfiguration;
            expect([selected.name, selected.type, selected.launch?.name]).toEqual(["cargo build", "dyn", "w"]);
            expect(await selected.getConfig()).toEqual(cfg("cargo build"));
            expect(manager.getRecentDynamicConfigurations()).toEqual([
                { name: "cargo build", type: "dyn" },
                { name: "cargo test", type: "dyn" },
            ]);
            expect(fx.state.values.get("debug.selectedtype")).toBe("dyn");
        });

        it("a configuration that is gone, or a launch without a folder, gives nothing to start", async () => {
            provideDynamic([cfg("cargo build")]);
            await manager.selectConfiguration(undefined, "gone", undefined, { type: "dyn" });
            expect(await manager.selectedConfiguration.getConfig()).toBeUndefined();

            const user = manager.getLaunches().find((l) => l.workspace === undefined);
            await manager.selectConfiguration(user, "cargo build", undefined, { type: "dyn" });
            expect(await manager.selectedConfiguration.getConfig()).toBeUndefined();

            await manager.selectConfiguration(undefined, "x", undefined, { type: "nobody" });
            expect(await manager.selectedConfiguration.getConfig()).toBeUndefined();
        });

        it("with the configuration given, it is that configuration", async () => {
            const given = cfg("given");

            await manager.selectConfiguration(manager.getLaunches()[0], "given", given, { type: "dyn" });

            expect(await manager.selectedConfiguration.getConfig()).toBe(given);
            expect(manager.getRecentDynamicConfigurations()).toEqual([{ name: "given", type: "dyn" }]);
        });

        it("without a name is not remembered", async () => {
            await manager.selectConfiguration(undefined, undefined, undefined, { type: "dyn" });

            expect(manager.getRecentDynamicConfigurations()).toEqual([]);
            expect(manager.selectedConfiguration.type).toBe("dyn");
        });

        it("a launch configuration selected after it forgets the type", async () => {
            await manager.selectConfiguration(undefined, "cargo", undefined, { type: "dyn" });
            let fired = 0;
            manager.onDidSelectConfiguration(() => fired++);

            await manager.selectConfiguration(manager.getLaunches()[0], "Run");

            expect(manager.selectedConfiguration.type).toBe("synthetic");
            expect(fx.state.values.has("debug.selectedtype")).toBe(false);
            expect(fired).toBe(1);
        });

        it("the same name selected as a dynamic one again still tells the listeners", async () => {
            await manager.selectConfiguration(manager.getLaunches()[0], "Run");
            let fired = 0;
            manager.onDidSelectConfiguration(() => fired++);

            await manager.selectConfiguration(manager.getLaunches()[0], "nope", undefined, { type: "dyn" });
            await manager.selectConfiguration(manager.getLaunches()[0], "nope", undefined, { type: "dyn" });

            expect(fired).toBe(1);
        });

        it("is selected again in a new window of the workspace", async () => {
            create(undefined, {});
            provideDynamic([cfg("cargo build")]);
            await manager.selectConfiguration(undefined, "cargo build", undefined, { type: "dyn" });
            const state = fx.state;
            fx.service.dispose();

            create(state, {});
            // Known from the manifest before the extension is activated.
            fx.extensions = [extension({ activationEvents: ["onDebugDynamicConfigurations:dyn"] })];
            await expect.poll(() => manager.selectedConfiguration.type).toBe("dyn");
            provideDynamic([cfg("cargo build")]);

            expect(manager.selectedConfiguration.name).toBe("cargo build");
            expect(await manager.selectedConfiguration.getConfig()).toEqual(cfg("cargo build"));
        });
    });
});
