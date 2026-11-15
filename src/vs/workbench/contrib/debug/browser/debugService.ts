/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/debugService.ts
// `startDebugging` follows upstream's sequence: `onDebug` activation, resolution by the providers, variable
// substitution, the pre-launch task, resolution with substituted variables, then the session. Its steps that belong
// to later tasks are the identity here, each named at its place: providers (#1139), launch.json, its selected
// configuration, compounds and the debug tasks (#1138), choosing a debugger for a configuration without a type
// (#1156). Not here yet: breakpoint and watch editing (views, gutter: #1144–#1148), opening the views and the
// console on a session (`debug.openDebug`, `debug.internalConsoleOptions`, `debug.console.closeOnEnd`,
// `debug.openExplorerOnEnd`), saving before a start (`debug.saveBeforeStart`), opening the focused frame in the
// editor (#1148), the activity badge of the view container (#1144). Errors show as a modal notification, without
// the "Open launch.json" button. Not planned: workspace trust (diode has none), telemetry, extension host
// debugging, the memory and disassembly views.

import { distinct } from "../../../../base/common/arrays.ts";
import { RunOnceScheduler } from "../../../../base/common/async.ts";
import { CancellationTokenSource } from "../../../../base/common/cancellation.ts";
import { isCancellationError } from "../../../../base/common/errorSerialization.ts";
import { Emitter, type Event } from "../../../../base/common/event.ts";
import { DisposableStore } from "../../../../base/common/lifecycle.ts";
import type { Uri as uri } from "../../../../base/common/uri.ts";
import { generateUuid } from "../../../../base/common/uuid.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { IStateService } from "../../../../platform/state/common/iStateService.ts";
import type {
    IWorkspaceContextService,
    IWorkspaceFolder,
} from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import type { IExtensionService } from "../../../services/extensions/common/extensions.ts";
import type { NotificationService } from "../../../services/notification/browser/notificationService.ts";
import {
    getStateLabel,
    type IConfig,
    type IDebugModel,
    type IDebugService,
    type IDebugSession,
    type IDebugSessionOptions,
    type ILaunch,
    type IStackFrame,
    type IThread,
    type IViewModel,
    type ReplSeverity,
    State,
} from "../common/debug.ts";
import { DebugModel, type ITextFileDirtyState } from "../common/debugModel.ts";
import { DebugStorage } from "../common/debugStorage.ts";
import { ViewModel } from "../common/debugViewModel.ts";
import type { IReplConsoleConfiguration } from "../common/replModel.ts";

import { AdapterManager } from "./debugAdapterManager.ts";
import { DebugSession, type IDebugSessionServices } from "./debugSession.ts";

export const DebugServiceDIToken = token<DebugService>("DebugService");

/** What the debug service talks to; the DI module builds it from the workbench services. */
export interface IDebugServicePorts {
    readonly contextKeys: Pick<ContextKeyService, "set" | "get" | "reset" | "evaluate">;
    readonly state: Pick<IStateService, "get" | "store" | "remove" | "onDidOpenWorkspace">;
    readonly textFiles: ITextFileDirtyState;
    readonly logger: ILogger;
    readonly notifications: Pick<NotificationService, "show">;
    readonly extensions: Pick<IExtensionService, "activateByEvent" | "whenInstalledExtensionsRegistered">;
    readonly workspace: Pick<IWorkspaceContextService, "getWorkspace">;
    readonly replConfiguration: () => IReplConsoleConfiguration;
}
export const DebugServicePortsDIToken = token<IDebugServicePorts>("DebugServicePorts");

/** Activation of the debug extensions (`onDebug`); without an extension host, as in the test profile, there are none. */
export type IDebugExtensionActivator = IDebugServicePorts["extensions"];
export const DebugExtensionActivatorDIToken = token<IDebugExtensionActivator>("DebugExtensionActivator");
export const NO_DEBUG_EXTENSIONS: IDebugExtensionActivator = {
    activateByEvent: () => Promise.resolve(),
    whenInstalledExtensionsRegistered: () => Promise.resolve(),
};

/** Upstream's delay before a restarted session that has no `restart` request is launched again. */
const RESTART_DELAY_MS = 300;

export class DebugService implements IDebugService {
    public static dependencies = [DebugServicePortsDIToken] as const;

