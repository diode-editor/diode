import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";

import type {
    IWireDebugSession,
    IWireDebugStartDebugging,
    WireDebugConfiguration,
    WireDebugTriggerKind,
} from "./debugWireTypes.ts";

/**
 * A `vscode.DebugConfigurationProvider` of an extension as the core sees it: only the methods it implements.
 * `folder` is the uri string of the workspace folder.
 */
export interface IExtensionDebugConfigurationProvider {
    readonly type: string;
    readonly triggerKind: WireDebugTriggerKind;
    provideDebugConfigurations?(
        folder: string | undefined,
        token: ICancellationToken,
    ): Promise<WireDebugConfiguration[]>;
    resolveDebugConfiguration?(
        folder: string | undefined,
        config: WireDebugConfiguration,
        token: ICancellationToken,
    ): Promise<WireDebugConfiguration | null | undefined>;
    resolveDebugConfigurationWithSubstitutedVariables?(
        folder: string | undefined,
        config: WireDebugConfiguration,
        token: ICancellationToken,
    ): Promise<WireDebugConfiguration | null | undefined>;
}

/** What a debug adapter of the subprocess tells the core. */
export interface IExtensionDebugAdapterListener {
    onMessage(message: DebugProtocol.ProtocolMessage): void;
    onError(error: Error): void;
    /** `undefined` — the adapter has no exit code (a connection, an inline adapter). */
    onExit(code: number | undefined): void;
}

/** One debug adapter in the subprocess, as the core drives it (upstream's `$startDASession` and the rest). */
export interface IExtensionDebugAdapterConnection {
    start(): Promise<void>;
    send(message: DebugProtocol.ProtocolMessage): void;
    /** Resolves at once when the subprocess is gone. */
    stop(): Promise<void>;
}

/**
 * The subprocess as the place of the adapters of its debug types. A subprocess that goes away while an adapter is
 * alive reports "Extension host shut down" as the adapter's error, as upstream's.
 */
export interface IExtensionDebugAdapterHost {
    createAdapter(
        session: IWireDebugSession,
        listener: IExtensionDebugAdapterListener,
    ): IExtensionDebugAdapterConnection;
}

/** Upstream `MainThreadDebugService`: configuration providers, starting and stopping sessions, debug adapters. */
export interface IExtensionDebugSink {
    /** Upstream `$registerDebugTypes`: the adapters of these types live in the subprocess; dispose — not any more. */
    registerDebugTypes(types: readonly string[], host: IExtensionDebugAdapterHost): IDisposable;
    registerConfigurationProvider(extensionId: string, provider: IExtensionDebugConfigurationProvider): IDisposable;
    startDebugging(request: IWireDebugStartDebugging): Promise<boolean>;
    /** Without a session every session stops; rejects for an unknown one. */
    stopDebugging(sessionId: string | undefined): Promise<void>;
}
