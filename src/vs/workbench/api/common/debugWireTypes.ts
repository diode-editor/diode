// The `debug.*` messages between the core and the extension subprocess (upstream `MainThreadDebugServiceShape` /
// `ExtHostDebugServiceShape`): the configuration providers, starting and stopping sessions, and the debug adapters
// that live in the subprocess. Session objects and events come with their task (#1141).

import type { SerializedError } from "../../../base/common/errorSerialization.ts";

/**
 * A launch configuration as JSON: `type`, `name`, `request` and whatever the debugger reads. The core checks the
 * three when it starts a session, as upstream does; on the wire it is any object.
 */
export type WireDebugConfiguration = object;

/** `vscode.DebugConfigurationProviderTriggerKind`. */
export type WireDebugTriggerKind = 1 | 2;

/** Upstream `$registerDebugConfigurationProvider(type, triggerKind, hasProvide, hasResolve, hasResolve2, handle)`. */
export interface IWireDebugConfigurationProvider {
    readonly handle: number;
    readonly type: string;
    readonly triggerKind: WireDebugTriggerKind;
    readonly hasProvide: boolean;
    readonly hasResolve: boolean;
    readonly hasResolveWithSubstitutedVariables: boolean;
    readonly extensionId: string;
}

export interface IWireDebugProviderHandle {
    readonly handle: number;
}

/** `folder` — the uri string of the workspace folder, absent for none. */
export interface IWireDebugProvideConfigurations {
    readonly handle: number;
    readonly folder?: string;
}

export interface IWireDebugResolveConfiguration {
    readonly handle: number;
    readonly folder?: string;
    readonly config: WireDebugConfiguration;
}

/** The provider's answer: no `config` — `undefined` (abort), `null` — abort and open launch.json. */
export interface IWireDebugResolveResult {
    readonly config?: WireDebugConfiguration | null;
}

/** Upstream `IStartDebuggingOptions` as far as the core has the matching session options. */
export interface IWireDebugStartOptions {
    readonly parentSessionId?: string;
    readonly lifecycleManagedByParent?: boolean;
    /** `vscode.DebugConsoleMode`: 0 — separate, 1 — merge with the parent. */
    readonly consoleMode?: number;
    readonly noDebug?: boolean;
    readonly compact?: boolean;
    readonly suppressSaveBeforeStart?: boolean;
    readonly suppressDebugStatusbar?: boolean;
    readonly suppressDebugToolbar?: boolean;
    readonly suppressDebugView?: boolean;
}

/** Upstream `$startDebugging(folder, nameOrConfig, options)`. */
export interface IWireDebugStartDebugging {
    readonly folder?: string;
    readonly nameOrConfig: string | WireDebugConfiguration;
    readonly options: IWireDebugStartOptions;
}

/** Upstream `$stopDebugging(sessionId)`: without a session every session stops. */
export interface IWireDebugStopDebugging {
    readonly sessionId?: string;
}

/** Upstream `$registerDebugTypes`: the types of the main debugger contributions, adapters of the subprocess. */
export interface IWireDebugTypes {
    readonly types: readonly string[];
}

/**
 * Upstream `IDebugSessionFullDto`: what the subprocess needs of a session to create its adapter. `folder` — the uri
 * string of the session's workspace folder, `parentId` — the id of the parent session.
 */
export interface IWireDebugSession {
    readonly id: string;
    readonly type: string;
    readonly name: string;
    readonly folder?: string;
    readonly configuration: WireDebugConfiguration;
    readonly parentId?: string;
}

/** Upstream `$startDASession(handle, session)`: the handle names the adapter in every later message. */
export interface IWireDebugStartAdapter {
    readonly handle: number;
    readonly session: IWireDebugSession;
}

export interface IWireDebugAdapterHandle {
    readonly handle: number;
}

/** A DAP message (request, response or event) of the adapter `handle`, in either direction. */
export interface IWireDebugAdapterMessage {
    readonly handle: number;
    readonly message: object;
}

/** Upstream `$acceptDAError`: the error as the RPC serializes a rejection (name, message, stack, code, cause). */
export interface IWireDebugAdapterError {
    readonly handle: number;
    readonly error: SerializedError;
}

/** Upstream `$acceptDAExit`: no `code` — the adapter has none (a connection, an inline adapter). */
export interface IWireDebugAdapterExit {
    readonly handle: number;
    readonly code?: number;
}