    private readonly disposables = new DisposableStore();
    private readonly onDidChangeStateEmitter = this.disposables.add(new Emitter<State>());
    private readonly onDidNewSessionEmitter = this.disposables.add(new Emitter<IDebugSession>());
    private readonly onWillNewSessionEmitter = this.disposables.add(new Emitter<IDebugSession>());
    private readonly onDidEndSessionEmitter = this.disposables.add(
        new Emitter<{ session: IDebugSession; restart: boolean }>(),
    );
    private readonly restartingSessions = new Set<IDebugSession>();
    private readonly debugStorage: DebugStorage;
    private readonly model: DebugModel;
    private readonly viewModel: ViewModel;
    private readonly adapterManager: AdapterManager;
    private initializing = false;
    private initializingOptionsValue: IDebugSessionOptions | undefined;
    private previousState: State | undefined;
    private readonly sessionCancellationTokens = new Map<string, CancellationTokenSource>();
    private readonly sessionServices: IDebugSessionServices;

    public constructor(private readonly ports: IDebugServicePorts) {
        const contextKeys = ports.contextKeys;
        this.adapterManager = this.disposables.add(new AdapterManager(() => this, contextKeys));
        this.debugStorage = this.disposables.add(new DebugStorage(ports.state, ports.textFiles, ports.logger));
        this.model = this.disposables.add(new DebugModel(this.debugStorage, ports.textFiles, ports.logger));
        this.viewModel = this.disposables.add(new ViewModel(contextKeys));
        this.sessionServices = {
            notifier: {
                error: (message) => {
                    this.notify("error", message);
                },
                notify: (message, severity, source) => {
                    this.notify(severity, `${source}: ${message}`);
                },
            },
            logger: ports.logger,
            replConfiguration: ports.replConfiguration,
        };

        this.disposables.add(
            this.viewModel.onDidFocusStackFrame(() => {
                this.onStateChange();
            }),
        );
        this.disposables.add(
            this.viewModel.onDidFocusSession((session) => {
                this.onStateChange();

                if (session) {
                    this.model.setExceptionBreakpointFallbackSession(session.getId());
                    this.debugStorage.storeBreakpoints(this.model);
                }
            }),
        );
        this.disposables.add(
            this.adapterManager.onDidRegisterDebugger(() => {
                // Upstream also counts the launch configurations; there are none before launch.json (#1138).
                this.setDebugUx(this.state !== State.Inactive ? "default" : "simple");
            }),
        );

        contextKeys.set("debugState", getStateLabel(State.Inactive));
        contextKeys.set("inDebugMode", false);
        contextKeys.set("hasDebugged", false);
        contextKeys.set("debugUx", this.debugStorage.loadDebugUxState());
        const setBreakpointsExistContext = (): void => {
            contextKeys.set(
                "breakpointsExist",
                !!(
                    this.model.getBreakpoints().length ||
                    this.model.getDataBreakpoints().length ||
                    this.model.getFunctionBreakpoints().length
                ),
            );
        };
        setBreakpointsExistContext();
        this.disposables.add(this.model.onDidChangeBreakpoints(setBreakpointsExistContext));
    }

    private notify(severity: ReplSeverity | "warn", message: string): void {
        const kind = severity === "error" ? "error" : severity === "warning" || severity === "warn" ? "warn" : "info";
        this.ports.notifications.show({ severity: kind, message, modal: false, items: [] });
    }

    public getModel(): IDebugModel {
        return this.model;
    }

    public getViewModel(): IViewModel {
        return this.viewModel;
    }

    public getAdapterManager(): AdapterManager {
        return this.adapterManager;
    }

    public dispose(): void {
        this.disposables.dispose();
    }

    //---- state management

    public get state(): State {
        const focusedSession = this.viewModel.focusedSession;
        if (focusedSession) {
            return focusedSession.state;
        }

        return this.initializing ? State.Initializing : State.Inactive;
    }

    public get initializingOptions(): IDebugSessionOptions | undefined {
        return this.initializingOptionsValue;
    }

    private startInitializingState(options?: IDebugSessionOptions): void {
        if (!this.initializing) {
            this.initializing = true;
            this.initializingOptionsValue = options;
            this.onStateChange();
        }
    }

    private endInitializingState(): void {
        if (this.initializing) {
            this.initializing = false;
            this.initializingOptionsValue = undefined;
            this.onStateChange();
        }
    }

