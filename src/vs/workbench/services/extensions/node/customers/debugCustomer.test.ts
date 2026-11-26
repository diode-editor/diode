import { afterEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { SESSIONLESS_DEBUG_SINK } from "../../../../../../TestUtils/debugSinkStub.ts";
import { CancellationTokenSource } from "../../../../../base/common/cancellation.ts";
import type { IDisposable } from "../../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../../base/common/uri.ts";
import type { IDebuggerExtension } from "../../../../api/common/debugAdapterExecutable.ts";
import { createDebugNamespace } from "../../../../api/common/debugNamespace.ts";
import type { HostRpc, SubprocessRpc } from "../../../../api/common/extHostProtocol.ts";
import type {
    IExtensionDebugConfigurationProvider,
    IExtensionDebugSink,
} from "../../../../api/common/iExtensionDebugSink.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import { ExtensionOwner } from "../../../../api/common/vscodeHostContext.ts";
import { EventEmitter } from "../../../../api/common/vscodeTypes.ts";

import { DebugCustomer } from "./debugCustomer.ts";

const EXT = "vadimcn.vscode-lldb";
const FOLDER: vscode.WorkspaceFolder = { uri: Uri.file("/ws") as unknown as vscode.Uri, name: "ws", index: 0 };
const CONFIG = { type: "lldb", request: "launch", name: "Launch" };

async function flush(): Promise<void> {
    for (let i = 0; i < 8; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

interface IRecordingSink extends IExtensionDebugSink {
    readonly providers: { extensionId: string; provider: IExtensionDebugConfigurationProvider; disposed: number }[];
}

function recordingSink(): IRecordingSink {
    const providers: IRecordingSink["providers"] = [];
    return {
        ...SESSIONLESS_DEBUG_SINK,
        providers,
        registerConfigurationProvider: (extensionId, provider): IDisposable => {
            const entry = { extensionId, provider, disposed: 0 };
            providers.push(entry);
            return {
                dispose: () => {
                    entry.disposed++;
                },
            };
        },
        registerDebugTypes: () => ({ dispose: () => undefined }),
        startDebugging: vi.fn(() => Promise.resolve(true)),
        stopDebugging: vi.fn(() => Promise.resolve()),
    };
}

const attached: IDisposable[] = [];

function setup(sink: IExtensionDebugSink | null = recordingSink()) {
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a) as unknown as HostRpc;
    const subRpc = new RpcEndpoint(b) as unknown as SubprocessRpc;
    const owner = new ExtensionOwner();
    const debug = createDebugNamespace({
        rpc: subRpc,
        owner,
        workspaceFolders: () => [FOLDER],
        extensions: { all: [], getExtension: () => undefined },
        onDidReceiveCatalog: new EventEmitter<readonly IDebuggerExtension[]>().event,
    });
    const attach = new DebugCustomer(sink ?? undefined).attach({ rpc: hostRpc, logger: undefined });
    attached.push(attach);
    return { debug, owner, attach, subRpc, sink: sink as IRecordingSink };
}

afterEach(() => {
    for (const disposable of attached.splice(0)) disposable.dispose();
});

describe("DebugCustomer — upstream MainThreadDebugService over the wire", () => {
    describe("configuration providers (producer: the extension's registerDebugConfigurationProvider)", () => {
        it("a registration reaches the sink with the extension, the type, the trigger kind and only the methods there are", async () => {
            const { debug, owner, sink } = setup();

            owner.runAs(EXT, () =>
                debug.registerDebugConfigurationProvider("lldb", { resolveDebugConfiguration: (_f, c) => c }, 2),
            );
            await flush();

            expect(sink.providers).toHaveLength(1);
            const [{ extensionId, provider }] = sink.providers;
            expect(extensionId).toBe(EXT);
            expect(provider.type).toBe("lldb");
            expect(provider.triggerKind).toBe(2);
            expect(provider.resolveDebugConfiguration).toBeTypeOf("function");
            expect(provider.provideDebugConfigurations).toBeUndefined();
            expect(provider.resolveDebugConfigurationWithSubstitutedVariables).toBeUndefined();
        });

        it("the core's calls reach the extension's provider with its folder and come back; undefined and null stay apart", async () => {
            const { debug, sink } = setup();
            const answers: unknown[] = [{ ...CONFIG, resolved: 1 }, undefined, null];
            debug.registerDebugConfigurationProvider("lldb", {
                provideDebugConfigurations: (folder) => [{ ...CONFIG, folder: folder?.name }, "not an object" as never],
                resolveDebugConfiguration: () => answers.shift() as never,
                resolveDebugConfigurationWithSubstitutedVariables: (folder, config) => ({
                    ...config,
                    folder: folder?.name,
                }),
            });
            await flush();
            const { provider } = sink.providers[0];
            const token = new CancellationTokenSource().token;

            expect(await provider.provideDebugConfigurations?.("file:///ws", token)).toEqual([
                { ...CONFIG, folder: "ws" },
            ]);
            expect(await provider.resolveDebugConfiguration?.(undefined, CONFIG, token)).toEqual({
                ...CONFIG,
                resolved: 1,
            });
            expect(await provider.resolveDebugConfiguration?.(undefined, CONFIG, token)).toBeUndefined();
            expect(await provider.resolveDebugConfiguration?.(undefined, CONFIG, token)).toBeNull();
            expect(
                await provider.resolveDebugConfigurationWithSubstitutedVariables?.("file:///ws", CONFIG, token),
            ).toEqual({
                ...CONFIG,
                folder: "ws",
            });
        });

        it("the core's cancellation reaches the extension's token in every method", async () => {
            const { debug, sink } = setup();
            const untilCancelled = <T>(token: vscode.CancellationToken | undefined, value: T): Promise<T> =>
                new Promise((resolve) => {
                    token?.onCancellationRequested(() => {
                        resolve(value);
                    });
                });
            debug.registerDebugConfigurationProvider("lldb", {
                provideDebugConfigurations: (_folder, token) => untilCancelled(token, [{ ...CONFIG, cancelled: 1 }]),
                resolveDebugConfiguration: (_folder, config, token) =>
                    untilCancelled(token, { ...config, cancelled: 2 }),
                resolveDebugConfigurationWithSubstitutedVariables: (_folder, config, token) =>
                    untilCancelled(token, { ...config, cancelled: 3 }),
            });
            await flush();
            const { provider } = sink.providers[0];
            const source = new CancellationTokenSource();

            const answers = Promise.all([
                provider.provideDebugConfigurations?.(undefined, source.token),
                provider.resolveDebugConfiguration?.(undefined, CONFIG, source.token),
                provider.resolveDebugConfigurationWithSubstitutedVariables?.(undefined, CONFIG, source.token),
            ]);
            await flush();
            source.cancel();

            await expect(answers).resolves.toEqual([
                [{ ...CONFIG, cancelled: 1 }],
                { ...CONFIG, cancelled: 2 },
                { ...CONFIG, cancelled: 3 },
            ]);
        });

        it("a provider with only provideDebugConfigurations has no resolve methods in the core", async () => {
            const { debug, sink } = setup();
            debug.registerDebugConfigurationProvider("lldb", { provideDebugConfigurations: () => [] });
            await flush();

            const { provider } = sink.providers[0];
            expect(provider.provideDebugConfigurations).toBeTypeOf("function");
            expect(provider.resolveDebugConfiguration).toBeUndefined();
            expect(provider.resolveDebugConfigurationWithSubstitutedVariables).toBeUndefined();
        });

        it("dispose in the extension takes the provider out of the core; so does the end of the spawn", async () => {
            const { debug, sink, attach } = setup();
            const first = debug.registerDebugConfigurationProvider("lldb", { resolveDebugConfiguration: (_f, c) => c });
            debug.registerDebugConfigurationProvider("gdb", { resolveDebugConfiguration: (_f, c) => c });
            await flush();

            first.dispose();
            await flush();
            expect(sink.providers.map((p) => p.disposed)).toEqual([1, 0]);

            attach.dispose();
            expect(sink.providers.map((p) => p.disposed)).toEqual([1, 1]);
        });

        it("a malformed registration or unregistration is ignored; a handle registered again replaces the old provider", async () => {
            const { subRpc, sink } = setup();
            const notify = (method: string, params: unknown): void => {
                (subRpc as unknown as { notify(m: string, p: unknown): void }).notify(method, params);
            };
            const registration = {
                handle: 7,
                type: "lldb",
                triggerKind: 1,
                hasProvide: false,
                hasResolve: false,
                hasResolveWithSubstitutedVariables: false,
                extensionId: EXT,
            };

            notify("debug.registerConfigurationProvider", { ...registration, triggerKind: 3 });
            notify("debug.unregisterConfigurationProvider", { handle: "7" });
            notify("debug.registerConfigurationProvider", registration);
            notify("debug.registerConfigurationProvider", { ...registration, type: "gdb" });
            await flush();

            expect(sink.providers.map((p) => [p.provider.type, p.disposed])).toEqual([
                ["lldb", 1],
                ["gdb", 0],
            ]);
        });
    });

    describe("startDebugging and stopDebugging (producer: the extension's calls)", () => {
        it("[api:debug.startDebugging] the request reaches the sink as the extension sent it; the answer comes back", async () => {
            const { debug, sink } = setup();

            await expect(debug.startDebugging(FOLDER, "Launch", { noDebug: true })).resolves.toBe(true);

            expect(sink.startDebugging).toHaveBeenCalledWith({
                folder: "file:///ws",
                nameOrConfig: "Launch",
                options: expect.objectContaining({ noDebug: true, consoleMode: 0 }) as unknown,
            });
        });

        it("[api:debug.stopDebugging] stop reaches the sink with the session id, or without one", async () => {
            const { debug, sink } = setup();

            await debug.stopDebugging();
            await debug.stopDebugging({ id: "s1" } as never);

            expect(vi.mocked(sink.stopDebugging).mock.calls).toEqual([[undefined], ["s1"]]);
        });

        it("a malformed start is refused; the sink's refusal reaches the extension", async () => {
            const { subRpc, sink, debug } = setup();
            const request = (subRpc as unknown as { request(m: string, p: unknown): Promise<unknown> }).request.bind(
                subRpc,
            );

            await expect(request("debug.startDebugging", { nameOrConfig: 5, options: {} })).rejects.toThrow(
                "cannot start debugging",
            );
            vi.mocked(sink.stopDebugging).mockRejectedValueOnce(new Error("debug session not found"));
            await expect(debug.stopDebugging({ id: "gone" } as never)).rejects.toThrow("debug session not found");
        });

        it("without a debug service nothing starts and stopping does nothing", async () => {
            const { debug } = setup(null);

            await expect(debug.startDebugging(undefined, "Launch")).resolves.toBe(false);
            await expect(debug.stopDebugging()).resolves.toBeUndefined();
        });
    });
});
