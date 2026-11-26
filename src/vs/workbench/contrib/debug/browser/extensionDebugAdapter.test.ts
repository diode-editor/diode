import { describe, expect, it, vi } from "vitest";

import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type {
    IAdapterManager,
    IConfig,
    IConfigurationManager,
    IDebugConfigurationProvider,
    IDebugService,
    IDebugSession,
    ILaunch,
} from "../common/debug.ts";

import { bindExtensionDebuggers, ExtensionDebugAdapter } from "./extensionDebugAdapter.ts";

const CONFIG: IConfig = { type: "lldb", request: "launch", name: "Launch" };
const FOLDER = Uri.file("/ws");

function fakeService() {
    const registered: IDebugConfigurationProvider[] = [];
    const launch = { name: "ws" } as ILaunch;
    const sessions = new Map<string, IDebugSession>([
        ["parent", { getId: () => "parent", configuration: { ...CONFIG, request: "launch" } } as IDebugSession],
        ["attached", { getId: () => "attached", configuration: { ...CONFIG, request: "attach" } } as IDebugSession],
        ["ended", { getId: () => "ended", configuration: { ...CONFIG, request: "launch" } } as IDebugSession],
    ]);
    const service = {
        getConfigurationManager: () =>
            ({
                registerDebugConfigurationProvider: (provider: IDebugConfigurationProvider) => {
                    registered.push(provider);
                    return { dispose: vi.fn() };
                },
                getLaunch: (uri: Uri | undefined) => (uri?.toString() === FOLDER.toString() ? launch : undefined),
            }) as unknown as IConfigurationManager,
        getModel: () => ({
            getSession: (id: string | undefined, includeInactive = false) =>
                id === "ended" && !includeInactive ? undefined : id ? sessions.get(id) : undefined,
        }),
        startDebugging: vi.fn(() => Promise.resolve(true)),
        stopSession: vi.fn(() => Promise.resolve()),
    };
    return { service, registered, launch, sessions };
}

describe("ExtensionDebugAdapter — upstream MainThreadDebugService over the debug service", () => {
    it("a provider joins the configuration manager with the folder as a uri string and only its methods", async () => {
        const { service, registered } = fakeService();
        const adapter = new ExtensionDebugAdapter(() => service as unknown as IDebugService);
        const provide = vi.fn(() => Promise.resolve([CONFIG]));
        const resolve = vi.fn(() => Promise.resolve(null));
        const resolve2 = vi.fn(() => Promise.resolve(undefined));

        adapter.registerConfigurationProvider("a.b", {
            type: "lldb",
            triggerKind: 2,
            provideDebugConfigurations: provide,
            resolveDebugConfiguration: resolve,
            resolveDebugConfigurationWithSubstitutedVariables: resolve2,
        });
        adapter.registerConfigurationProvider("a.b", { type: "gdb", triggerKind: 1 });

        const [lldb, gdb] = registered;
        expect([lldb.type, lldb.triggerKind, gdb.type, gdb.triggerKind]).toEqual(["lldb", 2, "gdb", 1]);
        expect(gdb.provideDebugConfigurations).toBeUndefined();
        expect(gdb.resolveDebugConfiguration).toBeUndefined();
        expect(gdb.resolveDebugConfigurationWithSubstitutedVariables).toBeUndefined();
        expect(await lldb.provideDebugConfigurations?.(FOLDER, CancellationTokenNone)).toEqual([CONFIG]);
        expect(await lldb.resolveDebugConfiguration?.(undefined, CONFIG, CancellationTokenNone)).toBeNull();
        expect(
            await lldb.resolveDebugConfigurationWithSubstitutedVariables?.(FOLDER, CONFIG, CancellationTokenNone),
        ).toBeUndefined();
        expect(provide).toHaveBeenCalledWith("file:///ws", CancellationTokenNone);
        expect(resolve).toHaveBeenCalledWith(undefined, CONFIG, CancellationTokenNone);
        expect(resolve2).toHaveBeenCalledWith("file:///ws", CONFIG, CancellationTokenNone);
    });

    it("the provider's methods are called on the provider", async () => {
        const { service, registered } = fakeService();
        const adapter = new ExtensionDebugAdapter(() => service as unknown as IDebugService);
        const provider = {
            type: "lldb",
            triggerKind: 1 as const,
            name: "own",
            provideDebugConfigurations(this: { name: string }) {
                return Promise.resolve([{ ...CONFIG, name: this.name }]);
            },
            resolveDebugConfiguration(this: { name: string }) {
                return Promise.resolve({ ...CONFIG, name: this.name });
            },
            resolveDebugConfigurationWithSubstitutedVariables(this: { name: string }) {
                return Promise.resolve({ ...CONFIG, name: this.name });
            },
        };

        adapter.registerConfigurationProvider("a.b", provider);

        const [core] = registered;
        expect((await core.provideDebugConfigurations?.(undefined, CancellationTokenNone))?.[0].name).toBe("own");
        expect((await core.resolveDebugConfiguration?.(undefined, CONFIG, CancellationTokenNone))?.name).toBe("own");
        expect(
            (await core.resolveDebugConfigurationWithSubstitutedVariables?.(undefined, CONFIG, CancellationTokenNone))
                ?.name,
        ).toBe("own");
    });

    it("[api:debug.startDebugging] upstream's $startDebugging: the folder's launch, the parent session and the options", async () => {
        const { service, launch, sessions } = fakeService();
        const adapter = new ExtensionDebugAdapter(() => service as unknown as IDebugService);

        await expect(
            adapter.startDebugging({
                folder: "file:///ws",
                nameOrConfig: "Launch",
                options: {
                    parentSessionId: "parent",
                    lifecycleManagedByParent: true,
                    consoleMode: 1,
                    noDebug: true,
                    compact: true,
                    suppressSaveBeforeStart: true,
                    suppressDebugStatusbar: true,
                    suppressDebugToolbar: false,
                    suppressDebugView: true,
                    testRun: { runId: "r", taskId: "t" },
                },
            }),
        ).resolves.toBe(true);
        await adapter.startDebugging({ nameOrConfig: CONFIG, options: { suppressSaveBeforeStart: false } });
        await adapter.startDebugging({ folder: "file:///elsewhere", nameOrConfig: "x", options: {} });

        expect(service.startDebugging.mock.calls).toEqual([
            [
                launch,
                "Launch",
                {
                    noDebug: true,
                    parentSession: sessions.get("parent"),
                    lifecycleManagedByParent: true,
                    repl: "mergeWithParent",
                    compact: true,
                    saveBeforeRestart: false,
                    suppressDebugStatusbar: true,
                    suppressDebugToolbar: false,
                    suppressDebugView: true,
                    testRun: { runId: "r", taskId: "t" },
                },
                false,
            ],
            [undefined, CONFIG, expect.objectContaining({ repl: "separate", saveBeforeRestart: true }), true],
            [
                undefined,
                "x",
                expect.objectContaining({ parentSession: undefined, saveBeforeRestart: undefined }),
                undefined,
            ],
        ]);
    });

    it("[api:debug.stopDebugging] upstream's $stopDebugging: all, one (an attached one is disconnected), an unknown one is an error", async () => {
        const { service, sessions } = fakeService();
        const adapter = new ExtensionDebugAdapter(() => service as unknown as IDebugService);

        await adapter.stopDebugging(undefined);
        await adapter.stopDebugging("parent");
        await adapter.stopDebugging("attached");
        // Upstream looks among the inactive sessions too.
        await adapter.stopDebugging("ended");
        await expect(adapter.stopDebugging("gone")).rejects.toThrow("debug session not found");

        expect(service.stopSession.mock.calls).toEqual([
            [undefined],
            [sessions.get("parent"), false],
            [sessions.get("attached"), true],
            [sessions.get("ended"), false],
        ]);
    });
});