    private cancelTokens(id: string | undefined): void {
        if (id) {
            const cancellation = this.sessionCancellationTokens.get(id);
            if (cancellation) {
                cancellation.cancel();
                this.sessionCancellationTokens.delete(id);
            }
        } else {
            this.sessionCancellationTokens.forEach((t) => {
                t.cancel();
            });
            this.sessionCancellationTokens.clear();
        }
    }

    private setDebugUx(value: "simple" | "default"): void {
        this.ports.contextKeys.set("debugUx", value);
        this.debugStorage.storeDebugUxState(value);
    }

    private onStateChange(): void {
        const state = this.state;
        if (this.previousState !== state) {
            this.ports.contextKeys.set("debugState", getStateLabel(state));
            this.ports.contextKeys.set("inDebugMode", state !== State.Inactive);
            // Only show the simple ux if debug is not yet started and if no launch.json exists
            this.setDebugUx(state !== State.Inactive && state !== State.Initializing ? "default" : "simple");
            this.previousState = state;
            this.onDidChangeStateEmitter.fire(state);
        }
    }

    public get onDidChangeState(): Event<State> {
        return this.onDidChangeStateEmitter.event;
    }

    public get onDidNewSession(): Event<IDebugSession> {
        return this.onDidNewSessionEmitter.event;
    }

    public get onWillNewSession(): Event<IDebugSession> {
        return this.onWillNewSessionEmitter.event;
    }

    public get onDidEndSession(): Event<{ session: IDebugSession; restart: boolean }> {
        return this.onDidEndSessionEmitter.event;
    }

    //---- life cycle management

    /**
     * main entry point
     * properly manages compounds, checks for errors and handles the initializing state.
     */
    public async startDebugging(
        launch: ILaunch | undefined,
        configOrName?: IConfig | string,
        options?: IDebugSessionOptions,
    ): Promise<boolean> {
        this.startInitializingState(options);
        this.ports.contextKeys.set("hasDebugged", true);
        try {
            // make sure the configuration is up to date
            await this.ports.extensions.activateByEvent("onDebug");
            await this.ports.extensions.whenInstalledExtensionsRegistered();
            let config: IConfig | undefined;
            if (typeof configOrName === "string") {
                // A name without launch.json is upstream's "'launch.json' does not exist" below.
                config = launch?.getConfiguration(configOrName);
            } else {
                config = configOrName;
            }

            if (configOrName && !config) {
                const message = launch
                    ? `Configuration '${configOrName as string}' is missing in 'launch.json'.`
                    : "'launch.json' does not exist for passed workspace folder.";
                throw new Error(message);
            }

            const result = await this.createSession(launch, config, options);
            this.endInitializingState();
            return result;
        } catch (err) {
            // make sure to get out of initializing state, and propagate the result
            this.notify("error", (err as Error).message);
            this.endInitializingState();
            throw err;
        }
    }

