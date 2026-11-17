/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/debugService.ts
// `startDebugging` follows upstream's sequence: `onDebug` activation, saving the editors, the selected launch
// configuration or compound, resolution by the providers, variable substitution, the pre-launch task, resolution with
// substituted variables, then the session. Choosing a debugger for a configuration without a type (#1156) is not
// here yet: such a configuration goes to the providers without a type and does not start. Not here yet:
// data breakpoints, `debug.openExplorerOnEnd`, removing the breakpoints of a deleted file. The focused frame opens
// through the `openStackFrame` port (upstream `stackFrame.openInEditor`), and the positions the editor moved
// breakpoints to are sent on the file's save (upstream: on its change on disk). The
// activity badge of the view container (active sessions) is not here: the container switcher has no badges. Errors
// show as a modal notification, without the "Open launch.json" and "Install Extension" buttons. Not planned:
// workspace trust (diode has none), telemetry, extension host debugging, the memory and disassembly views.

import { distinct } from "../../../../base/common/arrays.ts";
import { raceTimeout, RunOnceScheduler } from "../../../../base/common/async.ts";
import { CancellationTokenSource } from "../../../../base/common/cancellation.ts";
import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { isCancellationError } from "../../../../base/common/errorSerialization.ts";
import { Emitter, type Event } from "../../../../base/common/event.ts";
import { DisposableStore, type IDisposable } from "../../../../base/common/lifecycle.ts";
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
    type AdapterEndEvent,
    getStateLabel,
    type IBreakpoint,
    type IBreakpointData,
    type IBreakpointUpdateData,
    type ICompound,
    type IConfig,
    type IDebugModel,
    type IDebugService,
    type IDebugSession,
    type IDebugSessionOptions,
    type IDebugTerminalLauncher,
    type IDebugVariableResolver,
    type IEnablement,
    type IExceptionBreakpoint,
    type ILaunch,
    type IStackFrame,
    type IThread,
    type IViewModel,
    type ReplSeverity,
    State,
} from "../common/debug.ts";
import { DebugCompoundRoot } from "../common/debugCompoundRoot.ts";
import {
    Breakpoint,
    DataBreakpoint,
    DebugModel,
    FunctionBreakpoint,
    type IDataBreakpointOptions,
    type IFunctionBreakpointOptions,
    type IInstructionBreakpointOptions,
    InstructionBreakpoint,
    type ITextFileDirtyState,
} from "../common/debugModel.ts";
import { DebugStorage } from "../common/debugStorage.ts";
import { ViewModel } from "../common/debugViewModel.ts";
import type { IReplConsoleConfiguration } from "../common/replModel.ts";

import { AdapterManager } from "./debugAdapterManager.ts";
import { ConfigurationManager, type IConfigurationManagerPorts } from "./debugConfigurationManager.ts";
import { DebugSession, type IDebugServiceConfiguration, type IDebugSessionServices } from "./debugSession.ts";
import { DebugTaskRunner, type IDebugTaskRunnerPorts, TaskRunResult } from "./debugTaskRunner.ts";

export const DebugServiceDIToken = token<DebugService>("DebugService");

/** What the debug service talks to; the DI module builds it from the workbench services. */
export interface IDebugServicePorts {
    readonly contextKeys: Pick<ContextKeyService, "set" | "get" | "reset" | "evaluate" | "onDidChange">;
    readonly state: Pick<IStateService, "get" | "store" | "remove" | "onDidOpenWorkspace">;
    readonly textFiles: ITextFileDirtyState;
    readonly logger: ILogger;
    readonly notifications: Pick<NotificationService, "show">;
    readonly extensions: Pick<IExtensionService, "activateByEvent" | "whenInstalledExtensionsRegistered">;
    readonly workspace: Pick<IWorkspaceContextService, "getWorkspace">;
    readonly replConfiguration: () => IReplConsoleConfiguration;
    readonly configurationManager: IConfigurationManagerPorts;
    readonly tasks: IDebugTaskRunnerPorts;
    /** Upstream `saveAllBeforeDebugStart`: saves the editors as `debug.saveBeforeStart` says. */
    readonly saveAllBeforeStart: () => Promise<void>;
    /** The adapters' `runInTerminal`: the integrated terminal. */
    readonly terminalLauncher: IDebugTerminalLauncher;
    /** The configuration resolver over launch.json: the variables of a configuration, interactive ones too. */
    readonly variables: IDebugVariableResolver;
    readonly debugConfiguration: () => IDebugServiceConfiguration;
    /** Upstream's `openPaneComposite(VIEWLET_ID, Sidebar)`: shows Run and Debug without taking the focus. */
    readonly openViewlet: () => void;
    /** Upstream's `openView(REPL_VIEW_ID, false)`: shows the Debug Console without taking the focus. */
    readonly openRepl: () => void;
    /** Upstream's `closeViewContainer` of the Debug Console's container when it is visible. */
    readonly closeRepl: () => void;
    /**
     * Upstream `stackFrame.openInEditor`: the frame's source at its line, in the active group or beside it; a frame
     * without an available source opens nothing.
     */
    readonly openStackFrame: (
        stackFrame: IStackFrame,
        options: { preserveFocus: boolean; sideBySide: boolean },
    ) => Promise<void>;
    /** A text file was saved: the breakpoints the editor moved in it go to the adapters. */
    readonly onDidSaveTextFile: (listener: (resource: uri) => void) => IDisposable;
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
    private readonly configurationManager: ConfigurationManager;
    private readonly taskRunner: DebugTaskRunner;
    private initializing = false;
    private initializingOptionsValue: IDebugSessionOptions | undefined;
    private previousState: State | undefined;
    private readonly sessionCancellationTokens = new Map<string, CancellationTokenSource>();
    /** Upstream keeps a set of uris; a map by the string keeps one entry per file. */
    private readonly breakpointsToSendOnResourceSaved = new Map<string, uri>();
    private readonly sessionServices: IDebugSessionServices;

