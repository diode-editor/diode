import { DisposableMap, DisposableStore, type IDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import {
    type IWireDebugRegisterBreakpoints,
    type IWireDebugSession,
    type IWireDebugStartDebugging,
    type IWireDebugUnregisterBreakpoints,
    type WireDebugBreakpoint,
} from "../../../api/common/debugWireTypes.ts";
import type {
    IExtensionDebugAdapterConnection,
    IExtensionDebugAdapterHost,
    IExtensionDebugConfigurationProvider,
    IExtensionDebugEvents,
    IExtensionDebugSink,
} from "../../../api/common/iExtensionDebugSink.ts";
import { AbstractDebugAdapter } from "../common/abstractDebugAdapter.ts";
import type {
    IBreakpoint,
    IBreakpointContribution,
    IBreakpointData,
    IConfig,
    IDataBreakpoint,
    IDebugConfigurationProvider,
    IDebuggerContribution,
    IDebugService,
    IDebugSession,
    IDebugSessionOptions,
    IFunctionBreakpoint,
    IInstructionBreakpoint,
} from "../common/debug.ts";
import { isSessionAttach } from "../common/debugUtils.ts";

/**
 * Upstream `MainThreadDebugService` over the debug service: the providers of extensions join the configuration
 * manager, `startDebugging` and `stopDebugging` go to the service, the debug types of the subprocess get its adapters
 * (`ExtensionHostDebugAdapter`). Configurations cross the wire as JSON; the service checks them when it starts a
 * session.
 */
export class ExtensionDebugAdapter implements IExtensionDebugSink {
    public constructor(private readonly getDebugService: () => IDebugService) {}

    private get debugService(): IDebugService {
        return this.getDebugService();
    }

    /** Upstream `MainThreadDebugService`'s constructor: the session events, the focus and the breakpoints. */
    public subscribe(events: IExtensionDebugEvents): IDisposable {
        const store = new DisposableStore();
        const debugService = this.debugService;
        const sessionListeners = store.add(new DisposableMap<IDebugSession, DisposableStore>());
        // A custom event can come while the session initializes: listened to from before its launch. Upstream adds
        // the name's listener at each `onDidNewSession`, and a restarted session told its new name twice: here both
        // are added once, before the launch.
        store.add(
            debugService.onWillNewSession((session) => {
                const listeners = new DisposableStore();
                sessionListeners.set(session, listeners);
                listeners.add(
                    session.onDidCustomEvent((event) => {
                        events.sessionCustomEvent(sessionDto(session), event.event, event.body);
                    }),
                );
                listeners.add(
                    session.onDidChangeName((name) => {
                        events.sessionNameChanged(sessionDto(session), name);
                    }),
                );
            }),
        );
        store.add(
            debugService.onDidNewSession((session) => {
                events.sessionStarted(sessionDto(session));
            }),
        );
        store.add(
            debugService.onDidEndSession(({ session, restart }) => {
                events.sessionTerminated(sessionDto(session));
                // A restarted session keeps its listeners: its events go on after the restart.
                if (!restart) sessionListeners.deleteAndDispose(session);
            }),
        );
        const viewModel = debugService.getViewModel();
        store.add(
            viewModel.onDidFocusSession((session) => {
                events.activeSessionChanged(session && sessionDto(session));
            }),
        );
        const focusChanged = (): void => {
            const stackFrame = viewModel.focusedStackFrame;
            const thread = stackFrame?.thread ?? viewModel.focusedThread;
            events.stackFocusChanged(
                thread && {
                    session: sessionDto(thread.session),
                    threadId: thread.threadId,
                    ...(stackFrame ? { frameId: stackFrame.frameId } : {}),
                },
            );
        };
        store.add(viewModel.onDidFocusStackFrame(focusChanged));
        store.add(viewModel.onDidFocusThread(focusChanged));

        const model = debugService.getModel();
        store.add(
            model.onDidChangeBreakpoints((e) => {
                // Session-only changes are the adapter's answers: they are for the views alone.
                if (!e || e.sessionOnly) return;
                events.breakpointsChanged({
                    added: breakpointDtos(e.added ?? []),
                    removed: (e.removed ?? []).map((bp) => bp.getId()),
                    changed: breakpointDtos(e.changed ?? []),
                });
            }),
        );
        const existing = breakpointDtos([...model.getBreakpoints(), ...model.getFunctionBreakpoints()]);
        if (existing.length > 0) events.breakpointsChanged({ added: existing, removed: [], changed: [] });
        return store;
    }

    /** Upstream `$customDebugAdapterRequest`. */
    public async customRequest(sessionId: string, command: string, args: unknown): Promise<unknown> {
        const session = this.debugService.getModel().getSession(sessionId, true);
        if (!session) throw new Error("debug session not found");
        // A failed response rejects in the session already (with the adapter's message); none is a request the
        // adapter never answered (upstream's `response ? response.message : …` has no other case here).
        const response = await session.customRequest(command, args);
        if (!response) throw new Error("custom request failed");
        return response.body;
    }

    /** Upstream `$getDebugProtocolBreakpoint`. */
    public getDebugProtocolBreakpoint(sessionId: string, breakpointId: string): Promise<object | undefined> {
        const session = this.debugService.getModel().getSession(sessionId, true);
        if (!session) return Promise.reject(new Error("debug session not found"));
        return Promise.resolve(session.getDebugProtocolBreakpoint(breakpointId));
    }

    /** Upstream `$setDebugSessionName`. */
    public setSessionName(sessionId: string, name: string): void {
        this.debugService.getModel().getSession(sessionId)?.setName(name);
    }

    /** Upstream `$appendDebugConsole`: a warning, the color upstream gives what a debug extension says. */
    public appendDebugConsole(value: string): void {
        this.debugService.getViewModel().focusedSession?.appendToRepl({ output: value, sev: "warning" });
    }

    /** Upstream `$registerBreakpoints`: lines and characters become the model's 1-based ones. */
    public registerBreakpoints({ breakpoints }: IWireDebugRegisterBreakpoints): void {
        for (const dto of breakpoints) {
            if (dto.type === "sourceMulti") {
                const raw = dto.lines.map(
                    (l): IBreakpointData => ({
                        id: l.id,
                        enabled: l.enabled,
                        lineNumber: l.line + 1,
                        // A column of 0 is no column (upstream #46784).
                        column: l.character > 0 ? l.character + 1 : undefined,
                        condition: l.condition,
                        hitCondition: l.hitCondition,
                        logMessage: l.logMessage,
                        mode: l.mode,
                    }),
                );
                void this.debugService.addBreakpoints(Uri.parse(dto.uri), raw);
            } else {
                void this.debugService.addFunctionBreakpoint(
                    {
                        name: dto.functionName,
                        mode: dto.mode,
                        condition: dto.condition,
                        hitCondition: dto.hitCondition,
                        enabled: dto.enabled,
                        logMessage: dto.logMessage,
                    },
                    dto.id,
                );
            }
        }
    }

    /** Upstream `$unregisterBreakpoints`. */
    public unregisterBreakpoints({ breakpointIds, functionBreakpointIds }: IWireDebugUnregisterBreakpoints): void {
        // All at once: one store and one `setBreakpoints` per file (upstream removes them one by one).
        void this.debugService.removeBreakpoints([...breakpointIds]);
        for (const id of functionBreakpointIds) void this.debugService.removeFunctionBreakpoints(id);
    }

    public registerConfigurationProvider(
        _extensionId: string,
        provider: IExtensionDebugConfigurationProvider,
    ): IDisposable {
        const folder = (uri: Uri | undefined): string | undefined => uri?.toString();
        const core: IDebugConfigurationProvider = { type: provider.type, triggerKind: provider.triggerKind };
        const provide = provider.provideDebugConfigurations?.bind(provider);
        const resolve = provider.resolveDebugConfiguration?.bind(provider);
        const resolve2 = provider.resolveDebugConfigurationWithSubstitutedVariables?.bind(provider);
        if (provide) {
            core.provideDebugConfigurations = async (folderUri, token) =>
                (await provide(folder(folderUri), token)) as IConfig[];
        }
        if (resolve) {
            core.resolveDebugConfiguration = async (folderUri, config, token) =>
                (await resolve(folder(folderUri), config, token)) as IConfig | null | undefined;
        }
        if (resolve2) {
            core.resolveDebugConfigurationWithSubstitutedVariables = async (folderUri, config, token) =>
                (await resolve2(folder(folderUri), config, token)) as IConfig | null | undefined;
        }
        return this.debugService.getConfigurationManager().registerDebugConfigurationProvider(core);
    }

    /**
     * Upstream `$registerDebugTypes`: the adapter of a session of these types is one in the subprocess. Variables are
     * substituted by the core's resolver alone (no `$substituteVariables`, see `debugNamespace.ts`).
     */
    public registerDebugTypes(types: readonly string[], host: IExtensionDebugAdapterHost): IDisposable {
        return this.debugService.getAdapterManager().registerDebugAdapterFactory([...types], {
            createDebugAdapter: (session) => new ExtensionHostDebugAdapter(host, session),
            substituteVariables: (_folder, config) => Promise.resolve(config),
        });
    }

    /** Upstream `$startDebugging`. */
    public startDebugging({ folder, nameOrConfig, options }: IWireDebugStartDebugging): Promise<boolean> {
        const launch = this.debugService.getConfigurationManager().getLaunch(folder ? Uri.parse(folder) : undefined);
        const parentSession = this.debugService.getModel().getSession(options.parentSessionId);
        const saveBeforeStart =
            typeof options.suppressSaveBeforeStart === "boolean" ? !options.suppressSaveBeforeStart : undefined;
        const debugOptions: IDebugSessionOptions = {
            noDebug: options.noDebug,
            parentSession,
            lifecycleManagedByParent: options.lifecycleManagedByParent,
            repl: options.consoleMode === 1 ? "mergeWithParent" : "separate",
            compact: options.compact,
            saveBeforeRestart: saveBeforeStart,
            suppressDebugStatusbar: options.suppressDebugStatusbar,
            suppressDebugToolbar: options.suppressDebugToolbar,
            suppressDebugView: options.suppressDebugView,
            testRun: options.testRun,
        };
        return this.debugService.startDebugging(
            launch,
            nameOrConfig as string | IConfig,
            debugOptions,
            saveBeforeStart,
        );
    }

    /** Upstream `$stopDebugging`. */
    public stopDebugging(sessionId: string | undefined): Promise<void> {
        if (sessionId === undefined) {
            return this.debugService.stopSession(undefined);
        }
        const session = this.debugService.getModel().getSession(sessionId, true);
        if (session) {
            return this.debugService.stopSession(session, isSessionAttach(session));
        }
        return Promise.reject(new Error("debug session not found"));
    }
}

/** Upstream `getSessionDto`: what the subprocess needs of a session (always whole: there is no `$sessionCached`). */
function sessionDto(session: IDebugSession): IWireDebugSession {
    const folder = session.root?.uri.toString();
    const parentId = session.parentSession?.getId();
    return {
        id: session.getId(),
        type: session.configuration.type,
        name: session.name,
        ...(folder === undefined ? {} : { folder }),
        configuration: session.configuration,
        ...(parentId === undefined ? {} : { parentId }),
    };
}

type ModelBreakpoint = IBreakpoint | IFunctionBreakpoint | IDataBreakpoint | IInstructionBreakpoint;

/**
 * Upstream `convertToDto`: source and function breakpoints, lines and characters 0-based. Data breakpoints are left
 * out (milestone 2): `vscode.DataBreakpoint` is not declared yet; instruction breakpoints upstream leaves out too.
 */
function breakpointDtos(bps: readonly ModelBreakpoint[]): WireDebugBreakpoint[] {
    const dtos: WireDebugBreakpoint[] = [];
    for (const bp of bps) {
        const { enabled, condition, hitCondition, logMessage, mode } = bp;
        const common = { id: bp.getId(), enabled, condition, hitCondition, logMessage, mode };
        if ("name" in bp) {
            dtos.push({ type: "function", ...common, functionName: bp.name });
        } else if ("uri" in bp) {
            dtos.push({
                type: "source",
                ...common,
                uri: bp.uri.toString(),
                // The model's lines are 1-based from 1 (upstream guards a 0 that the model never has).
                line: bp.lineNumber - 1,
                // No column (a breakpoint of a whole line) is character 0, as upstream.
                character: (bp.column ?? 1) - 1,
            });
        }
    }
    return dtos;
}

/** Upstream `ExtensionHostDebugAdapter`: a debug adapter in the subprocess, its DAP messages over the wire. */
export class ExtensionHostDebugAdapter extends AbstractDebugAdapter {
    private readonly connection: IExtensionDebugAdapterConnection;

    public constructor(host: IExtensionDebugAdapterHost, session: IDebugSession) {
        super();
        this.connection = host.createAdapter(sessionDto(session), {
            onMessage: (message) => {
                this.acceptMessage(message);
            },
            onError: (error) => {
                this.onErrorEmitter.fire(error);
            },
            onExit: (code) => {
                this.onExitEmitter.fire(code ?? null);
            },
        });
    }

    public startSession(): Promise<void> {
        return this.connection.start();
    }

    public sendMessage(message: DebugProtocol.ProtocolMessage): void {
        this.connection.send(message);
    }

    public async stopSession(): Promise<void> {
        await this.cancelPendingRequests();
        await this.connection.stop();
    }
}

/**
 * Upstream's `debuggers` extension point: the `contributes.debuggers` of every extension become debug types (a
 * contribution without a string `type` is a warning, as upstream's `debugNoType`). Static contributions of the
 * manifests: no activation. The `contributes.breakpoints` entries (upstream's `breakpoints` extension point) go to
 * `canSetBreakpointsIn`.
 */
export function bindExtensionDebuggers(
    debugService: IDebugService,
    extensions: readonly IExtension[],
    logger: ILogger,
): IDisposable {
    const store = new DisposableStore();
    const adapterManager = debugService.getAdapterManager();
    for (const extension of extensions) {
        const debuggers = extension.manifest.contributes?.debuggers;
        if (debuggers === undefined) continue;
        if (!Array.isArray(debuggers)) {
            logger.warn(`${extension.id}: 'contributes.debuggers' must be an array.`);
            continue;
        }
        for (const contribution of debuggers as readonly unknown[]) {
            const type = (contribution as { readonly type?: unknown } | null)?.type;
            if (typeof type !== "string" || type === "") {
                logger.warn(`${extension.id}: Debugger 'type' can not be omitted and must be of type 'string'.`);
                continue;
            }
            store.add(adapterManager.registerDebugger(contribution as IDebuggerContribution));
        }
    }
    for (const extension of extensions) {
        const breakpoints = extension.manifest.contributes?.breakpoints;
        if (!Array.isArray(breakpoints)) continue;
        for (const contribution of breakpoints as readonly unknown[]) {
            // The schema's check: an entry without a string `language` allows breakpoints nowhere.
            if (typeof (contribution as { readonly language?: unknown } | null)?.language !== "string") continue;
            store.add(adapterManager.registerBreakpoints(contribution as IBreakpointContribution));
        }
    }
    return store;
}
