import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { IWireDebugSession } from "../../../../api/common/debugWireTypes.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import type {
    IExtensionDebugAdapterConnection,
    IExtensionDebugAdapterHost,
    IExtensionDebugAdapterListener,
    IExtensionDebugConfigurationProvider,
    IExtensionDebugSink,
} from "../../../../api/common/iExtensionDebugSink.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import {
    parseWireDebugAdapterError,
    parseWireDebugAdapterExit,
    parseWireDebugAdapterMessage,
    parseWireDebugConfigurationProvider,
    parseWireDebugConfigurations,
    parseWireDebugProviderHandle,
    parseWireDebugResolveResult,
    parseWireDebugStartDebugging,
    parseWireDebugStopDebugging,
    parseWireDebugTypes,
} from "../debugWireParsers.ts";

/**
 * Upstream `MainThreadDebugService`: the configuration providers, starting and stopping sessions, and the debug
 * adapters of the subprocess. Registrations belong to the spawn: a dead subprocess takes its providers and debug
 * types along, and each of its live adapters ends with an error.
 */
export class DebugCustomer implements IExtensionHostCustomer {
    public constructor(private readonly sink: IExtensionDebugSink | undefined) {}

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        const store = new DisposableStore();
        const sink = this.sink;
        if (sink === undefined) {
            // A host without a debug service (tests): nothing starts, there is nothing to stop.
            store.add(rpc.handleRequest("debug.startDebugging", () => false));
            // Stryker disable next-line ArrowFunction: equivalent, the extension ignores the answer of a stop
            store.add(rpc.handleRequest("debug.stopDebugging", () => null));
            return store;
        }
        const providers = new Map<number, IDisposable>();
        store.add({
            dispose: () => {
                for (const registration of providers.values()) registration.dispose();
            },
        });

        store.add(
            rpc.handleNotification("debug.registerConfigurationProvider", (params) => {
                const registration = parseWireDebugConfigurationProvider(params);
                // Stryker disable next-line ConditionalExpression: equivalent, the endpoint drops a notification whose handler throws, as it drops this one
                if (registration === null) return;
                const { handle } = registration;
                const provider: {
                    -readonly [K in keyof IExtensionDebugConfigurationProvider]: IExtensionDebugConfigurationProvider[K];
                } = { type: registration.type, triggerKind: registration.triggerKind };
                if (registration.hasProvide) {
                    provider.provideDebugConfigurations = async (folder, token) =>
                        parseWireDebugConfigurations(
                            await rpc.request("debug.provideConfigurations", { handle, folder }, { token }),
                        );
                }
                if (registration.hasResolve) {
                    provider.resolveDebugConfiguration = async (folder, config, token) =>
                        parseWireDebugResolveResult(
                            await rpc.request("debug.resolveConfiguration", { handle, folder, config }, { token }),
                        );
                }
                if (registration.hasResolveWithSubstitutedVariables) {
                    provider.resolveDebugConfigurationWithSubstitutedVariables = async (folder, config, token) =>
                        parseWireDebugResolveResult(
                            await rpc.request(
                                "debug.resolveConfigurationWithSubstitutedVariables",
                                { handle, folder, config },
                                { token },
                            ),
                        );
                }
                providers.get(handle)?.dispose();
                providers.set(handle, sink.registerConfigurationProvider(registration.extensionId, provider));
            }),
        );
        store.add(
            rpc.handleNotification("debug.unregisterConfigurationProvider", (params) => {
                const request = parseWireDebugProviderHandle(params);
                // Stryker disable next-line ConditionalExpression,OptionalChaining: equivalent, the endpoint drops a notification whose handler throws, as it drops a malformed or unknown handle here
                if (request === null) return;
                // Stryker disable next-line OptionalChaining: same as above
                providers.get(request.handle)?.dispose();
                providers.delete(request.handle);
            }),
        );
        const adapters = new AdapterHost(rpc);
        let debugTypes: IDisposable | undefined;
        store.add({
            dispose: () => {
                debugTypes?.dispose();
                adapters.dispose();
            },
        });
        store.add(
            rpc.handleNotification("debug.registerDebugTypes", (params) => {
                debugTypes?.dispose();
                debugTypes = sink.registerDebugTypes(parseWireDebugTypes(params), adapters);
            }),
        );
        store.add(
            rpc.handleNotification("debug.acceptAdapterMessage", (params) => {
                const accepted = parseWireDebugAdapterMessage(params);
                if (accepted === null) return;
                adapters.listener(accepted.handle)?.onMessage(accepted.message as DebugProtocol.ProtocolMessage);
            }),
        );
        store.add(
            rpc.handleNotification("debug.acceptAdapterError", (params) => {
                const accepted = parseWireDebugAdapterError(params);
                if (accepted === null) return;
                // The error as the subprocess had it (upstream folds name and stack into the message).
                const error = new Error(accepted.message);
                error.name = accepted.name;
                if (accepted.stack !== undefined) error.stack = accepted.stack;
                adapters.listener(accepted.handle)?.onError(error);
            }),
        );
        store.add(
            rpc.handleNotification("debug.acceptAdapterExit", (params) => {
                const accepted = parseWireDebugAdapterExit(params);
                if (accepted === null) return;
                adapters.listener(accepted.handle)?.onExit(accepted.code);
            }),
        );
        store.add(
            rpc.handleRequest("debug.startDebugging", (params) => {
                const request = parseWireDebugStartDebugging(params);
                if (request === null) return Promise.reject(new Error("cannot start debugging"));
                return sink.startDebugging(request);
            }),
        );
        store.add(
            rpc.handleRequest("debug.stopDebugging", async (params) => {
                await sink.stopDebugging(parseWireDebugStopDebugging(params).sessionId);
                return null;
            }),
        );
        return store;
    }
}

/** The adapters of one spawn: handles, and the listener of each live adapter for the messages that come back. */
class AdapterHost implements IExtensionDebugAdapterHost {
    private nextHandle = 1;
    private readonly listeners = new Map<number, IExtensionDebugAdapterListener>();
    private disposed = false;

    public constructor(private readonly rpc: HostRpc) {}

    public listener(handle: number): IExtensionDebugAdapterListener | undefined {
        return this.listeners.get(handle);
    }

    public createAdapter(
        session: IWireDebugSession,
        listener: IExtensionDebugAdapterListener,
    ): IExtensionDebugAdapterConnection {
        const handle = this.nextHandle++;
        this.listeners.set(handle, listener);
        return {
            start: async () => {
                await this.rpc.request("debug.startAdapter", { handle, session });
            },
            send: (message) => {
                if (!this.disposed) this.rpc.notify("debug.sendAdapterMessage", { handle, message });
            },
            stop: async () => {
                this.listeners.delete(handle);
                if (!this.disposed) await this.rpc.request("debug.stopAdapter", { handle });
            },
        };
    }

    public dispose(): void {
        this.disposed = true;
        for (const listener of this.listeners.values()) listener.onError(new Error("Extension host shut down"));
        this.listeners.clear();
    }
}