    public constructor(private readonly ports: IDebugServicePorts) {
        const contextKeys = ports.contextKeys;
        this.adapterManager = this.disposables.add(
            new AdapterManager(() => this, {
                contextKeys,
                terminalLauncher: ports.terminalLauncher,
                extensions: ports.extensions,
                variables: ports.variables,
                allowBreakpointsEverywhere: () => ports.debugConfiguration().allowBreakpointsEverywhere,
            }),
        );
        this.configurationManager = this.disposables.add(
            new ConfigurationManager(this.adapterManager, ports.configurationManager),
        );
        this.taskRunner = this.disposables.add(new DebugTaskRunner(ports.tasks));
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
            debugConfiguration: ports.debugConfiguration,
            openViewlet: ports.openViewlet,
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
        const updateDebugUx = (): void => {
            this.setDebugUx(
                this.state !== State.Inactive ||
                    (this.configurationManager.getAllConfigurations().length > 0 &&
                        this.adapterManager.hasEnabledDebuggers())
                    ? "default"
                    : "simple",
            );
        };
        this.disposables.add(this.adapterManager.onDidRegisterDebugger(updateDebugUx));
        this.disposables.add(this.configurationManager.onDidSelectConfiguration(updateDebugUx));

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
        this.disposables.add(
            ports.onDidSaveTextFile((resource) => {
                this.onDidSaveTextFile(resource);
            }),
        );
    }

