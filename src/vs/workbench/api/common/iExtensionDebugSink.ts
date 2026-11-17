import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";

import type {
    IWireDebugBreakpointsDelta,
    IWireDebugFocus,
    IWireDebugRegisterBreakpoints,
    IWireDebugSession,
    IWireDebugStartDebugging,
    IWireDebugUnregisterBreakpoints,
    WireDebugConfiguration,
    WireDebugTriggerKind,
} from "./debugWireTypes.ts";

/** What the core tells extensions about its sessions and breakpoints (upstream's `$accept*` calls). */
export interface IExtensionDebugEvents {
    sessionStarted(session: IWireDebugSession): void;
    sessionTerminated(session: IWireDebugSession): void;
    activeSessionChanged(session: IWireDebugSession | undefined): void;
    sessionNameChanged(session: IWireDebugSession, name: string): void;
    sessionCustomEvent(session: IWireDebugSession, event: string, body: unknown): void;
    breakpointsChanged(delta: IWireDebugBreakpointsDelta): void;
    stackFocusChanged(focus: IWireDebugFocus | undefined): void;
}

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

/**
 * Upstream `MainThreadDebugService`: configuration providers, starting and stopping sessions, debug adapters, the
 * sessions' events and requests, breakpoints and the Debug Console.
 */
export interface IExtensionDebugSink {
    /** The breakpoints there are come first (upstream `sendBreakpointsAndListen`), then every change. */
    subscribe(events: IExtensionDebugEvents): IDisposable;
    /** Upstream `$customDebugAdapterRequest`: the body of a successful response; rejects otherwise. */
    customRequest(sessionId: string, command: string, args: unknown): Promise<unknown>;
    /** Upstream `$getDebugProtocolBreakpoint`; rejects for an unknown session. */
    getDebugProtocolBreakpoint(sessionId: string, breakpointId: string): Promise<object | undefined>;
    setSessionName(sessionId: string, name: string): void;
    /** Into the focused session's Debug Console. */
    appendDebugConsole(value: string): void;
    /** The breakpoints are in the model on return; the adapters hear of them later. */
    registerBreakpoints(request: IWireDebugRegisterBreakpoints): void;
    unregisterBreakpoints(request: IWireDebugUnregisterBreakpoints): void;
    /** Upstream `$registerDebugTypes`: the adapters of these types live in the subprocess; dispose — not any more. */
    registerDebugTypes(types: readonly string[], host: IExtensionDebugAdapterHost): IDisposable;
    registerConfigurationProvider(extensionId: string, provider: IExtensionDebugConfigurationProvider): IDisposable;
    startDebugging(request: IWireDebugStartDebugging): Promise<boolean>;
    /** Without a session every session stops; rejects for an unknown one. */
    stopDebugging(sessionId: string | undefined): Promise<void>;
}
