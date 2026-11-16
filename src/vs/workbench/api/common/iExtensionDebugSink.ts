import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";

import type { IWireDebugStartDebugging, WireDebugConfiguration, WireDebugTriggerKind } from "./debugWireTypes.ts";

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

/** Upstream `MainThreadDebugService`, the part of the configuration providers and of starting and stopping. */
export interface IExtensionDebugSink {
    registerConfigurationProvider(extensionId: string, provider: IExtensionDebugConfigurationProvider): IDisposable;
    startDebugging(request: IWireDebugStartDebugging): Promise<boolean>;
    /** Without a session every session stops; rejects for an unknown one. */
    stopDebugging(sessionId: string | undefined): Promise<void>;
}
