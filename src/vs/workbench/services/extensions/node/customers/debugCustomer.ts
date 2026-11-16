import { transformErrorFromSerialization } from "../../../../../base/common/errorSerialization.ts";
import { DisposableStore, type IDisposable, MutableDisposable } from "../../../../../base/common/lifecycle.ts";
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
    parseWireDebugConsoleAppend,
    parseWireDebugCustomRequest,
    parseWireDebugProtocolBreakpointRequest,
    parseWireDebugProviderHandle,
    parseWireDebugRegisterBreakpoints,
    parseWireDebugResolveResult,
    parseWireDebugSetSessionName,
    parseWireDebugStartDebugging,
    parseWireDebugStopDebugging,
    parseWireDebugTypes,
    parseWireDebugUnregisterBreakpoints,
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
        const adapters = store.add(new AdapterHost(rpc));
        const debugTypes = store.add(new MutableDisposable());
        store.add(
            rpc.handleNotification("debug.registerDebugTypes", (params) => {
                // The old types go first: their dispose drops whatever factory the types have.
                debugTypes.clear();
                debugTypes.value = sink.registerDebugTypes(parseWireDebugTypes(params), adapters);
            }),
        );
        store.add(
            rpc.handleNotification("debug.acceptAdapterMessage", (params) => {
                const accepted = parseWireDebugAdapterMessage(params);
                // Stryker disable next-line ConditionalExpression: equivalent, the endpoint drops a notification whose handler throws, as it drops a malformed one here
                if (accepted === null) return;
                // Stryker disable next-line OptionalChaining: equivalent, the endpoint drops a notification whose handler throws, as it drops one for an unknown handle here
                adapters.listener(accepted.handle)?.onMessage(accepted.message as DebugProtocol.ProtocolMessage);
            }),
        );
        store.add(
            rpc.handleNotification("debug.acceptAdapterError", (params) => {
                const accepted = parseWireDebugAdapterError(params);
                // Stryker disable next-line ConditionalExpression: equivalent, the endpoint drops a notification whose handler throws, as it drops a malformed one here
                if (accepted === null) return;
                // The error as the subprocess had it (upstream folds name and stack into the message).
                // Stryker disable next-line OptionalChaining: equivalent, the endpoint drops a notification whose handler throws, as it drops one for an unknown handle here
                adapters.listener(accepted.handle)?.onError(transformErrorFromSerialization(accepted.error));
            }),
        );
        store.add(
            rpc.handleNotification("debug.acceptAdapterExit", (params) => {
                const accepted = parseWireDebugAdapterExit(params);
                // Stryker disable next-line ConditionalExpression: equivalent, the endpoint drops a notification whose handler throws, as it drops a malformed one here
                if (accepted === null) return;
                // Stryker disable next-line OptionalChaining: equivalent, the endpoint drops a notification whose handler throws, as it drops one for an unknown handle here
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
        store.add(
            sink.subscribe({
                sessionStarted: (session) => {
                    rpc.notify("debug.acceptSessionStarted", { session });
                },
                sessionTerminated: (session) => {
                    rpc.notify("debug.acceptSessionTerminated", { session });
                },
                activeSessionChanged: (session) => {
                    rpc.notify("debug.acceptActiveSessionChanged", { session });
                },
                sessionNameChanged: (session, name) => {
                    rpc.notify("debug.acceptSessionNameChanged", { session, name });
                },
                sessionCustomEvent: (session, event, body) => {
                    rpc.notify("debug.acceptSessionCustomEvent", { session, event, body });
                },
                breakpointsChanged: (delta) => {
                    rpc.notify("debug.acceptBreakpointsDelta", delta);
                },
                stackFocusChanged: (focus) => {
                    rpc.notify("debug.acceptStackFocus", { focus });
                },
            }),
        );
        store.add(
            rpc.handleRequest("debug.customRequest", async (params) => {
                const request = parseWireDebugCustomRequest(params);
                if (request === null) throw new Error("custom request failed");
                return { body: await sink.customRequest(request.sessionId, request.command, request.args) };
            }),
        );
        store.add(
            rpc.handleRequest("debug.getDebugProtocolBreakpoint", async (params) => {
                const request = parseWireDebugProtocolBreakpointRequest(params);
                if (request === null) throw new Error("debug session not found");
                const breakpoint = await sink.getDebugProtocolBreakpoint(request.sessionId, request.breakpointId);
                return { breakpoint };
            }),
        );
        store.add(
            rpc.handleRequest("debug.registerBreakpoints", (params) => {
                sink.registerBreakpoints(parseWireDebugRegisterBreakpoints(params));
                return null;
            }),
        );
        store.add(
            rpc.handleRequest("debug.unregisterBreakpoints", (params) => {
                sink.unregisterBreakpoints(parseWireDebugUnregisterBreakpoints(params));
                return null;
            }),
        );
        store.add(
            rpc.handleNotification("debug.setSessionName", (params) => {
                const request = parseWireDebugSetSessionName(params);
                // Stryker disable next-line ConditionalExpression: equivalent, the endpoint drops a notification whose handler throws, as it drops a malformed one here
                if (request !== null) sink.setSessionName(request.sessionId, request.name);
            }),
        );
        store.add(
            rpc.handleNotification("debug.appendDebugConsole", (params) => {
                const request = parseWireDebugConsoleAppend(params);
                // Stryker disable next-line ConditionalExpression: equivalent, the endpoint drops a notification whose handler throws, as it drops a malformed one here
                if (request !== null) sink.appendDebugConsole(request.value);
            }),
        );
        return store;
    }
}

/** The adapters of one spawn: handles, and the listener of each live adapter for the messages that come back. */
class AdapterHost implements IExtensionDebugAdapterHost {
    private nextHandle = 1;
    /** The live adapters by handle: what each tells the core. */
    private readonly live = new Map<number, IExtensionDebugAdapterListener>();

    public constructor(private readonly rpc: HostRpc) {}

    public listener(handle: number): IExtensionDebugAdapterListener | undefined {
        return this.live.get(handle);
    }

    public createAdapter(
        session: IWireDebugSession,
        listener: IExtensionDebugAdapterListener,
    ): IExtensionDebugAdapterConnection {
        const handle = this.nextHandle++;
        this.live.set(handle, listener);
        return {
            start: async () => {
                await this.rpc.request("debug.startAdapter", { handle, session });
            },
            send: (message) => {
                if (this.live.has(handle)) this.rpc.notify("debug.sendAdapterMessage", { handle, message });
            },
            stop: async () => {
                if (this.live.delete(handle)) await this.rpc.request("debug.stopAdapter", { handle });
            },
        };
    }

    public dispose(): void {
        for (const listener of this.live.values()) listener.onError(new Error("Extension host shut down"));
        this.live.clear();
    }
}
