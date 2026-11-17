// The configuration providers of extensions in the configuration manager: the order upstream asks them in, what
// their answers do, and the configurations they give a new launch.json.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockStateService } from "../../../../../TestUtils/mockDebug.ts";
import { CancellationTokenNone, CancellationTokenSource } from "../../../../base/common/cancellation.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IConfigurationInspectResult } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { IWorkspaceFolder } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import {
    DebugConfigurationProviderTriggerKind,
    type IAdapterManager,
    type IConfig,
    type IDebugConfigurationProvider,
} from "../common/debug.ts";
import { Debugger, initialConfigurationContent } from "../common/debugger.ts";

import { ConfigurationManager, type IConfigurationManagerPorts } from "./debugConfigurationManager.ts";
import { NO_DEBUG_EXTENSIONS } from "./debugService.ts";

const FOLDER: IWorkspaceFolder = { uri: Uri.file("/w"), name: "w", index: 0 };
const { Initial, Dynamic } = DebugConfigurationProviderTriggerKind;

function cfg(type: string, extra: Record<string, unknown> = {}): IConfig {
    return { type, request: "launch", name: "n", ...extra };
}

/** Where the providers of a test leave their tags. */
type Tagged = IConfig & { readonly trail?: string; readonly trail2?: string };

function trail(config: IConfig | null | undefined): string | undefined {
    return (config as Tagged | null | undefined)?.trail;
}

/** A provider that appends its tag to `trail` and passes the configuration on, unless `answer` says otherwise. */
function tagging(
    type: string,
    tag: string,
    answer: (config: IConfig) => IConfig | null | undefined = (config) => config,
): IDebugConfigurationProvider {
    return {
        type,
        triggerKind: Initial,
        resolveDebugConfiguration: (_folder, config) =>
            Promise.resolve(answer({ ...config, trail: `${trail(config) ?? ""}${tag}` } as Tagged)),
        resolveDebugConfigurationWithSubstitutedVariables: (_folder, config) =>
            Promise.resolve(answer({ ...config, trail2: `${(config as Tagged).trail2 ?? ""}${tag}` } as Tagged)),
    };
}