    /**
     * gets the debugger for the type, resolves configurations by providers, substitutes variables and runs prelaunch tasks
     */
    private async createSession(
        launch: ILaunch | undefined,
        configOrUndefined: IConfig | undefined,
        options?: IDebugSessionOptions,
    ): Promise<boolean> {
        // We keep the debug type in a separate variable 'type' so that a no-folder config has no attributes.
        // Storing the type in the config would break extensions that assume that the no-folder case is indicated by an empty config.
        // A configuration without a type would be completed by the debugger the user picks (#1156); it does not start.
        const config: IConfig = configOrUndefined ?? (Object.create(null) as IConfig);

        if (options?.noDebug) {
            config.noDebug = true;
        } else if (options?.noDebug === undefined && options?.parentSession?.configuration.noDebug) {
            config.noDebug = true;
        }
        const unresolvedConfig = structuredClone(config);

        const initCancellationToken = new CancellationTokenSource();
        const sessionId = generateUuid();
        this.sessionCancellationTokens.set(sessionId, initCancellationToken);

        // Resolution by the configuration providers of extensions (#1139): the configuration as is.
        const configByProviders = config;
        // a falsy config indicates an aborted launch
        if (!configByProviders.type) {
            return false;
        }

        try {
            const resolvedConfig = await this.substituteVariables(launch, configByProviders);
            if (!resolvedConfig) {
                // User cancelled resolving of interactive variables, silently return
                return false;
            }

            if (initCancellationToken.token.isCancellationRequested) {
                // User cancelled, silently return
                return false;
            }

            // Check for concurrent sessions before running preLaunchTask to avoid running the task if user cancels
            let userConfirmedConcurrentSession = false;
            if (options?.startedByUser && resolvedConfig.suppressMultipleSessionWarning !== true) {
                // Check if there's already a session with the same launch configuration
                const existingSession = this.findSameSession(resolvedConfig, launch?.workspace);
                if (existingSession) {
                    // There is already a session with the same configuration, prompt user before running preLaunchTask
                    if (!(await this.confirmConcurrentSession(existingSession.getLabel()))) {
                        return false;
                    }
                    userConfirmedConcurrentSession = true;
                }
            }

            // The pre-launch task (#1138) and the resolution with substituted variables (#1139) come here.

            const dbg = this.adapterManager.getDebugger(resolvedConfig.type);
            if (!dbg || (configByProviders.request !== "attach" && configByProviders.request !== "launch")) {
                let message: string;
                if (configByProviders.request !== "attach" && configByProviders.request !== "launch") {
                    message = configByProviders.request
                        ? `Attribute 'request' has an unsupported value '${configByProviders.request}' in the chosen debug configuration.`
                        : "Attribute 'request' is missing from the chosen debug configuration.";
                } else {
                    message = `Configured debug type '${resolvedConfig.type}' is not supported.`;
                }

                this.showError(message);
                return false;
            }

            if (!dbg.enabled) {
                this.showError(
                    `Configured debug type '${dbg.type}' is installed but not supported in this environment.`,
                );
                return false;
            }

            return await this.doCreateSession(
                sessionId,
                launch?.workspace,
                { resolved: resolvedConfig, unresolved: unresolvedConfig },
                options,
                userConfirmedConcurrentSession,
            );
        } catch (err) {
            this.showError((err as Error).message);
            return false;
        }
    }

    private findSameSession(config: IConfig, root: IWorkspaceFolder | undefined): IDebugSession | undefined {
        return this.model
            .getSessions()
            .find(
                (s) =>
                    s.configuration.name === config.name &&
                    s.configuration.type === config.type &&
                    s.configuration.request === config.request &&
                    s.root === root,
            );
    }

    /**
     * instantiates the new session, initializes the session, registers session listeners and reports telemetry
     */
    private async doCreateSession(
        sessionId: string,
        root: IWorkspaceFolder | undefined,
        configuration: { resolved: IConfig; unresolved: IConfig | undefined },
        options: IDebugSessionOptions | undefined,
        userConfirmedConcurrentSession: boolean,
    ): Promise<boolean> {
        const session = new DebugSession(
            sessionId,
            configuration,
            root,
            this.model,
            options,
            this,
            this.sessionServices,
        );
        if (
            !userConfirmedConcurrentSession &&
            options?.startedByUser &&
            configuration.resolved.suppressMultipleSessionWarning !== true &&
            this.findSameSession(configuration.resolved, root)
        ) {
            // There is already a session with the same configuration, prompt user #127721
            if (!(await this.confirmConcurrentSession(session.getLabel()))) {
                return false;
            }
        }

        this.model.addSession(session);
        // since the Session is now properly registered under its ID and hooked, we can announce it
        // this event doesn't go to extensions
        this.onWillNewSessionEmitter.fire(session);

        try {
            await this.launchOrAttachToSession(session);

            // `debug.showSubSessionsInToolBar` (#1147) is off: only the root sessions count.
            if (this.model.getSessions().filter((s) => !s.parentSession).length > 1) {
                this.viewModel.setMultiSessionView(true);
            }

            // since the initialized response has arrived announce the new Session (including extensions)
            this.onDidNewSessionEmitter.fire(session);

            return true;
        } catch (error) {
            if (isCancellationError(error)) {
                // don't show 'canceled' error messages to the user #7906
                return false;
            }

            if (session.configuration.request === "attach" && session.configuration.__autoAttach) {
                // ignore attach timeouts in auto attach mode
                return false;
            }

            if ((error as { showUser?: boolean }).showUser !== false) {
                // Only show the error when showUser is either not defined, or is true #128484
                this.showError((error as Error).message);
            }
            return false;
        }
    }

