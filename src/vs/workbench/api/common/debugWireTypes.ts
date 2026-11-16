// The `debug.*` messages between the core and the extension subprocess (upstream `MainThreadDebugServiceShape` /
// `ExtHostDebugServiceShape`): the configuration providers and starting and stopping sessions. Adapters and sessions
// come with their tasks (#1140, #1141).

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