describe("ConfigurationManager — configuration providers", () => {
    let manager: ConfigurationManager;
    let activated: string[];
    let files: Map<string, string>;
    let getDebugger: IAdapterManager["getDebugger"];

    beforeEach(() => {
        activated = [];
        files = new Map();
        getDebugger = () => undefined;
        const adapterManager = {
            getDebugger: (type: string) => getDebugger(type),
            activateDebuggers: (event: string, type?: string) => {
                activated.push(type === undefined ? event : `${event}:${type}`);
                return Promise.resolve();
            },
        } as IAdapterManager;
        const ports: IConfigurationManagerPorts = {
            configuration: {
                inspect: <T>() => ({}) as IConfigurationInspectResult<T>,
                get: (() => undefined) as never,
                onDidChangeConfiguration: () => ({ dispose: () => undefined }),
            },
            workspace: {
                getWorkspace: () => ({ id: "w" as never, folders: [FOLDER] }),
                getWorkbenchState: () => "folder",
                onDidChangeWorkspaceFolders: (listener) => new Emitter<void>().event(listener),
            },
            state: mockStateService(),
            contextKeys: new ContextKeyService(),
            files: {
                readFile: () => Promise.reject(new Error("ENOENT")),
                writeFile: (uri, content) => {
                    files.set(uri.toString(), new TextDecoder().decode(content as Uint8Array));
                    return Promise.resolve({} as never);
                },
                exists: () => Promise.resolve(true),
                createFolder: () => Promise.resolve({} as never),
            },
            openEditor: () => Promise.resolve(),
            userSettings: { resource: Uri.file("/user/settings.json"), open: () => Promise.resolve() },
            extensions: NO_DEBUG_EXTENSIONS,
            pickLate: () => Promise.resolve(undefined),
        };
        manager = new ConfigurationManager(adapterManager, ports);
    });

    afterEach(() => {
        manager.dispose();
    });

    describe("registration", () => {
        it("a provider is known by its type and trigger kind (Initial when not given) while registered; changes are announced", () => {
            const changed = vi.fn();
            manager.onDidChangeConfigurationProviders(changed);
            const provide = (): Promise<IConfig[]> => Promise.resolve([]);

            const initial = manager.registerDebugConfigurationProvider({
                type: "lldb",
                triggerKind: Initial,
                provideDebugConfigurations: provide,
            });
            manager.registerDebugConfigurationProvider({
                type: "gdb",
                triggerKind: Dynamic,
                provideDebugConfigurations: provide,
            });
            manager.registerDebugConfigurationProvider({ type: "node", triggerKind: Initial });

            expect(manager.hasDebugConfigurationProvider("lldb")).toBe(true);
            expect(manager.hasDebugConfigurationProvider("lldb", Dynamic)).toBe(false);
            expect(manager.hasDebugConfigurationProvider("gdb")).toBe(false);
            expect(manager.hasDebugConfigurationProvider("gdb", Dynamic)).toBe(true);
            // Without `provideDebugConfigurations` a provider does not count.
            expect(manager.hasDebugConfigurationProvider("node")).toBe(false);
            expect(changed).toHaveBeenCalledTimes(3);

            initial.dispose();
            expect(manager.hasDebugConfigurationProvider("lldb")).toBe(false);
            expect(changed).toHaveBeenCalledTimes(4);
            initial.dispose();
            expect(manager.hasDebugConfigurationProvider("gdb", Dynamic)).toBe(true);
        });
    });

    it("disposing a provider twice leaves the providers registered after it", async () => {
        const first = manager.registerDebugConfigurationProvider(tagging("lldb", "A"));
        manager.registerDebugConfigurationProvider(tagging("lldb", "B"));

        first.dispose();
        first.dispose();

        expect(
            trail(await manager.resolveConfigurationByProviders(undefined, "lldb", cfg("lldb"), CancellationTokenNone)),
        ).toBe("B");
    });

    describe("resolveConfigurationByProviders", () => {
        it("the type's providers in registration order, then the `*` ones; the type's activation first", async () => {
            manager.registerDebugConfigurationProvider(tagging("*", "S"));
            manager.registerDebugConfigurationProvider(tagging("lldb", "A"));
            manager.registerDebugConfigurationProvider(tagging("gdb", "X"));
            manager.registerDebugConfigurationProvider(tagging("lldb", "B"));
            manager.registerDebugConfigurationProvider({ type: "lldb", triggerKind: Initial });

            const result = await manager.resolveConfigurationByProviders(
                FOLDER.uri,
                "lldb",
                cfg("lldb"),
                CancellationTokenNone,
            );

            expect(trail(result)).toBe("ABS");
            expect(activated).toEqual(["onDebugResolve:lldb"]);
        });

        it("the folder and the token reach the provider", async () => {
            const resolve = vi.fn((_folder: Uri | undefined, config: IConfig) => Promise.resolve(config));
            manager.registerDebugConfigurationProvider({
                type: "lldb",
                triggerKind: Initial,
                resolveDebugConfiguration: resolve,
            });
            const token = new CancellationTokenSource().token;

            await manager.resolveConfigurationByProviders(FOLDER.uri, "lldb", cfg("lldb"), token);

            expect(resolve).toHaveBeenCalledWith(FOLDER.uri, cfg("lldb"), token);
        });

        it("a provider that changes the type: the new type's providers and its activation, then `*` again", async () => {
            manager.registerDebugConfigurationProvider(
                tagging("node", "N", (config) => ({ ...config, type: "pwa-node" })),
            );
            manager.registerDebugConfigurationProvider(tagging("pwa-node", "P"));
            manager.registerDebugConfigurationProvider(tagging("*", "S"));

            const result = await manager.resolveConfigurationByProviders(
                undefined,
                "node",
                cfg("node"),
                CancellationTokenNone,
            );

            expect(result).toMatchObject({ type: "pwa-node", trail: "NSPS" });
            expect(activated).toEqual(["onDebugResolve:node", "onDebugResolve:pwa-node"]);
        });

        it("a type seen before ends the loop: two providers that swap types do not spin", async () => {
            manager.registerDebugConfigurationProvider(tagging("a", "A", (config) => ({ ...config, type: "b" })));
            manager.registerDebugConfigurationProvider(tagging("b", "B", (config) => ({ ...config, type: "a" })));

            const result = await manager.resolveConfigurationByProviders(
                undefined,
                "a",
                cfg("a"),
                CancellationTokenNone,
            );

            expect(result).toMatchObject({ type: "a", trail: "AB" });
        });

        it("the configuration's own type comes first, an empty one too (upstream's `??`); without one the given type", async () => {
            manager.registerDebugConfigurationProvider(tagging("lldb", "L"));
            manager.registerDebugConfigurationProvider(tagging("gdb", "G"));

            expect(
                trail(
                    await manager.resolveConfigurationByProviders(undefined, "gdb", cfg("lldb"), CancellationTokenNone),
                ),
            ).toBe("L");
            expect(
                trail(await manager.resolveConfigurationByProviders(undefined, "gdb", cfg(""), CancellationTokenNone)),
            ).toBeUndefined();
            const { type: _type, ...untyped } = cfg("lldb");
            expect(
                trail(
                    await manager.resolveConfigurationByProviders(
                        undefined,
                        "gdb",
                        untyped as IConfig,
                        CancellationTokenNone,
                    ),
                ),
            ).toBe("G");
        });

        it("a provider that removes the type: the given type is next, as upstream's `result.type ?? type`", async () => {
            manager.registerDebugConfigurationProvider(
                tagging("lldb", "L", ({ type: _type, ...rest }) => rest as IConfig),
            );
            manager.registerDebugConfigurationProvider(tagging("gdb", "G"));

            const result = await manager.resolveConfigurationByProviders(
                undefined,
                "gdb",
                cfg("lldb"),
                CancellationTokenNone,
            );

            expect(result).toMatchObject({ trail: "LG" });
        });

        it("`undefined` or `null` stops the chain: no later provider is asked", async () => {
            const later = vi.fn();
            manager.registerDebugConfigurationProvider(tagging("lldb", "A", () => null));
            manager.registerDebugConfigurationProvider({
                type: "lldb",
                triggerKind: Initial,
                resolveDebugConfiguration: later,
            });
            manager.registerDebugConfigurationProvider({
                type: "*",
                triggerKind: Initial,
                resolveDebugConfiguration: later,
            });

            expect(
                await manager.resolveConfigurationByProviders(undefined, "lldb", cfg("lldb"), CancellationTokenNone),
            ).toBeNull();
            expect(later).not.toHaveBeenCalled();
        });

        it("without providers the configuration is as it was", async () => {
            const config = cfg("lldb");
            expect(
                await manager.resolveConfigurationByProviders(undefined, "lldb", config, CancellationTokenNone),
            ).toBe(config);
        });
    });

    describe("resolveDebugConfigurationWithSubstitutedVariables", () => {
        it("the type's providers, then the `*` ones; no activation", async () => {
            manager.registerDebugConfigurationProvider(tagging("*", "S"));
            manager.registerDebugConfigurationProvider(tagging("lldb", "A"));
            manager.registerDebugConfigurationProvider(tagging("gdb", "X"));
            manager.registerDebugConfigurationProvider({ type: "lldb", triggerKind: Initial });

            const result = await manager.resolveDebugConfigurationWithSubstitutedVariables(
                undefined,
                "lldb",
                cfg("lldb"),
                CancellationTokenNone,
            );

            expect((result as Tagged | undefined)?.trail2).toBe("AS");
            expect(activated).toEqual([]);
        });

        it("`undefined` stops the chain", async () => {
            const later = vi.fn();
            manager.registerDebugConfigurationProvider(tagging("lldb", "A", () => undefined));
            manager.registerDebugConfigurationProvider({
                type: "*",
                triggerKind: Initial,
                resolveDebugConfigurationWithSubstitutedVariables: later,
            });

            expect(
                await manager.resolveDebugConfigurationWithSubstitutedVariables(
                    undefined,
                    "lldb",
                    cfg("lldb"),
                    CancellationTokenNone,
                ),
            ).toBeUndefined();
            expect(later).not.toHaveBeenCalled();
        });
    });

    describe("provideDebugConfigurations and a new launch.json", () => {
        it("the Initial providers of the type, all of them, after `onDebugInitialConfigurations`", async () => {
            const provider = (type: string, triggerKind: DebugConfigurationProviderTriggerKind, name: string) => ({
                type,
                triggerKind,
                provideDebugConfigurations: () => Promise.resolve([cfg(type, { name })]),
            });
            manager.registerDebugConfigurationProvider(provider("lldb", Initial, "a"));
            manager.registerDebugConfigurationProvider(provider("lldb", Dynamic, "dynamic"));
            manager.registerDebugConfigurationProvider(provider("gdb", Initial, "other"));
            manager.registerDebugConfigurationProvider({ type: "lldb", triggerKind: Initial });
            manager.registerDebugConfigurationProvider(provider("lldb", Initial, "b"));

            const configs = await manager.provideDebugConfigurations(FOLDER.uri, "lldb", CancellationTokenNone);

            expect(configs.map((c) => c.name)).toEqual(["a", "b"]);
            expect(activated).toEqual(["onDebugInitialConfigurations"]);
        });

        function lldbDebugger(): Debugger {
            return new Debugger(
                { activateDebuggers: () => Promise.resolve() } as never,
                { type: "lldb", initialConfigurations: [{ name: "from the manifest" }] },
                () => ({}) as never,
                () => true,
                () => Promise.resolve(undefined),
            );
        }

        it("a new launch.json of a type has the debugger's initial configurations and the providers' ones", async () => {
            getDebugger = (type) => (type === "lldb" ? lldbDebugger() : undefined);
            const provide = vi.fn(() => Promise.resolve([cfg("lldb", { name: "from the provider" })]));
            manager.registerDebugConfigurationProvider({
                type: "lldb",
                triggerKind: Initial,
                provideDebugConfigurations: provide,
            });

            await manager.getLaunches()[0].openConfigFile({ preserveFocus: false, type: "lldb" });

            const written = files.get("file:///w/.diode/launch.json") ?? "";
            expect(written.indexOf('"name": "from the manifest"')).toBeGreaterThan(0);
            expect(written.indexOf('"name": "from the provider"')).toBeGreaterThan(
                written.indexOf("from the manifest"),
            );
            expect(provide).toHaveBeenCalledWith(FOLDER.uri, CancellationTokenNone);
        });

        it("`suppressInitialConfigs` leaves the providers out", async () => {
            getDebugger = (type) => (type === "lldb" ? lldbDebugger() : undefined);
            const provide = vi.fn(() => Promise.resolve([cfg("lldb", { name: "from the provider" })]));
            manager.registerDebugConfigurationProvider({
                type: "lldb",
                triggerKind: Initial,
                provideDebugConfigurations: provide,
            });

            await manager
                .getLaunches()[0]
                .openConfigFile({ preserveFocus: false, type: "lldb", suppressInitialConfigs: true });

            expect(files.get("file:///w/.diode/launch.json")).toBe(
                initialConfigurationContent([{ name: "from the manifest" }]),
            );
            expect(provide).not.toHaveBeenCalled();
        });
    });
});