    private async confirmConcurrentSession(sessionLabel: string): Promise<boolean> {
        const answer = await this.ports.notifications.show({
            severity: "info",
            message: `'${sessionLabel}' is already running. Do you want to start another instance?`,
            modal: true,
            items: ["Yes"],
        }).answered;
        return answer === 0;
    }

    private async launchOrAttachToSession(session: IDebugSession, forceFocus = false): Promise<void> {
        // register listeners as the very first thing!
        this.registerSessionListeners(session);

        const dbgr = this.adapterManager.getDebugger(session.configuration.type);
        try {
            // The debugger was there when the session was created; a session restarts with its own type.
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            await session.initialize(dbgr!);
            await session.launchOrAttach(session.configuration);
            if (
                forceFocus ||
                !this.viewModel.focusedSession ||
                (session.parentSession === this.viewModel.focusedSession && session.compact)
            ) {
                await this.focusStackFrame(undefined, undefined, session);
            }
        } catch (err) {
            if (this.viewModel.focusedSession === session) {
                await this.focusStackFrame(undefined);
            }
            throw err;
        }
    }

    private registerSessionListeners(session: IDebugSession): void {
        const listenerDisposables = new DisposableStore();
        this.disposables.add(listenerDisposables);

        const sessionRunningScheduler = listenerDisposables.add(
            new RunOnceScheduler(() => {
                // Do not immediatly defocus the stack frame if the session is running
                if (session.state === State.Running && this.viewModel.focusedSession === session) {
                    this.viewModel.setFocus(undefined, this.viewModel.focusedThread, session, false);
                }
            }, 200),
        );
        listenerDisposables.add(
            session.onDidChangeState(() => {
                if (session.state === State.Running && this.viewModel.focusedSession === session) {
                    sessionRunningScheduler.schedule();
                }
                if (session === this.viewModel.focusedSession) {
                    this.onStateChange();
                }
            }),
        );
        listenerDisposables.add(
            this.onDidEndSession((e) => {
                if (e.session === session) {
                    this.disposables.delete(listenerDisposables);
                }
            }),
        );
        listenerDisposables.add(
            session.onDidEndAdapter((adapterExitEvent) => {
                const error = adapterExitEvent?.error;
                if (error) {
                    this.notify("error", `Debug adapter process has terminated unexpectedly (${error.message})`);
                }

                this.endInitializingState();
                this.cancelTokens(session.getId());

                this.onDidEndSessionEmitter.fire({ session, restart: this.restartingSessions.has(session) });

                const focusedSession = this.viewModel.focusedSession;
                if (focusedSession?.getId() === session.getId()) {
                    const focus = getStackFrameThreadAndSessionToFocus(
                        this.model,
                        undefined,
                        undefined,
                        undefined,
                        focusedSession,
                    );
                    this.viewModel.setFocus(focus.stackFrame, focus.thread, focus.session, false);
                }

                if (this.model.getSessions().length === 0) {
                    this.viewModel.setMultiSessionView(false);

                    // Data breakpoints that can not be persisted should be cleared when a session ends
                    const dataBreakpoints = this.model.getDataBreakpoints().filter((dbp) => !dbp.canPersist);
                    dataBreakpoints.forEach((dbp) => {
                        this.model.removeDataBreakpoints(dbp.getId());
                    });
                }

                this.model.removeExceptionBreakpointsForSession(session.getId());
            }),
        );
    }

    public async restartSession(session: IDebugSession, restartData?: unknown): Promise<void> {
        // The restart tasks (`preRestartTask`, `postDebugTask`, `preLaunchTask`, `postRestartTask`) and reading
        // launch.json anew come with launch.json (#1138): the session restarts with its own configuration.
        session.configuration.__restart = restartData;

        const doRestart = async (fn: () => Promise<boolean>): Promise<void> => {
            this.restartingSessions.add(session);
            let didRestart = false;
            try {
                didRestart = await fn();
            } finally {
                this.restartingSessions.delete(session);
                // we previously may have issued an onDidEndSession with restart: true,
                // assuming the adapter exited (in `registerSessionListeners`). But the
                // restart failed, so emit the final termination now.
                if (!didRestart) {
                    this.onDidEndSessionEmitter.fire({ session, restart: false });
                }
            }
        };

        for (const breakpoint of this.model.getBreakpoints({ triggeredOnly: true })) {
            breakpoint.setSessionDidTrigger(session.getId(), false);
        }

        if (session.capabilities.supportsRestartRequest) {
            await doRestart(async () => {
                await session.restart();
                return true;
            });
            return;
        }

        const shouldFocus = session.getId() === this.viewModel.focusedSession?.getId();
        const isAutoRestart = !!restartData;
        await doRestart(async () => {
            // If the restart is automatic  -> disconnect, otherwise -> terminate #55064
            if (isAutoRestart) {
                await session.disconnect(true);
            } else {
                await session.terminate(true);
            }

            await new Promise((resolve) => setTimeout(resolve, RESTART_DELAY_MS));
            await this.launchOrAttachToSession(session, shouldFocus);
            this.onDidNewSessionEmitter.fire(session);
            return true;
        });
    }

