import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type {
    IExtensionDebugConfigurationProvider,
    IExtensionDebugSink,
} from "../../../../api/common/iExtensionDebugSink.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import {
    parseWireDebugConfigurationProvider,
    parseWireDebugConfigurations,
    parseWireDebugProviderHandle,
    parseWireDebugResolveResult,
    parseWireDebugStartDebugging,
    parseWireDebugStopDebugging,
} from "../debugWireParsers.ts";

/**
 * Upstream `MainThreadDebugService`, the configuration providers and starting and stopping sessions. Provider
 * registrations belong to the spawn: a dead subprocess takes its providers along.
 */
export class DebugCustomer implements IExtensionHostCustomer {
    public constructor(private readonly sink: IExtensionDebugSink | undefined) {}

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        const store = new DisposableStore();
        const sink = this.sink;
        if (sink === undefined) {
            // A host without a debug service (tests): nothing starts, there is nothing to stop.
            store.add(rpc.handleRequest("debug.startDebugging", () => false));
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
                if (request === null) return;
                providers.get(request.handle)?.dispose();
                providers.delete(request.handle);
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