describe("bindExtensionDebuggers — upstream's `debuggers` extension point", () => {
    function extension(id: string, debuggers: unknown): IExtension {
        return {
            id,
            manifest: { name: id, publisher: "p", version: "1.0.0", contributes: { debuggers } },
        } as unknown as IExtension;
    }

    it("every debugger of every extension is registered until the binding is disposed; broken ones are warnings", () => {
        const registrations: { type: string; dispose: ReturnType<typeof vi.fn> }[] = [];
        const service = {
            getAdapterManager: () =>
                ({
                    registerDebugger: (contribution: { type: string }) => {
                        const registration = { type: contribution.type, dispose: vi.fn() };
                        registrations.push(registration);
                        return registration;
                    },
                }) as unknown as IAdapterManager,
        } as IDebugService;
        const warn = vi.fn();

        const binding = bindExtensionDebuggers(
            service,
            [
                extension("vadimcn.vscode-lldb", [
                    { type: "lldb", label: "CodeLLDB" },
                    { label: "no type" },
                    { type: "" },
                    null,
                ]),
                { id: "no.contributes", manifest: { name: "x", publisher: "p", version: "1.0.0" } } as IExtension,
                extension("not.array", { type: "x" }),
                extension("ms-vscode.js-debug", [{ type: "pwa-node" }, { type: "*", variables: {} }]),
            ],
            { warn } as never,
        );

        expect(registrations.map((r) => r.type)).toEqual(["lldb", "pwa-node", "*"]);
        expect(warn.mock.calls.map(([message]) => message as unknown)).toEqual([
            "vadimcn.vscode-lldb: Debugger 'type' can not be omitted and must be of type 'string'.",
            "vadimcn.vscode-lldb: Debugger 'type' can not be omitted and must be of type 'string'.",
            "vadimcn.vscode-lldb: Debugger 'type' can not be omitted and must be of type 'string'.",
            "not.array: 'contributes.debuggers' must be an array.",
        ]);
        binding.dispose();
        expect(registrations.every((r) => r.dispose.mock.calls.length === 1)).toBe(true);
    });

    it("every `contributes.breakpoints` entry with a language is registered until the binding is disposed", () => {
        const registrations: { language: string; when?: string; dispose: ReturnType<typeof vi.fn> }[] = [];
        const service = {
            getAdapterManager: () =>
                ({
                    registerBreakpoints: (contribution: { language: string; when?: string }) => {
                        const registration = { ...contribution, dispose: vi.fn() };
                        registrations.push(registration);
                        return registration;
                    },
                }) as unknown as IAdapterManager,
        } as IDebugService;
        const withBreakpoints = (id: string, breakpoints: unknown): IExtension =>
            ({
                id,
                manifest: { name: id, publisher: "p", version: "1.0.0", contributes: { breakpoints } },
            }) as unknown as IExtension;

        const binding = bindExtensionDebuggers(
            service,
            [
                withBreakpoints("vadimcn.vscode-lldb", [
                    { language: "c" },
                    { language: "rust", when: "lldb.enabled" },
                    { when: "x" },
                    { language: 1 },
                    null,
                ]),
                withBreakpoints("not.array", { language: "go" }),
            ],
            { warn: vi.fn() } as never,
        );

        expect(registrations.map(({ language, when }) => ({ language, when }))).toEqual([
            { language: "c", when: undefined },
            { language: "rust", when: "lldb.enabled" },
        ]);
        binding.dispose();
        expect(registrations.every((r) => r.dispose.mock.calls.length === 1)).toBe(true);
    });
});