    public async stopSession(session: IDebugSession | undefined, disconnect = false, suspend = false): Promise<void> {
        if (session) {
            await (disconnect ? session.disconnect(undefined, suspend) : session.terminate());
            return;
        }

        const sessions = this.model.getSessions();
        if (sessions.length === 0) {
            this.endInitializingState();
            this.cancelTokens(undefined);
        }

        await Promise.all(sessions.map((s) => (disconnect ? s.disconnect(undefined, suspend) : s.terminate())));
    }

    private async substituteVariables(launch: ILaunch | undefined, config: IConfig): Promise<IConfig | undefined> {
        const dbg = this.adapterManager.getDebugger(config.type);
        if (dbg) {
            let folder: IWorkspaceFolder | undefined = undefined;
            if (launch?.workspace) {
                folder = launch.workspace;
            } else {
                const folders = this.ports.workspace.getWorkspace().folders;
                if (folders.length === 1) {
                    folder = folders[0];
                }
            }
            try {
                return await dbg.substituteVariables(folder, config);
            } catch (err) {
                if (!isCancellationError(err)) {
                    this.showError((err as Error).message);
                }
                return undefined; // bail out
            }
        }
        return config;
    }

    private showError(message: string): void {
        this.ports.notifications.show({ severity: "error", message, modal: true, items: [] });
    }

    //---- focus management

    public async focusStackFrame(
        stackFrameToFocus: IStackFrame | undefined,
        threadToFocus?: IThread,
        sessionToFocus?: IDebugSession,
        options?: { explicit?: boolean; preserveFocus?: boolean; sideBySide?: boolean; pinned?: boolean },
    ): Promise<void> {
        const { stackFrame, thread, session } = getStackFrameThreadAndSessionToFocus(
            this.model,
            stackFrameToFocus,
            threadToFocus,
            sessionToFocus,
        );

        if (session) {
            this.ports.contextKeys.set("debugType", session.configuration.type);
        } else {
            this.ports.contextKeys.reset("debugType");
        }

        this.viewModel.setFocus(stackFrame, thread, session, !!options?.explicit);
        return Promise.resolve();
    }

    //---- breakpoints

    public setExceptionBreakpointsForSession(
        session: IDebugSession,
        filters: DebugProtocol.ExceptionBreakpointsFilter[],
    ): void {
        this.model.setExceptionBreakpointsForSession(session.getId(), filters);
        this.debugStorage.storeBreakpoints(this.model);
    }

    public async sendAllBreakpoints(session?: IDebugSession): Promise<void> {
        const setBreakpointsPromises = distinct(this.model.getBreakpoints(), (bp) => bp.originalUri.toString()).map(
            (bp) => this.sendBreakpoints(bp.originalUri, false, session),
        );

        // If sending breakpoints to one session which we know supports the configurationDone request, can make all requests in parallel
        if (session?.capabilities.supportsConfigurationDoneRequest) {
            await Promise.all([
                ...setBreakpointsPromises,
                this.sendFunctionBreakpoints(session),
                this.sendDataBreakpoints(session),
                this.sendInstructionBreakpoints(session),
                this.sendExceptionBreakpoints(session),
            ]);
        } else {
            await Promise.all(setBreakpointsPromises);
            await this.sendFunctionBreakpoints(session);
            await this.sendDataBreakpoints(session);
            await this.sendInstructionBreakpoints(session);
            // send exception breakpoints at the end since some debug adapters may rely on the order - this was the case before
            // the configurationDone request was introduced.
            await this.sendExceptionBreakpoints(session);
        }
    }

