import type * as vscode from "vscode";

import { Uri } from "../../../base/common/uri.ts";

import { DebugConfigurationProviderTriggerKind, DebugConsoleMode } from "./debugTypes.ts";
import type {
    IWireDebugResolveResult,
    IWireDebugStartOptions,
    WireDebugConfiguration,
    WireDebugTriggerKind,
} from "./debugWireTypes.ts";
import type { SubprocessRpc } from "./extHostProtocol.ts";
import { callWithVscodeToken } from "./vscodeCancellation.ts";
import type { ExtensionOwner } from "./vscodeHostContext.ts";
import { DisposableImpl, EventEmitter } from "./vscodeTypes.ts";

/**
 * Upstream's `ExtHostDebugService`, as far as the core has it: configuration providers (the core asks them when it
 * starts a session and when it creates a launch.json) and `startDebugging`/`stopDebugging` (the core's debug
 * service). The rest is still the null object of the time before the debugger: adapters and trackers (#1140) are
 * never asked, there are no session objects, breakpoints or events (#1141); the user gets one warn line in Output
 * per debug type an adapter is registered for. Without the namespace `golang.go` crashed midway through
 * `activate()` on `registerDebugConfigurationProvider`, and ~60 `go.*` commands never got registered.
 */

const OUTPUT_CHANNEL = "extensions";
const OUTPUT_LABEL = "Extensions";

export interface IDebugNamespaceDeps {
    readonly rpc: SubprocessRpc;
    readonly owner: ExtensionOwner;
    readonly workspaceFolders: () => readonly vscode.WorkspaceFolder[] | undefined;
}

interface IConfigProviderEntry {
    readonly type: string;
    readonly provider: vscode.DebugConfigurationProvider;
}

