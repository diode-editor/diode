import type * as vscode from "vscode";

import { raceTimeout } from "../../../base/common/async.ts";
import { transformErrorForSerialization } from "../../../base/common/errorSerialization.ts";
import { Uri } from "../../../base/common/uri.ts";

import {
    definesDebugType,
    type IDebuggerExtension,
    mainDebugTypes,
    platformAdapterExecutable,
} from "./debugAdapterExecutable.ts";
import {
    DebugAdapterInlineImplementation,
    DebugAdapterServer,
    DebugConfigurationProviderTriggerKind,
    DebugConsoleMode,
} from "./debugTypes.ts";
import type {
    IWireDebugResolveResult,
    IWireDebugSession,
    IWireDebugStartOptions,
    WireDebugConfiguration,
    WireDebugTriggerKind,
} from "./debugWireTypes.ts";
import { DirectDebugAdapter, type ExtHostDebugAdapter, type ExtHostNodeDebugAdapters } from "./extHostDebugAdapter.ts";
import type { SubprocessRpc } from "./extHostProtocol.ts";
import { callWithVscodeToken } from "./vscodeCancellation.ts";
import type { ExtensionOwner } from "./vscodeHostContext.ts";
import { DisposableImpl, EventEmitter } from "./vscodeTypes.ts";

/**
 * Upstream's `ExtHostDebugService`, as far as the core has it: configuration providers (the core asks them when it
 * starts a session and when it creates a launch.json), `startDebugging`/`stopDebugging` (the core's debug service),
 * and the debug adapters, which live here as upstream's: the core asks for an adapter of a session
 * (`debug.startAdapter`), the type's descriptor factory (or the executable of `contributes.debuggers`) says which,
 * and the DAP messages go core ↔ subprocess ↔ adapter, past the trackers. Session objects for extensions are only
 * what a factory and a tracker get; the session list, events, breakpoints and the console are still a null object
 * (#1141). Without the namespace `golang.go` crashed midway through `activate()` on
 * `registerDebugConfigurationProvider`, and ~60 `go.*` commands never got registered. Deviations: no
 * `$substituteVariables` (the core's resolver knows the same variables), no path conversion of the messages (core
 * and subprocess share the file system: upstream's round trip path → uri → path is the identity here), the
 * `handshake` request is answered "no signer" (there is no signing service).
 */

export interface IDebugNamespaceDeps {
    readonly rpc: SubprocessRpc;
    readonly owner: ExtensionOwner;
    readonly workspaceFolders: () => readonly vscode.WorkspaceFolder[] | undefined;
    /** The extensions of the last catalog: their debuggers say which types and executables there are. */
    readonly extensions: {
        readonly all: readonly IDebuggerExtension[];
        getExtension(id: string): IDebuggerExtension | undefined;
    };
    readonly onDidReceiveCatalog: vscode.Event<readonly IDebuggerExtension[]>;
    /** The adapters that need the OS; without them only inline adapters are created. */
    readonly nodeAdapters?: ExtHostNodeDebugAdapters;
}

interface IAdapterEntry {
    readonly adapter: ExtHostDebugAdapter;
    readonly tracker: Required<vscode.DebugAdapterTracker> | undefined;
    readonly sessionId: string;
}

interface ITrackerFactoryEntry {
    readonly type: string;
    readonly factory: vscode.DebugAdapterTrackerFactory;
}

/** How long the core waits for the tracker factories, as upstream's. */
const TRACKER_FACTORY_TIMEOUT = 1000;

interface IConfigProviderEntry {
    readonly type: string;
    readonly provider: vscode.DebugConfigurationProvider;
}