    private notify(severity: ReplSeverity, message: string): void {
        // Errors, and `important` output, which is info.
        const kind = severity === "error" ? "error" : "info";
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

    public getConfigurationManager(): ConfigurationManager {
        return this.configurationManager;
    }

    public dispose(): void {
        this.disposables.dispose();
    }

    //---- watches

    public addWatchExpression(name?: string): void {
        const we = this.model.addWatchExpression(name);
        if (!name) {
            this.viewModel.setSelectedExpression(we, false);
        }
        this.debugStorage.storeWatchExpressions(this.model.getWatchExpressions());
    }

    public renameWatchExpression(id: string, newName: string): void {
        this.model.renameWatchExpression(id, newName);
        this.debugStorage.storeWatchExpressions(this.model.getWatchExpressions());
    }

    public moveWatchExpression(id: string, position: number): void {
        this.model.moveWatchExpression(id, position);
        this.debugStorage.storeWatchExpressions(this.model.getWatchExpressions());
    }

    public removeWatchExpressions(id?: string): void {
        this.model.removeWatchExpressions(id);
        this.debugStorage.storeWatchExpressions(this.model.getWatchExpressions());
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

    /** Upstream checks that it is initializing; out of it there is nothing to reset, and no state change follows. */
    private endInitializingState(): void {
        this.initializing = false;
        this.initializingOptionsValue = undefined;
        this.onStateChange();
    }

    /** Cancels the starts in progress. */
    private cancelTokens(): void {
        this.sessionCancellationTokens.forEach((t) => {
            t.cancel();
        });
        // Stryker disable next-line CallExpression: letting go of cancelled tokens; cancelling them again is a no-op and session ids never repeat
        this.sessionCancellationTokens.clear();
    }

    private setDebugUx(value: "simple" | "default"): void {
        if (this.ports.contextKeys.get("debugUx") === value) {
            return;
        }
        this.ports.contextKeys.set("debugUx", value);
        this.debugStorage.storeDebugUxState(value);
    }

    private onStateChange(): void {
        const state = this.state;
        if (this.previousState !== state) {
            this.ports.contextKeys.set("debugState", getStateLabel(state));
            this.ports.contextKeys.set("inDebugMode", state !== State.Inactive);
            // Only show the simple ux if debug is not yet started and if no launch.json exists
            this.setDebugUx(
                (state !== State.Inactive && state !== State.Initializing) ||
                    (this.adapterManager.hasEnabledDebuggers() && this.configurationManager.selectedConfiguration.name)
                    ? "default"
                    : "simple",
            );
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
        saveBeforeStart = !options?.parentSession,
    ): Promise<boolean> {
        this.startInitializingState(options);
        this.ports.contextKeys.set("hasDebugged", true);
        try {
            // make sure to save all files and that the configuration is up to date
            await this.ports.extensions.activateByEvent("onDebug");
            if (saveBeforeStart) {
                await this.ports.saveAllBeforeStart();
            }
            await this.ports.extensions.whenInstalledExtensionsRegistered();

            let config: IConfig | undefined;
            configOrName ??= this.configurationManager.selectedConfiguration.name;
            if (typeof configOrName === "string" && launch) {
                // A compound of the name wins over a configuration of the same name.
                const compound = launch.getCompound(configOrName);
                if (compound) {
                    const result = await this.startCompound(launch, compound, options);
                    this.endInitializingState();
                    return result;
                }
                config = launch.getConfiguration(configOrName);
            } else if (typeof configOrName !== "string") {
                config = configOrName;
            }

            // A passed configuration object is `config` itself: only a name can be missing.
            if (typeof configOrName === "string" && !config) {
                const message = launch
                    ? `Configuration '${configOrName}' is missing in 'launch.json'.`
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

    /** We are starting a compound debug, first do some error checking and than start each configuration in the compound. */
    private async startCompound(
        launch: ILaunch,
        compound: ICompound,
        options: IDebugSessionOptions | undefined,
    ): Promise<boolean> {
        // Upstream checks that `configurations` is set: a launch lists only compounds with configurations. Without a
        // preLaunchTask the run is a success at once.
        const taskResult = await this.taskRunner.runTaskAndCheckErrors(
            launch.workspace ?? this.ports.workspace.getWorkspace(),
            compound.preLaunchTask,
        );
        if (taskResult === TaskRunResult.Failure) {
            return false;
        }
        if (compound.stopAll) {
            options = { ...options, compoundRoot: new DebugCompoundRoot() };
        }

        const values = await Promise.all(
            compound.configurations.map((configData) => {
                const name = typeof configData === "string" ? configData : configData.name;
                if (name === compound.name) {
                    return Promise.resolve(false);
                }

                let launchForName: ILaunch | undefined;
                if (typeof configData === "string") {
                    const launchesContainingName = this.configurationManager
                        .getLaunches()
                        .filter((l) => !!l.getConfiguration(name));
                    if (launchesContainingName.length === 1) {
                        launchForName = launchesContainingName[0];
                    } else if (launchesContainingName.includes(launch)) {
                        // If there are multiple launches containing the configuration give priority to the configuration in the current launch
                        launchForName = launch;
                    } else {
                        throw new Error(
                            launchesContainingName.length === 0
                                ? `Could not find launch configuration '${name}' in the workspace.`
                                : `There are multiple launch configurations '${name}' in the workspace. Use folder name to qualify the configuration.`,
                        );
                    }
                } else {
                    const launchesMatchingConfigData = this.configurationManager
                        .getLaunches()
                        .filter(
                            (l) => l.workspace?.name === configData.folder && !!l.getConfiguration(configData.name),
                        );
                    if (launchesMatchingConfigData.length === 1) {
                        launchForName = launchesMatchingConfigData[0];
                    } else {
                        throw new Error(
                            `Can not find folder with name '${configData.folder}' for configuration '${configData.name}' in compound '${compound.name}'.`,
                        );
                    }
                }

                return this.createSession(launchForName, launchForName.getConfiguration(name), options);
            }),
        );

        // Compound launch is a success only if each configuration launched successfully
        return values.every((success) => success);
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
        // A configuration without a type would be completed by the debugger the user picks (#1156).
        let type: string | undefined;
        let config: IConfig;
        if (configOrUndefined) {
            config = configOrUndefined;
            type = config.type;
        } else {
            // a no-folder workspace has no launch.config
            config = Object.create(null) as IConfig;
        }
        if (options?.noDebug) {
            config.noDebug = true;
        } else if (options?.noDebug === undefined && options?.parentSession?.configuration.noDebug) {
            config.noDebug = true;
        }
        const unresolvedConfig = structuredClone(config);

        const initCancellationToken = new CancellationTokenSource();
        const sessionId = generateUuid();
        this.sessionCancellationTokens.set(sessionId, initCancellationToken);

        const folderUri = launch?.workspace?.uri;
        const configByProviders = await this.configurationManager.resolveConfigurationByProviders(
            folderUri,
            type,
            config,
            initCancellationToken.token,
        );
        // a falsy config indicates an aborted launch
        if (configByProviders?.type) {
            try {
                let resolvedConfig = await this.substituteVariables(launch, configByProviders);
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

                const workspace = launch?.workspace ?? this.ports.workspace.getWorkspace();
                const taskResult = await this.taskRunner.runTaskAndCheckErrors(workspace, resolvedConfig.preLaunchTask);
                if (taskResult === TaskRunResult.Failure) {
                    return false;
                }

                const cfg = await this.configurationManager.resolveDebugConfigurationWithSubstitutedVariables(
                    folderUri,
                    resolvedConfig.type,
                    resolvedConfig,
                    initCancellationToken.token,
                );
                if (!cfg) {
                    // show launch.json only for "config" being "null".
                    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the token may be cancelled while the task and the providers above run; TS keeps the narrowing of the earlier check
                    if (launch && type && cfg === null && !initCancellationToken.token.isCancellationRequested) {
                        await launch.openConfigFile({ preserveFocus: true, type });
                    }
                    return false;
                }
                resolvedConfig = cfg;

                const dbg = this.adapterManager.getDebugger(resolvedConfig.type);
                if (!dbg || (configByProviders.request !== "attach" && configByProviders.request !== "launch")) {
                    let message: string;
                    if (configByProviders.request !== "attach" && configByProviders.request !== "launch") {
                        message = configByProviders.request
                            ? `Attribute 'request' has an unsupported value '${configByProviders.request}' in the chosen debug configuration.`
                            : "Attribute 'request' is missing from the chosen debug configuration.";
                    } else {
                        message = resolvedConfig.type
                            ? `Configured debug type '${resolvedConfig.type}' is not supported.`
                            : "Missing property 'type' for the chosen launch configuration.";
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
                // Upstream's other branch, the empty workspace's message, is for a configuration of a guessed debugger (#1156).
                if ((err as Error | undefined)?.message) {
                    this.showError((err as Error).message);
                }
                if (launch && !initCancellationToken.token.isCancellationRequested) {
                    await launch.openConfigFile({ preserveFocus: true });
                }

                return false;
            }
        }

        // show launch.json only for "config" being "null".
        if (launch && type && configByProviders === null && !initCancellationToken.token.isCancellationRequested) {
            await launch.openConfigFile({ preserveFocus: true, type });
        }

        return false;
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
            this.findSameSession(configuration.resolved, root) &&
            configuration.resolved.suppressMultipleSessionWarning !== true
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

        const openDebug = this.ports.debugConfiguration().openDebug;
        // Open debug viewlet based on the visibility of the side bar and openDebug setting. Do not open for 'run without debug'.
        // Note: 'openOnDebugBreak' is intentionally excluded here - that case is handled in debugSession when a breakpoint is hit.
        if (
            !configuration.resolved.noDebug &&
            (openDebug === "openOnSessionStart" ||
                (openDebug === "openOnFirstSessionStart" && this.viewModel.firstSessionStart)) &&
            !session.suppressDebugView
        ) {
            this.ports.openViewlet();
        }

        try {
            await this.launchOrAttachToSession(session);

            const internalConsoleOptions =
                session.configuration.internalConsoleOptions ?? this.ports.debugConfiguration().internalConsoleOptions;
            if (
                internalConsoleOptions === "openOnSessionStart" ||
                (this.viewModel.firstSessionStart && internalConsoleOptions === "openOnFirstSessionStart")
            ) {
                this.ports.openRepl();
            }

            this.viewModel.firstSessionStart = false;
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

            // Show the repl if some error got logged there #5870
            if (session.getReplElements().length > 0) {
                this.ports.openRepl();
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
        // Stryker disable next-line CallExpression: the service is disposed with the window, when no session event comes any more
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
                void this.onDidEndAdapter(session, adapterExitEvent);
            }),
        );
    }

    /** Without a `postDebugTask` it runs to the end at once, as upstream's async listener. */
    private async onDidEndAdapter(
        session: IDebugSession,
        adapterExitEvent: AdapterEndEvent | undefined,
    ): Promise<void> {
        const terminated = (error: Error): string =>
            `Debug adapter process has terminated unexpectedly (${error.message})`;
        const error = adapterExitEvent?.error;
        if (error) {
            this.notify("error", terminated(error));
        }
        // Diode: an adapter that went away by itself says so in the Debug Console; upstream ends the session silently.
        const failure = adapterExitEvent?.failure;
        if (failure) {
            session.appendToRepl({ output: `${terminated(failure)}\n`, sev: "error" });
        }

        // Without a postDebugTask `runTask` has nothing to run.
        const root = session.root ?? this.ports.workspace.getWorkspace();
        try {
            await this.taskRunner.runTask(root, session.configuration.postDebugTask);
        } catch (err) {
            this.notify("error", (err as Error).message);
        }
        this.endInitializingState();
        // The token of a started session's start cancels nothing any more (upstream cancels it): it is only let go.
        // Stryker disable next-line CallExpression: letting go of a token nothing listens to
        this.sessionCancellationTokens.delete(session.getId());

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

            if (this.ports.debugConfiguration().console.closeOnEnd) {
                this.ports.closeRepl();
            }
        }

        this.model.removeExceptionBreakpointsForSession(session.getId());
    }

    public async restartSession(session: IDebugSession, restartData?: unknown): Promise<void> {
        if (session.saveBeforeRestart) {
            await this.ports.saveAllBeforeStart();
        }

        const isAutoRestart = !!restartData;

        const runTasks = async (): Promise<TaskRunResult> => {
            if (isAutoRestart) {
                // Do not run preLaunch and postDebug tasks for automatic restarts
                return TaskRunResult.Success;
            }

            const root = session.root ?? this.ports.workspace.getWorkspace();
            await this.taskRunner.runTask(root, session.configuration.preRestartTask);
            await this.taskRunner.runTask(root, session.configuration.postDebugTask);

            const taskResult1 = await this.taskRunner.runTaskAndCheckErrors(root, session.configuration.preLaunchTask);
            if (taskResult1 !== TaskRunResult.Success) {
                return taskResult1;
            }

            return this.taskRunner.runTaskAndCheckErrors(root, session.configuration.postRestartTask);
        };

        // Read the configuration again if a launch.json has been changed, if not just use the inmemory configuration
        let needsToSubstitute = false;
        let unresolved: IConfig | undefined;
        const launch = session.root ? this.configurationManager.getLaunch(session.root.uri) : undefined;
        if (launch) {
            unresolved = launch.getConfiguration(session.configuration.name);
            if (unresolved && JSON.stringify(unresolved) !== JSON.stringify(session.unresolvedConfiguration)) {
                unresolved.noDebug = session.configuration.noDebug;
                needsToSubstitute = true;
            }
        }

        let resolved: IConfig | undefined | null = session.configuration;
        if (launch && needsToSubstitute && unresolved) {
            const initCancellationToken = new CancellationTokenSource();
            // Stryker disable next-line CallExpression: equivalent, only a stop with no session cancels the tokens, and a restarting session is a session
            this.sessionCancellationTokens.set(session.getId(), initCancellationToken);
            // Stryker disable next-line OptionalChaining: equivalent, `getLaunch` finds the launch by its folder
            const folderUri = launch.workspace?.uri;
            const resolvedByProviders = await this.configurationManager.resolveConfigurationByProviders(
                folderUri,
                unresolved.type,
                unresolved,
                initCancellationToken.token,
            );
            if (resolvedByProviders) {
                resolved = await this.substituteVariables(launch, resolvedByProviders);
                if (resolved && !initCancellationToken.token.isCancellationRequested) {
                    resolved = await this.configurationManager.resolveDebugConfigurationWithSubstitutedVariables(
                        folderUri,
                        resolved.type,
                        resolved,
                        initCancellationToken.token,
                    );
                }
            } else {
                resolved = resolvedByProviders;
            }
        }
        if (resolved) {
            session.setConfiguration({ resolved, unresolved });
        }
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

        // Stryker disable next-line ObjectLiteral,BooleanLiteral: a breakpoint without a trigger never reads the flag
        for (const breakpoint of this.model.getBreakpoints({ triggeredOnly: true })) {
            breakpoint.setSessionDidTrigger(session.getId(), false);
        }

        if (session.capabilities.supportsRestartRequest) {
            const taskResult = await runTasks();
            if (taskResult === TaskRunResult.Success) {
                await doRestart(async () => {
                    await session.restart();
                    return true;
                });
            }
            return;
        }

        const shouldFocus = session.getId() === this.viewModel.focusedSession?.getId();
        await doRestart(async () => {
            // If the restart is automatic  -> disconnect, otherwise -> terminate #55064
            if (isAutoRestart) {
                await session.disconnect(true);
            } else {
                await session.terminate(true);
            }

            await new Promise((resolve) => setTimeout(resolve, RESTART_DELAY_MS));
            const taskResult = await runTasks();
            if (taskResult !== TaskRunResult.Success) {
                return false;
            }
            if (!resolved) {
                return false;
            }
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
            this.taskRunner.cancel();
            this.endInitializingState();
            this.cancelTokens();
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

        if (stackFrame) {
            await this.ports.openStackFrame(stackFrame, {
                preserveFocus: options?.preserveFocus ?? true,
                sideBySide: !!options?.sideBySide,
            });
        }
        if (session) {
            this.ports.contextKeys.set("debugType", session.configuration.type);
        } else {
            this.ports.contextKeys.reset("debugType");
        }

        this.viewModel.setFocus(stackFrame, thread, session, !!options?.explicit);
    }

    //---- breakpoints

    public sourceIsNotAvailable(uri: uri): void {
        this.model.sourceIsNotAvailable(uri);
    }

    /** Upstream takes the text model; here the language of the file is enough. */
    public canSetBreakpointsIn(languageId: string): boolean {
        return this.adapterManager.canSetBreakpointsIn(languageId);
    }

    public async updateBreakpoints(
        uri: uri,
        data: Map<string, IBreakpointUpdateData>,
        sendOnResourceSaved: boolean,
    ): Promise<void> {
        this.model.updateBreakpoints(data);
        this.debugStorage.storeBreakpoints(this.model);
        if (sendOnResourceSaved) {
            this.breakpointsToSendOnResourceSaved.set(uri.toString(), uri);
        } else {
            await this.sendBreakpoints(uri);
            this.debugStorage.storeBreakpoints(this.model);
        }
    }

    /** Upstream `onFileChanges` with an updated file, from a save in the editor here. */
    private onDidSaveTextFile(resource: uri): void {
        const key = resource.toString();
        if (!this.breakpointsToSendOnResourceSaved.delete(key)) return;
        void this.sendBreakpoints(resource, true);
    }

    public async enableOrDisableBreakpoints(enable: boolean, breakpoint?: IEnablement): Promise<void> {
        if (breakpoint) {
            this.model.setEnablement(breakpoint, enable);
            this.debugStorage.storeBreakpoints(this.model);
            if (breakpoint instanceof Breakpoint) {
                await this.makeTriggeredBreakpointsMatchEnablement(enable, breakpoint);
                await this.sendBreakpoints(breakpoint.originalUri);
            } else if (breakpoint instanceof FunctionBreakpoint) {
                await this.sendFunctionBreakpoints();
            } else if (breakpoint instanceof DataBreakpoint) {
                await this.sendDataBreakpoints();
            } else if (breakpoint instanceof InstructionBreakpoint) {
                await this.sendInstructionBreakpoints();
            } else {
                await this.sendExceptionBreakpoints();
            }
        } else {
            this.model.enableOrDisableAllBreakpoints(enable);
            this.debugStorage.storeBreakpoints(this.model);
            await this.sendAllBreakpoints();
        }
        // Again with what the adapter answered: the adapter data of the source breakpoints.
        this.debugStorage.storeBreakpoints(this.model);
    }

    public async removeBreakpoints(id?: string | string[]): Promise<void> {
        const breakpoints = this.model.getBreakpoints();
        const toRemove =
            id === undefined
                ? breakpoints
                : Array.isArray(id)
                  ? breakpoints.filter((bp) => id.includes(bp.getId()))
                  : breakpoints.filter((bp) => bp.getId() === id);
        // Upstream keeps the uris as strings to make them distinct; a map by the string keeps the uri itself.
        const urisToClear = new Map(toRemove.map((bp) => [bp.originalUri.toString(), bp.originalUri]));

        this.model.removeBreakpoints(toRemove);
        for (const uri of this.unlinkTriggeredBreakpoints(toRemove)) urisToClear.set(uri.toString(), uri);

        this.debugStorage.storeBreakpoints(this.model);
        await Promise.all([...urisToClear.values()].map((uri) => this.sendBreakpoints(uri)));
    }

    public setBreakpointsActivated(activated: boolean): Promise<void> {
        this.model.setBreakpointsActivated(activated);
        return this.sendAllBreakpoints();
    }

    public async addFunctionBreakpoint(opts?: IFunctionBreakpointOptions, id?: string): Promise<void> {
        this.model.addFunctionBreakpoint(opts ?? { name: "" }, id);
        // If opts not provided, sending the breakpoint is handled by a later to call to `updateFunctionBreakpoint`
        if (opts) {
            this.debugStorage.storeBreakpoints(this.model);
            // No store after the answer, unlike upstream: nothing of it goes into a stored function breakpoint.
            await this.sendFunctionBreakpoints();
        }
    }

    public async removeFunctionBreakpoints(id?: string): Promise<void> {
        this.model.removeFunctionBreakpoints(id);
        this.debugStorage.storeBreakpoints(this.model);
        await this.sendFunctionBreakpoints();
    }

    public async updateFunctionBreakpoint(
        id: string,
        update: { name?: string; hitCondition?: string; condition?: string },
    ): Promise<void> {
        this.model.updateFunctionBreakpoint(id, update);
        this.debugStorage.storeBreakpoints(this.model);
        await this.sendFunctionBreakpoints();
    }

    public async addDataBreakpoint(opts: IDataBreakpointOptions): Promise<void> {
        this.model.addDataBreakpoint(opts);
        this.debugStorage.storeBreakpoints(this.model);
        // Upstream stores once more after sending; nothing of the stored breakpoint changes with the answer.
        await this.sendDataBreakpoints();
    }

    public async updateDataBreakpoint(
        id: string,
        update: { hitCondition?: string; condition?: string },
    ): Promise<void> {
        this.model.updateDataBreakpoint(id, update);
        this.debugStorage.storeBreakpoints(this.model);
        await this.sendDataBreakpoints();
    }

    public async removeDataBreakpoints(id?: string): Promise<void> {
        this.model.removeDataBreakpoints(id);
        this.debugStorage.storeBreakpoints(this.model);
        await this.sendDataBreakpoints();
    }

    public async removeInstructionBreakpoints(
        instructionReference?: string,
        offset?: number,
        address?: bigint,
    ): Promise<void> {
        // Instruction breakpoints are not stored (upstream stores here all the same).
        this.model.removeInstructionBreakpoints(instructionReference, offset, address);
        await this.sendInstructionBreakpoints();
    }

    public async addInstructionBreakpoint(opts: IInstructionBreakpointOptions): Promise<void> {
        // Instruction breakpoints are not stored (upstream stores here all the same).
        this.model.addInstructionBreakpoint(opts);
        await this.sendInstructionBreakpoints();
    }

    public async setExceptionBreakpointCondition(
        exceptionBreakpoint: IExceptionBreakpoint,
        condition: string | undefined,
    ): Promise<void> {
        this.model.setExceptionBreakpointCondition(exceptionBreakpoint, condition);
        this.debugStorage.storeBreakpoints(this.model);
        await this.sendExceptionBreakpoints();
    }

    /** Called after the removal: the breakpoints left are the model's (upstream walks all of them, removed too). */
    private unlinkTriggeredBreakpoints(removedBreakpoints: readonly IBreakpoint[]): uri[] {
        const affectedUris: uri[] = [];
        for (const removed of removedBreakpoints) {
            for (const existing of this.model.getBreakpoints()) {
                if (existing.triggeredBy === removed.getId()) {
                    this.model.updateBreakpoints(new Map([[existing.getId(), { triggeredBy: undefined }]]));
                    affectedUris.push(existing.originalUri);
                }
            }
        }

        return affectedUris;
    }

    private async makeTriggeredBreakpointsMatchEnablement(enable: boolean, breakpoint: Breakpoint): Promise<void> {
        if (enable) {
            /** If the breakpoint is being enabled, also ensure its triggerer is enabled */
            const trigger = this.model.getBreakpoints().find((bp) => breakpoint.triggeredBy === bp.getId());
            if (trigger && !trigger.enabled) {
                await this.enableOrDisableBreakpoints(enable, trigger);
            }
        }

        /** Makes its triggeree states match the state of this breakpoint */
        await Promise.all(
            this.model
                .getBreakpoints()
                .filter((bp) => bp.triggeredBy === breakpoint.getId() && bp.enabled !== enable)
                .map((bp) => this.enableOrDisableBreakpoints(enable, bp)),
        );
    }

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

    /** Upstream's, without the screen-reader announcement. */
    public async addBreakpoints(uri: uri, rawBreakpoints: IBreakpointData[]): Promise<IBreakpoint[]> {
        const breakpoints = this.model.addBreakpoints(uri, rawBreakpoints);
        // Stored before sending, which can take long, and after: the adapter can attach its data to a breakpoint.
        this.debugStorage.storeBreakpoints(this.model);
        await this.sendBreakpoints(uri);
        this.debugStorage.storeBreakpoints(this.model);
        return breakpoints;
    }

    /**
     * Upstream's: a breakpoint where the program should stop, unless one is there, then Continue on the thread that
     * verified it (or a session started with the selected configuration); the breakpoint goes with the next stop.
     */
    public async runTo(uri: uri, lineNumber: number, column?: number): Promise<void> {
        let breakpointToRemove: IBreakpoint | undefined;
        let threadToContinue = this.getViewModel().focusedThread;
        const addTempBreakPoint = async (): Promise<void> => {
            const bpExists = this.getModel().getBreakpoints({ column, lineNumber, uri }).length > 0;

            if (!bpExists) {
                const addResult = await this.addAndValidateBreakpoints(uri, lineNumber, column);
                if (addResult.thread) {
                    threadToContinue = addResult.thread;
                }

                if (addResult.breakpoint) {
                    breakpointToRemove = addResult.breakpoint;
                }
            }
        };
        const removeTempBreakPoint = (state: State): boolean => {
            if (state === State.Stopped || state === State.Inactive) {
                if (breakpointToRemove) {
                    this.removeBreakpoints(breakpointToRemove.getId()).catch(onUnexpectedError);
                }
                return true;
            }
            return false;
        };

        await addTempBreakPoint();
        if (this.state === State.Inactive) {
            // If no session exists start the debugger
            const { launch, name, getConfig } = this.getConfigurationManager().selectedConfiguration;
            const config = await getConfig();
            const configOrName = config ? structuredClone(config) : name;
            const listener = this.onDidChangeState((state) => {
                if (removeTempBreakPoint(state)) {
                    listener.dispose();
                }
            });
            await this.startDebugging(launch, configOrName, undefined, true);
        }
        if (this.state === State.Stopped) {
            const focusedSession = this.getViewModel().focusedSession;
            if (!focusedSession || !threadToContinue) {
                return;
            }

            const listener = threadToContinue.session.onDidChangeState(() => {
                if (removeTempBreakPoint(focusedSession.state)) {
                    listener.dispose();
                }
            });
            await threadToContinue.continue();
        }
    }

    private async addAndValidateBreakpoints(
        uri: uri,
        lineNumber: number,
        column?: number,
    ): Promise<{ breakpoint: IBreakpoint | undefined; thread: IThread | undefined }> {
        const debugModel = this.getModel();
        const viewModel = this.getViewModel();

        const breakpoints = await this.addBreakpoints(uri, [{ lineNumber, column }]);
        const breakpoint = breakpoints.at(0);
        if (!breakpoint) {
            return { breakpoint: undefined, thread: viewModel.focusedThread };
        }

        // If the breakpoint was not initially verified, wait up to 2s for it to become so.
        // Inherently racey if multiple sessions can verify async, but not solvable...
        if (!breakpoint.verified) {
            const listeners = new DisposableStore();
            await raceTimeout(
                new Promise<void>((resolve) => {
                    listeners.add(
                        debugModel.onDidChangeBreakpoints(() => {
                            if (breakpoint.verified) {
                                resolve();
                            }
                        }),
                    );
                }),
                2000,
            );
            listeners.dispose();
        }

        // Look at paused threads for sessions that verified this bp. Prefer, in order:
        const enum Score {
            /** The focused thread */
            Focused,
            /** Any other stopped thread of a session that verified the bp */
            Verified,
            /** Any thread that verified and paused in the same file */
            VerifiedAndPausedInFile,
            /** The focused thread if it verified the breakpoint */
            VerifiedAndFocused,
        }

        let bestThread = viewModel.focusedThread;
        let bestScore = Score.Focused;
        for (const sessionId of breakpoint.sessionsThatVerified) {
            const session = debugModel.getSession(sessionId);
            if (!session) {
                continue;
            }

            const threads = session.getAllThreads().filter((t) => t.stopped);
            if (bestScore < Score.VerifiedAndFocused) {
                if (viewModel.focusedThread && threads.includes(viewModel.focusedThread)) {
                    bestThread = viewModel.focusedThread;
                    bestScore = Score.VerifiedAndFocused;
                }
            }

            if (bestScore < Score.VerifiedAndPausedInFile) {
                const pausedInThisFile = threads.find((t) => {
                    const top = t.getTopStackFrame();
                    return top?.source.uri.toString() === uri.toString();
                });

                if (pausedInThisFile) {
                    bestThread = pausedInThisFile;
                    bestScore = Score.VerifiedAndPausedInFile;
                }
            }

            if (bestScore < Score.Verified) {
                bestThread = threads[0];
                bestScore = Score.VerifiedAndPausedInFile;
            }
        }

        return { thread: bestThread, breakpoint };
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