export function createDebugNamespace(deps: IDebugNamespaceDeps): typeof vscode.debug {
    const { rpc, owner } = deps;
    const reported = new Set<string>();
    const configProviders = new Map<number, IConfigProviderEntry>();
    let nextHandle = 0;

    // The output line is clipped to the panel width: the essential part first.
    function reportDebugType(debugType: string): void {
        if (reported.has(debugType)) return;
        reported.add(debugType);
        rpc.notify("output.append", {
            channel: OUTPUT_CHANNEL,
            label: OUTPUT_LABEL,
            level: "warn",
            value: `debugging "${debugType}" is not supported in TUI yet — no sessions, the rest of the extension works`,
        });
    }

    /** Upstream's `getFolder`: the workspace folder of the uri, `undefined` for none or an unknown one. */
    function folderOf(folder: string | undefined): vscode.WorkspaceFolder | undefined {
        if (folder === undefined) return undefined;
        return deps.workspaceFolders()?.find((candidate) => candidate.uri.toString() === folder);
    }

    function providerOf(handle: number): vscode.DebugConfigurationProvider {
        const entry = configProviders.get(handle);
        if (entry === undefined) throw new Error("no DebugConfigurationProvider found");
        return entry.provider;
    }

    function resolveResult(config: vscode.DebugConfiguration | null | undefined): IWireDebugResolveResult {
        return config === undefined ? {} : { config: config as WireDebugConfiguration | null };
    }

    rpc.handleRequest("debug.provideConfigurations", async (params, token) => {
        const provider = providerOf(params.handle);
        if (!provider.provideDebugConfigurations) {
            throw new Error("DebugConfigurationProvider has no method provideDebugConfigurations");
        }
        const provide = provider.provideDebugConfigurations.bind(provider);
        const configurations = await callWithVscodeToken(token, (vsToken) => provide(folderOf(params.folder), vsToken));
        if (!configurations) {
            throw new Error("nothing returned from DebugConfigurationProvider.provideDebugConfigurations");
        }
        return configurations as WireDebugConfiguration[];
    });

    rpc.handleRequest("debug.resolveConfiguration", async (params, token) => {
        const provider = providerOf(params.handle);
        if (!provider.resolveDebugConfiguration) {
            throw new Error("DebugConfigurationProvider has no method resolveDebugConfiguration");
        }
        const resolve = provider.resolveDebugConfiguration.bind(provider);
        return resolveResult(
            await callWithVscodeToken(token, (vsToken) =>
                resolve(folderOf(params.folder), params.config as vscode.DebugConfiguration, vsToken),
            ),
        );
    });

    rpc.handleRequest("debug.resolveConfigurationWithSubstitutedVariables", async (params, token) => {
        const provider = providerOf(params.handle);
        if (!provider.resolveDebugConfigurationWithSubstitutedVariables) {
            throw new Error(
                "DebugConfigurationProvider has no method resolveDebugConfigurationWithSubstitutedVariables",
            );
        }
        const resolve = provider.resolveDebugConfigurationWithSubstitutedVariables.bind(provider);
        return resolveResult(
            await callWithVscodeToken(token, (vsToken) =>
                resolve(folderOf(params.folder), params.config as vscode.DebugConfiguration, vsToken),
            ),
        );
    });

    function registerDebugConfigurationProvider(
        debugType: string,
        provider: vscode.DebugConfigurationProvider | undefined,
        triggerKind: vscode.DebugConfigurationProviderTriggerKind = DebugConfigurationProviderTriggerKind.Initial,
    ): vscode.Disposable {
        if (!provider) {
            return new DisposableImpl(() => undefined);
        }
        const handle = nextHandle++;
        configProviders.set(handle, { type: debugType, provider });
        rpc.notify("debug.registerConfigurationProvider", {
            handle,
            type: debugType,
            triggerKind: triggerKind as WireDebugTriggerKind,
            hasProvide: !!provider.provideDebugConfigurations,
            hasResolve: !!provider.resolveDebugConfiguration,
            hasResolveWithSubstitutedVariables: !!provider.resolveDebugConfigurationWithSubstitutedVariables,
            extensionId: owner.current ?? "",
        });
        return new DisposableImpl(() => {
            if (configProviders.delete(handle)) rpc.notify("debug.unregisterConfigurationProvider", { handle });
        });
    }

    async function startDebugging(
        folder: vscode.WorkspaceFolder | undefined,
        nameOrConfig: string | vscode.DebugConfiguration,
        parentSessionOrOptions?: vscode.DebugSession | vscode.DebugSessionOptions,
    ): Promise<boolean> {
        const options: vscode.DebugSessionOptions =
            parentSessionOrOptions === undefined || "configuration" in parentSessionOrOptions
                ? { parentSession: parentSessionOrOptions }
                : parentSessionOrOptions;
        const wireOptions: IWireDebugStartOptions = {
            parentSessionId: options.parentSession?.id,
            lifecycleManagedByParent: options.lifecycleManagedByParent,
            consoleMode: (options.consoleMode as number | undefined) === DebugConsoleMode.MergeWithParent ? 1 : 0,
            noDebug: options.noDebug,
            compact: options.compact,
            suppressSaveBeforeStart: options.suppressSaveBeforeStart,
            // Check debugUI for back-compat, #147264
            suppressDebugStatusbar:
                options.suppressDebugStatusbar ??
                (options as { readonly debugUI?: { readonly simple?: boolean } }).debugUI?.simple,
            suppressDebugToolbar:
                options.suppressDebugToolbar ??
                (options as { readonly debugUI?: { readonly simple?: boolean } }).debugUI?.simple,
            suppressDebugView:
                options.suppressDebugView ??
                (options as { readonly debugUI?: { readonly simple?: boolean } }).debugUI?.simple,
        };
        return await rpc.request("debug.startDebugging", {
            ...(folder === undefined ? {} : { folder: folder.uri.toString() }),
            nameOrConfig: nameOrConfig as string | WireDebugConfiguration,
            options: wireOptions,
        });
    }

    async function stopDebugging(session?: vscode.DebugSession): Promise<void> {
        await rpc.request("debug.stopDebugging", session === undefined ? {} : { sessionId: session.id });
    }

    const noopDisposable = (): vscode.Disposable => new DisposableImpl(() => undefined);

    return {
        activeDebugSession: undefined,
        activeDebugConsole: { append: (): void => undefined, appendLine: (): void => undefined },
        breakpoints: [],
        activeStackItem: undefined,
        onDidChangeActiveDebugSession: new EventEmitter<vscode.DebugSession | undefined>().event,
        onDidStartDebugSession: new EventEmitter<vscode.DebugSession>().event,
        onDidReceiveDebugSessionCustomEvent: new EventEmitter<vscode.DebugSessionCustomEvent>().event,
        onDidTerminateDebugSession: new EventEmitter<vscode.DebugSession>().event,
        onDidChangeBreakpoints: new EventEmitter<vscode.BreakpointsChangeEvent>().event,
        onDidChangeActiveStackItem: new EventEmitter<vscode.DebugThread | vscode.DebugStackFrame | undefined>().event,
        registerDebugConfigurationProvider,
        registerDebugAdapterDescriptorFactory: (debugType: string): vscode.Disposable => {
            reportDebugType(debugType);
            return noopDisposable();
        },
        // Trackers are also registered for other types (`*`); they say nothing about the extension's debugger.
        registerDebugAdapterTrackerFactory: noopDisposable,
        startDebugging,
        stopDebugging,
        addBreakpoints: (): void => undefined,
        removeBreakpoints: (): void => undefined,
        asDebugSourceUri,
    };
}

/** Like upstream's `ExtHostDebugServiceBase.asDebugSourceUri`. */
function asDebugSourceUri(source: vscode.DebugProtocolSource, session?: vscode.DebugSession): vscode.Uri {
    const { path, sourceReference } = source as { path?: unknown; sourceReference?: unknown };
    const pathText = typeof path === "string" ? path : "";
    if (typeof sourceReference === "number" && sourceReference > 0) {
        let debug = `debug:${encodeURIComponent(pathText)}`;
        let sep = "?";
        if (session !== undefined) {
            debug += `${sep}session=${encodeURIComponent(session.id)}`;
            sep = "&";
        }
        debug += `${sep}ref=${String(sourceReference)}`;
        return Uri.parse(debug);
    }
    if (pathText !== "") return Uri.file(pathText);
    throw new Error(
        "cannot create uri from DAP 'source' object; properties 'path' and 'sourceReference' are both missing.",
    );
}