export function createDebugNamespace(deps: IDebugNamespaceDeps): typeof vscode.debug {
    const { rpc, owner } = deps;
    const configProviders = new Map<number, IConfigProviderEntry>();
    let nextHandle = 0;
    const adapterFactories = new Map<string, vscode.DebugAdapterDescriptorFactory>();
    const trackerFactories = new Set<ITrackerFactoryEntry>();
    /** The sessions with a live adapter; one goes with its adapter's stop. */
    const sessions = new Map<string | undefined, vscode.DebugSession>();
    const adapters = new Map<number, IAdapterEntry>();

    deps.onDidReceiveCatalog((catalog) => {
        rpc.notify("debug.registerDebugTypes", { types: mainDebugTypes(catalog) });
    });

    /** Upstream's `getFolder`: the workspace folder of the uri, `undefined` for none or an unknown one. */
    function folderOf(folder: string | undefined): vscode.WorkspaceFolder | undefined {
        return deps.workspaceFolders()?.find((candidate) => candidate.uri.toString() === folder);
    }

    function providerOf(handle: number): vscode.DebugConfigurationProvider {
        const entry = configProviders.get(handle);
        if (entry === undefined) throw new Error("no DebugConfigurationProvider found");
        return entry.provider;
    }

    /** JSON drops an `undefined` value: `{}` on the wire, as `IWireDebugResolveResult` says. */
    function resolveResult(config: vscode.DebugConfiguration | null | undefined): IWireDebugResolveResult {
        return { config: config as WireDebugConfiguration | null | undefined };
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

    function registerDebugAdapterDescriptorFactory(
        debugType: string,
        factory: vscode.DebugAdapterDescriptorFactory | undefined,
    ): vscode.Disposable {
        if (!factory) {
            return new DisposableImpl(() => undefined);
        }
        // Upstream always knows the caller. Here a module the overlay did not map to its extension calls through the
        // shared namespace without an owner: such a caller cannot be checked, and it is not refused for that.
        const callerId = owner.current;
        if (callerId !== undefined && !definesDebugType(deps.extensions.getExtension(callerId), debugType)) {
            throw new Error(
                `a DebugAdapterDescriptorFactory can only be registered from the extension that defines the '${debugType}' debugger.`,
            );
        }
        if (adapterFactories.has(debugType)) {
            throw new Error("a DebugAdapterDescriptorFactory can only be registered once per a type.");
        }
        adapterFactories.set(debugType, factory);
        return new DisposableImpl(() => {
            if (adapterFactories.get(debugType) === factory) adapterFactories.delete(debugType);
        });
    }

    function registerDebugAdapterTrackerFactory(
        debugType: string,
        factory: vscode.DebugAdapterTrackerFactory | undefined,
    ): vscode.Disposable {
        // Stryker disable next-line ConditionalExpression,BlockStatement: equivalent, a kept undefined factory fails when asked, and a failing tracker factory is skipped
        if (!factory) {
            return new DisposableImpl(() => undefined);
        }
        const entry = { type: debugType, factory };
        trackerFactories.add(entry);
        return new DisposableImpl(() => {
            trackerFactories.delete(entry);
        });
    }

    /** Upstream `getSession`: one object per session id, the parent the one already known. */
    function sessionOf(dto: IWireDebugSession): vscode.DebugSession {
        let session = sessions.get(dto.id);
        if (session === undefined) {
            const parentSession = sessions.get(dto.parentId);
            session = Object.freeze<vscode.DebugSession>({
                id: dto.id,
                type: dto.type,
                name: dto.name,
                parentSession,
                workspaceFolder: folderOf(dto.folder),
                configuration: dto.configuration as vscode.DebugConfiguration,
                // The session's requests and breakpoints come with the session objects (#1141).
                customRequest: () => Promise.reject(new Error("DebugSession.customRequest is not supported yet")),
                getDebugProtocolBreakpoint: () => Promise.resolve(undefined),
            });
            sessions.set(dto.id, session);
        }
        return session;
    }

    /** Upstream `getAdapterDescriptor`: `debugServer` of the configuration, the type's factory, `package.json`. */
    async function adapterDescriptorOf(
        session: vscode.DebugSession,
    ): Promise<vscode.DebugAdapterDescriptor | undefined> {
        const serverPort: unknown = session.configuration.debugServer;
        if (typeof serverPort === "number") {
            return new DebugAdapterServer(serverPort);
        }
        const executable = platformAdapterExecutable(deps.extensions.all, session.type);
        const factory = adapterFactories.get(session.type);
        if (factory) {
            return (await factory.createDebugAdapterDescriptor(session, executable)) ?? undefined;
        }
        return executable;
    }

    /** Upstream `getDebugAdapterTrackers`: the type's and `*` factories; a failing one or a slow lot is skipped. */
    async function trackerOf(session: vscode.DebugSession): Promise<Required<vscode.DebugAdapterTracker> | undefined> {
        const created = [...trackerFactories]
            .filter((entry) => entry.type === session.type || entry.type === "*")
            .map(async (entry) => {
                const tracker = await Promise.resolve()
                    .then(() => entry.factory.createDebugAdapterTracker(session))
                    .catch(() => undefined);
                return tracker ?? undefined;
            });
        const all = Promise.all(created).then((results) =>
            multiTracker(results.filter((tracker) => tracker !== undefined)),
        );
        return raceTimeout(all, TRACKER_FACTORY_TIMEOUT);
    }

    function createAdapter(
        descriptor: vscode.DebugAdapterDescriptor,
        debugType: string,
    ): ExtHostDebugAdapter | undefined {
        if (descriptor instanceof DebugAdapterInlineImplementation) {
            return new DirectDebugAdapter(descriptor.implementation);
        }
        return deps.nodeAdapters?.(descriptor, debugType);
    }

    rpc.handleRequest("debug.startAdapter", async ({ handle, session: dto }) => {
        const session = sessionOf(dto);
        const descriptor = await adapterDescriptorOf(session);
        if (!descriptor) {
            throw new Error(
                `Couldn't find a debug adapter descriptor for debug type '${session.type}' (extension might have failed to activate)`,
            );
        }
        const adapter = createAdapter(descriptor, session.type);
        if (!adapter) {
            throw new Error(`Couldn't create a debug adapter for type '${session.type}'.`);
        }
        const tracker = await trackerOf(session);
        adapters.set(handle, { adapter, tracker, sessionId: session.id });
        adapter.onMessage((message) => {
            if (message.type === "request" && (message as DebugProtocol.Request).command === "handshake") {
                // Upstream signs the adapter's challenge; there is no signing service here.
                const response: DebugProtocol.Response = {
                    type: "response",
                    seq: 0,
                    command: "handshake",
                    request_seq: message.seq,
                    success: false,
                    message: "no signer",
                };
                adapter.sendMessage(response);
                return;
            }
            tracker?.onDidSendMessage(message);
            rpc.notify("debug.acceptAdapterMessage", { handle, message });
        });
        adapter.onError((error) => {
            tracker?.onError(error);
            rpc.notify("debug.acceptAdapterError", { handle, error: transformErrorForSerialization(error) });
        });
        adapter.onExit((code) => {
            tracker?.onExit(code ?? undefined, undefined);
            rpc.notify("debug.acceptAdapterExit", { handle, ...(code === null ? {} : { code }) });
        });
        tracker?.onWillStartSession();
        await adapter.startSession();
        return null;
    });

    rpc.handleNotification("debug.sendAdapterMessage", ({ handle, message }) => {
        const entry = adapters.get(handle);
        entry?.tracker?.onWillReceiveMessage(message);
        entry?.adapter.sendMessage(message as DebugProtocol.ProtocolMessage);
    });

    rpc.handleRequest("debug.stopAdapter", async ({ handle }) => {
        const entry = adapters.get(handle);
        if (entry) {
            adapters.delete(handle);
            sessions.delete(entry.sessionId);
            entry.tracker?.onWillStopSession();
            // Not disposed, as upstream: a process killed by the stop still reports its exit to the tracker.
            await entry.adapter.stopSession();
        }
        return null;
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
        registerDebugAdapterDescriptorFactory,
        registerDebugAdapterTrackerFactory,
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

/** Upstream `MultiTracker`: every tracker of the session sees every call; every method is there. */
function multiTracker(trackers: readonly vscode.DebugAdapterTracker[]): Required<vscode.DebugAdapterTracker> {
    return {
        onWillStartSession: () => {
            for (const t of trackers) t.onWillStartSession?.();
        },
        onWillReceiveMessage: (message: unknown) => {
            for (const t of trackers) t.onWillReceiveMessage?.(message);
        },
        onDidSendMessage: (message: unknown) => {
            for (const t of trackers) t.onDidSendMessage?.(message);
        },
        onWillStopSession: () => {
            for (const t of trackers) t.onWillStopSession?.();
        },
        onError: (error: Error) => {
            for (const t of trackers) t.onError?.(error);
        },
        onExit: (code: number | undefined, signal: string | undefined) => {
            for (const t of trackers) t.onExit?.(code, signal);
        },
    };
}