    public async sendBreakpoints(modelUri: uri, sourceModified = false, session?: IDebugSession): Promise<void> {
        const breakpointsToSend = this.model.getBreakpoints({ originalUri: modelUri, enabledOnly: true });
        await this.sendToOneOrAllSessions(session, async (s) => {
            if (!s.configuration.noDebug) {
                const sessionBps = breakpointsToSend.filter(
                    (bp) => !bp.triggeredBy || bp.getSessionDidTrigger(s.getId()),
                );
                await s.sendBreakpoints(modelUri, sessionBps, sourceModified);
            }
        });
    }

    private async sendFunctionBreakpoints(session?: IDebugSession): Promise<void> {
        const breakpointsToSend = this.model
            .getFunctionBreakpoints()
            .filter((fbp) => fbp.enabled && this.model.areBreakpointsActivated());

        await this.sendToOneOrAllSessions(session, async (s) => {
            if (s.capabilities.supportsFunctionBreakpoints && !s.configuration.noDebug) {
                await s.sendFunctionBreakpoints(breakpointsToSend);
            }
        });
    }

    private async sendDataBreakpoints(session?: IDebugSession): Promise<void> {
        const breakpointsToSend = this.model
            .getDataBreakpoints()
            .filter((fbp) => fbp.enabled && this.model.areBreakpointsActivated());

        await this.sendToOneOrAllSessions(session, async (s) => {
            if (s.capabilities.supportsDataBreakpoints && !s.configuration.noDebug) {
                await s.sendDataBreakpoints(breakpointsToSend);
            }
        });
    }

    private async sendInstructionBreakpoints(session?: IDebugSession): Promise<void> {
        const breakpointsToSend = this.model
            .getInstructionBreakpoints()
            .filter((fbp) => fbp.enabled && this.model.areBreakpointsActivated());

        await this.sendToOneOrAllSessions(session, async (s) => {
            if (s.capabilities.supportsInstructionBreakpoints && !s.configuration.noDebug) {
                await s.sendInstructionBreakpoints(breakpointsToSend);
            }
        });
    }

    private sendExceptionBreakpoints(session?: IDebugSession): Promise<void> {
        return this.sendToOneOrAllSessions(session, async (s) => {
            const enabledExceptionBps = this.model
                .getExceptionBreakpointsForSession(s.getId())
                .filter((exb) => exb.enabled);
            if (
                s.capabilities.supportsConfigurationDoneRequest &&
                (!s.capabilities.exceptionBreakpointFilters || s.capabilities.exceptionBreakpointFilters.length === 0)
            ) {
                // Only call `setExceptionBreakpoints` as specified in dap protocol #90001
                return;
            }
            if (!s.configuration.noDebug) {
                await s.sendExceptionBreakpoints(enabledExceptionBps);
            }
        });
    }

    private async sendToOneOrAllSessions(
        session: IDebugSession | undefined,
        send: (session: IDebugSession) => Promise<void>,
    ): Promise<void> {
        if (session) {
            await send(session);
        } else {
            await Promise.all(this.model.getSessions().map((s) => send(s)));
        }
    }
}

export function getStackFrameThreadAndSessionToFocus(
    model: IDebugModel,
    stackFrame: IStackFrame | undefined,
    thread?: IThread,
    session?: IDebugSession,
    avoidSession?: IDebugSession,
): { stackFrame: IStackFrame | undefined; thread: IThread | undefined; session: IDebugSession | undefined } {
    if (!session) {
        if (stackFrame || thread) {
            session = stackFrame ? stackFrame.thread.session : thread?.session;
        } else {
            const sessions = model.getSessions();
            const stoppedSession = sessions.find((s) => s.state === State.Stopped);
            // Make sure to not focus session that is going down
            session =
                stoppedSession ??
                sessions.find((s) => s !== avoidSession && s !== avoidSession?.parentSession) ??
                sessions.at(0);
        }
    }

    if (!thread) {
        if (stackFrame) {
            thread = stackFrame.thread;
        } else {
            const threads = session ? session.getAllThreads() : undefined;
            const stoppedThread = threads?.find((t) => t.stopped);
            thread = stoppedThread ?? threads?.at(0);
        }
    }

    if (!stackFrame && thread) {
        stackFrame = thread.getTopStackFrame();
    }

    return { session, thread, stackFrame };
}
