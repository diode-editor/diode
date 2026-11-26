// The `debug.*` messages between the core and the extension subprocess (upstream `MainThreadDebugServiceShape` /
// `ExtHostDebugServiceShape`): the configuration providers, starting and stopping sessions, and the debug adapters
// that live in the subprocess, the sessions and their events, breakpoints, the stack focus and the Debug Console.

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
    /** The task of the extension's `TestRun` the session is for. */
    readonly testRun?: { readonly runId: string; readonly taskId: string };
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

/** Upstream `$acceptDebugSessionStarted`/`Terminated`: the session the event is about. */
export interface IWireDebugSessionEvent {
    readonly session: IWireDebugSession;
}

/** Upstream `$acceptDebugSessionActiveChanged`: no `session` — no session is focused. */
export interface IWireDebugActiveSession {
    readonly session?: IWireDebugSession;
}

/** Upstream `$acceptDebugSessionNameChanged`. */
export interface IWireDebugSessionName {
    readonly session: IWireDebugSession;
    readonly name: string;
}

/** Upstream `$acceptDebugSessionCustomEvent`: a DAP event of the session's adapter. */
export interface IWireDebugSessionCustomEvent {
    readonly session: IWireDebugSession;
    readonly event: string;
    readonly body?: unknown;
}

/** Upstream `IBreakpointDto` fields; `id` is the core's id of the breakpoint. */
export interface IWireDebugBreakpointBase {
    readonly id: string;
    readonly enabled: boolean;
    readonly condition?: string;
    readonly hitCondition?: string;
    readonly logMessage?: string;
    readonly mode?: string;
}

/** Upstream `ISourceBreakpointDto`: `uri` — a uri string, `line`/`character` 0-based. */
export interface IWireDebugSourceBreakpoint extends IWireDebugBreakpointBase {
    readonly type: "source";
    readonly uri: string;
    readonly line: number;
    readonly character: number;
}

/** Upstream `IFunctionBreakpointDto`. */
export interface IWireDebugFunctionBreakpoint extends IWireDebugBreakpointBase {
    readonly type: "function";
    readonly functionName: string;
}

export type WireDebugBreakpoint = IWireDebugSourceBreakpoint | IWireDebugFunctionBreakpoint;

/**
 * Upstream `IBreakpointsDeltaDto` with all three lists (upstream leaves out the empty ones): `removed` — the ids.
 * Data breakpoints do not cross (milestone 2). Absent optional fields of a breakpoint are simply not on the wire.
 */
export interface IWireDebugBreakpointsDelta {
    readonly added: readonly WireDebugBreakpoint[];
    readonly removed: readonly string[];
    readonly changed: readonly WireDebugBreakpoint[];
}

/** One breakpoint of `IWireDebugSourceMultiBreakpoint`: `line`/`character` 0-based. */
export interface IWireDebugSourceLine extends IWireDebugBreakpointBase {
    readonly line: number;
    readonly character: number;
}

/** Upstream `ISourceMultiBreakpointDto`: the breakpoints an extension adds to one file. */
export interface IWireDebugSourceMultiBreakpoint {
    readonly type: "sourceMulti";
    readonly uri: string;
    readonly lines: readonly IWireDebugSourceLine[];
}

/** Upstream `$registerBreakpoints`. */
export interface IWireDebugRegisterBreakpoints {
    readonly breakpoints: readonly (IWireDebugSourceMultiBreakpoint | IWireDebugFunctionBreakpoint)[];
}

/** Upstream `$unregisterBreakpoints` without the data breakpoints. */
export interface IWireDebugUnregisterBreakpoints {
    readonly breakpointIds: readonly string[];
    readonly functionBreakpointIds: readonly string[];
}

/** Upstream `IThreadFocusDto` / `IStackFrameFocusDto`. */
export interface IWireDebugFocus {
    readonly session: IWireDebugSession;
    readonly threadId: number;
    /** Absent — the thread is focused, not a frame of it. */
    readonly frameId?: number;
}

/** Upstream `$acceptStackFrameFocus`: no `focus` — nothing is focused. */
export interface IWireDebugStackFocus {
    readonly focus?: IWireDebugFocus;
}

/** Upstream `$customDebugAdapterRequest(sessionId, command, args)`. */
export interface IWireDebugCustomRequest {
    readonly sessionId: string;
    readonly command: string;
    readonly args?: unknown;
}

/** The `body` of the adapter's successful response. */
export interface IWireDebugCustomResponse {
    readonly body?: unknown;
}

/** Upstream `$getDebugProtocolBreakpoint(sessionId, breakpointId)`. */
export interface IWireDebugProtocolBreakpointRequest {
    readonly sessionId: string;
    readonly breakpointId: string;
}

/** The adapter's breakpoint; absent when the session has none for that id. */
export interface IWireDebugProtocolBreakpoint {
    readonly breakpoint?: object;
}

/** Upstream `$setDebugSessionName`. */
export interface IWireDebugSetSessionName {
    readonly sessionId: string;
    readonly name: string;
}

/** Upstream `$appendDebugConsole`. */
export interface IWireDebugConsoleAppend {
    readonly value: string;
}
