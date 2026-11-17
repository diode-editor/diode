/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/common/debug.ts
// The model's half of upstream `debug.ts`: the raw and model interfaces, `State`, breakpoints, launch
// configurations and the adapter contract. The `CONTEXT_*` keys are typed keys of `ContextKeyTypes`
// (platform/contextkey/common/contextKeys.ts) under the upstream names. `IDebugService`, `IAdapterManager` and
// `ILaunch` carry what the session, its commands and the views use; the rest comes with the task that implements
// it: the breakpoint editing of `IDebugService` in the editor (adding, conditions, data breakpoints), the dynamic
// configurations of `IConfigurationManager` (Select and Start Debugging), the descriptor factories and `guessDebugger` of
// `IAdapterManager` (`vscode.debug`), the editor contributions, `openInEditor` of frames and sources (with the
// editor service they need), the test run a session is correlated with. Not planned: the memory view (`getMemory`,
// webview) and debug visualizers (proposed API).

import type { ICancellationToken as CancellationToken } from "../../../../base/common/cancellation.ts";
import type { Event } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import type { Uri as uri } from "../../../../base/common/uri.ts";
import type { IPosition, Position } from "../../../../editor/common/core/position.ts";
import type { IRange } from "../../../../editor/common/core/range.ts";
import type { ConfigurationTarget } from "../../../../platform/configuration/common/iConfigurationService.ts";
import type { IWorkspaceFolder } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";

import type { DebugCompoundRoot } from "./debugCompoundRoot.ts";
import type {
    IDataBreakpointOptions,
    IFunctionBreakpointOptions,
    IInstructionBreakpointOptions,
} from "./debugModel.ts";
import type { Source } from "./debugSource.ts";

export const DEBUG_SCHEME = "debug";

export const VIEWLET_ID = "workbench.view.debug";

export const VARIABLES_VIEW_ID = "workbench.debug.variablesView";
export const WATCH_VIEW_ID = "workbench.debug.watchExpressionsView";
export const CALLSTACK_VIEW_ID = "workbench.debug.callStackView";
export const BREAKPOINTS_VIEW_ID = "workbench.debug.breakPointsView";
export const DEBUG_PANEL_ID = "workbench.panel.repl";
export const REPL_VIEW_ID = "workbench.panel.repl.view";

// raw

export interface IRawModelUpdate {
    sessionId: string;
    threads: DebugProtocol.Thread[];
    stoppedDetails?: IRawStoppedDetails;
}

export interface IRawStoppedDetails {
    reason?: string;
    description?: string;
    threadId?: number;
    text?: string;
    totalFrames?: number;
    allThreadsStopped?: boolean;
    preserveFocusHint?: boolean;
    framesErrorMessage?: string;
    hitBreakpointIds?: number[];
}

// model

export interface ITreeElement {
    getId(): string;
}

export interface IReplElement extends ITreeElement {
    toString(includeSource?: boolean): string;
    readonly sourceData?: IReplElementSource;
}

export interface INestingReplElement extends IReplElement {
    readonly hasChildren: boolean;
    getChildren(): Promise<IReplElement[]> | IReplElement[];
}

export interface IReplElementSource {
    readonly source: Source;
    readonly lineNumber: number;
    readonly column: number;
}

export interface IExpressionValue {
    readonly value: string;
    readonly type?: string;
    valueChanged?: boolean;
}

export interface IExpressionContainer extends ITreeElement, IExpressionValue {
    readonly hasChildren: boolean;
    getSession(): IDebugSession | undefined;
    evaluateLazy(): Promise<void>;
    getChildren(): Promise<IExpression[]>;
    readonly reference?: number;
    readonly memoryReference?: string;
    readonly presentationHint?: DebugProtocol.VariablePresentationHint | undefined;
    readonly valueLocationReference?: number;
}

export interface IExpression extends IExpressionContainer {
    name: string;
}

export interface IDebugger {
    readonly type: string;
    createDebugAdapter(session: IDebugSession): Promise<IDebugAdapter>;
    runInTerminal(args: DebugProtocol.RunInTerminalRequestArguments, sessionId: string): Promise<number | undefined>;
    startDebugging(args: IConfig, parentSessionId: string): Promise<boolean>;
    getInitialConfigurationContent(initialConfigs?: IConfig[]): Promise<string>;
}

export interface IDebuggerMetadata {
    label: string;
    type: string;
    strings?: Record<DebuggerString, string>;
    interestedInLanguage(languageId: string): boolean;
}

// Const objects, not upstream's `const enum`s: erasable syntax only.
export const State = {
    Inactive: 0,
    Initializing: 1,
    Stopped: 2,
    Running: 3,
} as const;
export type State = (typeof State)[keyof typeof State];

export function getStateLabel(state: State): string {
    switch (state) {
        case State.Initializing:
            return "initializing";
        case State.Stopped:
            return "stopped";
        case State.Running:
            return "running";
        default:
            return "inactive";
    }
}

export interface AdapterEndEvent {
    error?: Error;
    /**
     * Diode: the adapter went away by itself — an error, or an exit with a code other than 0 — before the session
     * shut it down (`error` is set only when it also failed to stop). Upstream ends such a session silently; diode
     * writes it to the Debug Console.
     */
    failure?: Error;
    sessionLengthInSeconds: number;
    emittedStopped: boolean;
}

export interface LoadedSourceEvent {
    reason: "new" | "changed" | "removed";
    source: Source;
}

export type IDebugSessionReplMode = "separate" | "mergeWithParent";

export interface IDebugSessionOptions {
    noDebug?: boolean;
    parentSession?: IDebugSession;
    lifecycleManagedByParent?: boolean;
    repl?: IDebugSessionReplMode;
    compact?: boolean;
    startedByUser?: boolean;
    saveBeforeRestart?: boolean;
    suppressDebugToolbar?: boolean;
    suppressDebugStatusbar?: boolean;
    suppressDebugView?: boolean;
    compoundRoot?: DebugCompoundRoot;
}

export interface IDataBreakpointInfoResponse {
    dataId: string | null;
    description: string;
    canPersist?: boolean;
    accessTypes?: DebugProtocol.DataBreakpointAccessType[];
}

/** Upstream `severity` of `base/common/severity.ts`. */
export type ReplSeverity = "ignore" | "info" | "warning" | "error";

/** Data that can be inserted in {@link IDebugSession.appendToRepl} */
export interface INewReplElementData {
    /**
     * Output string to display
     */
    output: string;

    /**
     * Expression data to display. Will result in the item being expandable in
     * the REPL. Its value will be used if {@link output} is not provided.
     */
    expression?: IExpression;

    /**
     * Output severity.
     */
    sev: ReplSeverity;

    /**
     * Originating location.
     */
    source?: IReplElementSource;
}

export interface IDebugEvaluatePosition {
    line: number;
    column: number;
    source: DebugProtocol.Source;
}

export interface IDebugLocationReferenced {
    line: number;
    column: number;
    endLine?: number;
    endColumn?: number;
    source: Source;
}

export interface IDebugSession extends ITreeElement, IDisposable {
    readonly configuration: IConfig;
    readonly unresolvedConfiguration: IConfig | undefined;
    readonly state: State;
    readonly root: IWorkspaceFolder | undefined;
    readonly parentSession: IDebugSession | undefined;
    readonly subId: string | undefined;
    readonly compact: boolean;
    readonly saveBeforeRestart: boolean;
    readonly name: string;
    readonly autoExpandLazyVariables: boolean;
    readonly suppressDebugToolbar: boolean;
    readonly suppressDebugStatusbar: boolean;
    readonly suppressDebugView: boolean;
    readonly lifecycleManagedByParent: boolean;

    setSubId(subId: string | undefined): void;

    setName(name: string): void;
    readonly onDidChangeName: Event<string>;
    getLabel(): string;

    getSourceForUri(modelUri: uri): Source | undefined;
    getSource(raw?: DebugProtocol.Source): Source;

    setConfiguration(configuration: { resolved: IConfig; unresolved: IConfig | undefined }): void;
    rawUpdate(data: IRawModelUpdate): void;

    getThread(threadId: number): IThread | undefined;
    getAllThreads(): IThread[];
    clearThreads(removeThreads: boolean, reference?: number): void;
    getStoppedDetails(): IRawStoppedDetails | undefined;

    getReplElements(): IReplElement[];
    hasSeparateRepl(): boolean;
    removeReplExpressions(): void;
    addReplExpression(stackFrame: IStackFrame | undefined, name: string): Promise<void>;
    appendToRepl(data: INewReplElementData): void;

    // session events
    readonly onDidEndAdapter: Event<AdapterEndEvent | undefined>;
    readonly onDidChangeState: Event<void>;
    readonly onDidChangeReplElements: Event<IReplElement | undefined>;

    /** DA capabilities. Set only when there is a running session available. */
    readonly capabilities: DebugProtocol.Capabilities;
    /** DA capabilities. These are retained on the session even after is implementation ends. */
    readonly rememberedCapabilities?: DebugProtocol.Capabilities;

    // DAP events

    readonly onDidLoadedSource: Event<LoadedSourceEvent>;
    readonly onDidCustomEvent: Event<DebugProtocol.Event>;
    readonly onDidProgressStart: Event<DebugProtocol.ProgressStartEvent>;
    readonly onDidProgressUpdate: Event<DebugProtocol.ProgressUpdateEvent>;
    readonly onDidProgressEnd: Event<DebugProtocol.ProgressEndEvent>;
    readonly onDidInvalidateMemory: Event<DebugProtocol.MemoryEvent>;

    // DAP request

    initialize(dbgr: IDebugger): Promise<void>;
    launchOrAttach(config: IConfig): Promise<void>;
    restart(): Promise<void>;
    terminate(restart?: boolean /* false */): Promise<void>;
    disconnect(restart?: boolean /* false */, suspend?: boolean): Promise<void>;

    sendBreakpoints(modelUri: uri, bpts: IBreakpoint[], sourceModified: boolean): Promise<void>;
    sendFunctionBreakpoints(fbps: IFunctionBreakpoint[]): Promise<void>;
    dataBreakpointInfo(
        name: string,
        variablesReference?: number,
        frameId?: number,
    ): Promise<IDataBreakpointInfoResponse | undefined>;
    dataBytesBreakpointInfo(address: string, bytes: number): Promise<IDataBreakpointInfoResponse | undefined>;
    sendDataBreakpoints(dbps: IDataBreakpoint[]): Promise<void>;
    sendInstructionBreakpoints(dbps: IInstructionBreakpoint[]): Promise<void>;
    sendExceptionBreakpoints(exbpts: IExceptionBreakpoint[]): Promise<void>;
    breakpointsLocations(uri: uri, lineNumber: number): Promise<IPosition[]>;
    getDebugProtocolBreakpoint(breakpointId: string): DebugProtocol.Breakpoint | undefined;
    resolveLocationReference(locationReference: number): Promise<IDebugLocationReferenced>;

    stackTrace(
        threadId: number,
        startFrame: number,
        levels: number,
        token: CancellationToken,
    ): Promise<DebugProtocol.StackTraceResponse | undefined>;
    exceptionInfo(threadId: number): Promise<IExceptionInfo | undefined>;
    scopes(frameId: number, threadId: number): Promise<DebugProtocol.ScopesResponse | undefined>;
    variables(
        variablesReference: number,
        threadId: number | undefined,
        filter: "indexed" | "named" | undefined,
        start: number | undefined,
        count: number | undefined,
    ): Promise<DebugProtocol.VariablesResponse | undefined>;
    evaluate(
        expression: string,
        frameId?: number,
        context?: string,
        location?: IDebugEvaluatePosition,
    ): Promise<DebugProtocol.EvaluateResponse | undefined>;
    customRequest(request: string, args: unknown): Promise<DebugProtocol.Response | undefined>;
    cancel(progressId: string): Promise<DebugProtocol.CancelResponse | undefined>;
    disassemble(
        memoryReference: string,
        offset: number,
        instructionOffset: number,
        instructionCount: number,
    ): Promise<DebugProtocol.DisassembledInstruction[] | undefined>;
    readMemory(
        memoryReference: string,
        offset: number,
        count: number,
    ): Promise<DebugProtocol.ReadMemoryResponse | undefined>;
    writeMemory(
        memoryReference: string,
        offset: number,
        data: string,
        allowPartial?: boolean,
    ): Promise<DebugProtocol.WriteMemoryResponse | undefined>;

    restartFrame(frameId: number, threadId: number): Promise<void>;
    next(threadId: number, granularity?: DebugProtocol.SteppingGranularity): Promise<void>;
    stepIn(threadId: number, targetId?: number, granularity?: DebugProtocol.SteppingGranularity): Promise<void>;
    stepInTargets(frameId: number): Promise<DebugProtocol.StepInTarget[] | undefined>;
    stepOut(threadId: number, granularity?: DebugProtocol.SteppingGranularity): Promise<void>;
    stepBack(threadId: number, granularity?: DebugProtocol.SteppingGranularity): Promise<void>;
    continue(threadId: number): Promise<void>;
    reverseContinue(threadId: number): Promise<void>;
    pause(threadId: number): Promise<void>;
    terminateThreads(threadIds: number[]): Promise<void>;

    completions(
        frameId: number | undefined,
        threadId: number,
        text: string,
        position: Position,
        token: CancellationToken,
    ): Promise<DebugProtocol.CompletionsResponse | undefined>;
    setVariable(
        variablesReference: number | undefined,
        name: string,
        value: string,
    ): Promise<DebugProtocol.SetVariableResponse | undefined>;
    setExpression(
        frameId: number,
        expression: string,
        value: string,
    ): Promise<DebugProtocol.SetExpressionResponse | undefined>;
    loadSource(resource: uri): Promise<DebugProtocol.SourceResponse | undefined>;
    getLoadedSources(): Promise<Source[]>;

    gotoTargets(
        source: DebugProtocol.Source,
        line: number,
        column?: number,
    ): Promise<DebugProtocol.GotoTargetsResponse | undefined>;
    goto(threadId: number, targetId: number): Promise<DebugProtocol.GotoResponse | undefined>;
}

export interface IThread extends ITreeElement {
    /**
     * Process the thread belongs to
     */
    readonly session: IDebugSession;

    /**
     * Id of the thread generated by the debug adapter backend.
     */
    readonly threadId: number;

    /**
     * Name of the thread.
     */
    readonly name: string;

    /**
     * Information about the current thread stop event. Undefined if thread is not stopped.
     */
    readonly stoppedDetails: IRawStoppedDetails | undefined;

    /**
     * Information about the exception if an 'exception' stopped event raised and DA supports the 'exceptionInfo' request, otherwise undefined.
     */
    readonly exceptionInfo: Promise<IExceptionInfo | undefined>;

    readonly stateLabel: string;

    /**
     * Gets the callstack if it has already been received from the debug
     * adapter.
     */
    getCallStack(): readonly IStackFrame[];

    /**
     * Gets the top stack frame that is not hidden if the callstack has already been received from the debug adapter
     */
    getTopStackFrame(): IStackFrame | undefined;

    /**
     * Invalidates the callstack cache
     */
    clearCallStack(): void;

    /**
     * Indicates whether this thread is stopped. The callstack for stopped
     * threads can be retrieved from the debug adapter.
     */
    readonly stopped: boolean;

    next(granularity?: DebugProtocol.SteppingGranularity): Promise<void>;
    stepIn(granularity?: DebugProtocol.SteppingGranularity): Promise<void>;
    stepOut(granularity?: DebugProtocol.SteppingGranularity): Promise<void>;
    stepBack(granularity?: DebugProtocol.SteppingGranularity): Promise<void>;
    continue(): Promise<void>;
    pause(): Promise<void>;
    terminate(): Promise<void>;
    reverseContinue(): Promise<void>;
}

export interface IScope extends IExpressionContainer {
    readonly name: string;
    readonly expensive: boolean;
    readonly range?: IRange;
    readonly hasChildren: boolean;
    readonly childrenHaveBeenLoaded: boolean;
}

export interface IStackFrame extends ITreeElement {
    readonly thread: IThread;
    readonly name: string;
    readonly presentationHint: string | undefined;
    readonly frameId: number;
    readonly range: IRange;
    readonly source: Source;
    readonly canRestart: boolean;
    readonly instructionPointerReference?: string;
    getScopes(): Promise<IScope[]>;
    getMostSpecificScopes(range: IRange): Promise<readonly IScope[]>;
    forgetScopes(): void;
    restart(): Promise<void>;
    toString(): string;
    equals(other: IStackFrame): boolean;
}

export function isFrameDeemphasized(frame: IStackFrame): boolean {
    const hint = frame.presentationHint ?? frame.source.presentationHint;
    return hint === "deemphasize" || hint === "subtle";
}

export interface IEnablement extends ITreeElement {
    readonly enabled: boolean;
}

export interface IBreakpointData {
    readonly id?: string;
    readonly lineNumber: number;
    readonly column?: number;
    readonly enabled?: boolean;
    readonly condition?: string;
    readonly logMessage?: string;
    readonly hitCondition?: string;
    readonly triggeredBy?: string;
    readonly mode?: string;
    readonly modeLabel?: string;
}

export interface IBreakpointUpdateData {
    readonly condition?: string;
    readonly hitCondition?: string;
    readonly logMessage?: string;
    readonly lineNumber?: number;
    readonly column?: number;
    readonly triggeredBy?: string;
    readonly mode?: string;
    readonly modeLabel?: string;
}

export interface IBaseBreakpoint extends IEnablement {
    readonly condition?: string;
    readonly hitCondition?: string;
    readonly logMessage?: string;
    readonly verified: boolean;
    readonly supported: boolean;
    readonly message?: string;
    /** The preferred mode of the breakpoint from {@link DebugProtocol.BreakpointMode} */
    readonly mode?: string;
    /** The preferred mode label of the breakpoint from {@link DebugProtocol.BreakpointMode} */
    readonly modeLabel?: string;
    readonly sessionsThatVerified: string[];
    getIdFromAdapter(sessionId: string): number | undefined;
}

export interface IBreakpoint extends IBaseBreakpoint {
    /** URI where the breakpoint was first set by the user. */
    readonly originalUri: uri;
    /** URI where the breakpoint is currently shown; may be moved by debugger */
    readonly uri: uri;
    readonly lineNumber: number;
    readonly endLineNumber?: number;
    readonly column?: number;
    readonly endColumn?: number;
    readonly adapterData: unknown;
    readonly sessionAgnosticData: { lineNumber: number; column: number | undefined };
    /** An ID of the breakpoint that triggers this breakpoint. */
    readonly triggeredBy?: string;
    /** Pending on the trigger breakpoint, which means this breakpoint is not yet sent to DA */
    readonly pending: boolean;

    /** Marks that a session did trigger the breakpoint. */
    setSessionDidTrigger(sessionId: string, didTrigger?: boolean): void;
    /** Gets whether the `triggeredBy` condition has been met in the given sesison ID. */
    getSessionDidTrigger(sessionId: string): boolean;

    toDAP(): DebugProtocol.SourceBreakpoint;
}

export interface IFunctionBreakpoint extends IBaseBreakpoint {
    readonly name: string;
    toDAP(): DebugProtocol.FunctionBreakpoint;
}

export interface IExceptionBreakpoint extends IBaseBreakpoint {
    readonly filter: string;
    readonly label: string;
    readonly description: string | undefined;
}

export const DataBreakpointSetType = {
    Variable: 0,
    Address: 1,
} as const;
export type DataBreakpointSetType = (typeof DataBreakpointSetType)[keyof typeof DataBreakpointSetType];

/**
 * Source for a data breakpoint. A data breakpoint on a variable always has a
 * `dataId` because it cannot reference that variable globally, but addresses
 * can request info repeated and use session-specific data.
 */
export type DataBreakpointSource =
    | { type: typeof DataBreakpointSetType.Variable; dataId: string }
    | { type: typeof DataBreakpointSetType.Address; address: string; bytes: number };

export interface IDataBreakpoint extends IBaseBreakpoint {
    readonly description: string;
    readonly canPersist: boolean;
    readonly src: DataBreakpointSource;
    readonly accessType: DebugProtocol.DataBreakpointAccessType;
    toDAP(session: IDebugSession): Promise<DebugProtocol.DataBreakpoint | undefined>;
}

export interface IInstructionBreakpoint extends IBaseBreakpoint {
    readonly instructionReference: string;
    readonly offset?: number;
    /** Original instruction memory address; display purposes only */
    readonly address: bigint;
    toDAP(): DebugProtocol.InstructionBreakpoint;
}

export interface IExceptionInfo {
    readonly id?: string;
    readonly description?: string;
    readonly breakMode: string | null;
    readonly details?: DebugProtocol.ExceptionDetails;
}

// model interfaces

export interface IViewModel extends ITreeElement {
    /**
     * Returns the focused debug session or undefined if no session is stopped.
     */
    readonly focusedSession: IDebugSession | undefined;

    /**
     * Returns the focused thread or undefined if no thread is stopped.
     */
    readonly focusedThread: IThread | undefined;

    /**
     * Returns the focused stack frame or undefined if there are no stack frames.
     */
    readonly focusedStackFrame: IStackFrame | undefined;

    getSelectedExpression(): { expression: IExpression; settingWatch: boolean } | undefined;
    setSelectedExpression(expression: IExpression | undefined, settingWatch: boolean): void;
    updateViews(): void;

    isMultiSessionView(): boolean;

    readonly onDidFocusSession: Event<IDebugSession | undefined>;
    readonly onDidFocusThread: Event<{
        thread: IThread | undefined;
        explicit: boolean;
        session: IDebugSession | undefined;
    }>;
    readonly onDidFocusStackFrame: Event<{
        stackFrame: IStackFrame | undefined;
        explicit: boolean;
        session: IDebugSession | undefined;
    }>;
    readonly onDidSelectExpression: Event<{ expression: IExpression; settingWatch: boolean } | undefined>;
    readonly onDidEvaluateLazyExpression: Event<IExpressionContainer>;
    readonly onWillUpdateViews: Event<void>;

    evaluateLazyExpression(expression: IExpressionContainer): Promise<void>;
}

export interface IEvaluate {
    evaluate(session: IDebugSession, stackFrame: IStackFrame, context: string): Promise<void>;
}

export interface IDebugModel extends ITreeElement {
    getSession(sessionId: string | undefined, includeInactive?: boolean): IDebugSession | undefined;
    getSessions(includeInactive?: boolean): IDebugSession[];
    getBreakpoints(filter?: {
        uri?: uri;
        originalUri?: uri;
        lineNumber?: number;
        column?: number;
        enabledOnly?: boolean;
        triggeredOnly?: boolean;
    }): readonly IBreakpoint[];
    areBreakpointsActivated(): boolean;
    getFunctionBreakpoints(): readonly IFunctionBreakpoint[];
    getDataBreakpoints(): readonly IDataBreakpoint[];

    /**
     * Returns list of all exception breakpoints.
     */
    getExceptionBreakpoints(): readonly IExceptionBreakpoint[];

    /**
     * Returns list of exception breakpoints for the given session
     * @param sessionId Session id. If falsy, returns the breakpoints from the last set fallback session.
     */
    getExceptionBreakpointsForSession(sessionId?: string): readonly IExceptionBreakpoint[];

    getInstructionBreakpoints(): readonly IInstructionBreakpoint[];
    getWatchExpressions(): readonly (IExpression & IEvaluate)[];
    registerBreakpointModes(debugType: string, modes: DebugProtocol.BreakpointMode[]): void;
    getBreakpointModes(
        forBreakpointType: "source" | "exception" | "data" | "instruction",
    ): DebugProtocol.BreakpointMode[];
    readonly onDidChangeBreakpoints: Event<IBreakpointsChangeEvent | undefined>;
    readonly onDidChangeCallStack: Event<void>;
    /**
     * The expression has been added, removed, or repositioned.
     */
    readonly onDidChangeWatchExpressions: Event<IExpression | undefined>;
    /**
     * The expression's value has changed.
     */
    readonly onDidChangeWatchExpressionValue: Event<IExpression | undefined>;

    fetchCallstack(thread: IThread, levels?: number): Promise<void>;
}

/**
 * An event describing a change to the set of [breakpoints](#debug.Breakpoint).
 */
export interface IBreakpointsChangeEvent {
    added?: (IBreakpoint | IFunctionBreakpoint | IDataBreakpoint | IInstructionBreakpoint)[];
    removed?: (IBreakpoint | IFunctionBreakpoint | IDataBreakpoint | IInstructionBreakpoint)[];
    changed?: (IBreakpoint | IFunctionBreakpoint | IDataBreakpoint | IInstructionBreakpoint)[];
    sessionOnly: boolean;
}

// Debug configuration interfaces

export interface IDebugConfiguration {
    allowBreakpointsEverywhere: boolean;
    gutterMiddleClickAction: "logpoint" | "conditionalBreakpoint" | "triggeredBreakpoint" | "none";
    openDebug: "neverOpen" | "openOnSessionStart" | "openOnFirstSessionStart" | "openOnDebugBreak";
    openExplorerOnEnd: boolean;
    inlineValues: boolean | "auto" | "on" | "off"; // boolean for back-compat
    toolBarLocation: "floating" | "docked" | "commandCenter" | "hidden";
    showInStatusBar: "never" | "always" | "onFirstSessionStart";
    internalConsoleOptions: "neverOpen" | "openOnSessionStart" | "openOnFirstSessionStart";
    extensionHostDebugAdapter: boolean;
    enableAllHovers: boolean;
    showSubSessionsInToolBar: boolean;
    closeReadonlyTabsOnEnd: boolean;
    console: {
        fontSize: number;
        fontFamily: string;
        lineHeight: number;
        wordWrap: boolean;
        closeOnEnd: boolean;
        collapseIdenticalLines: boolean;
        historySuggestions: boolean;
        acceptSuggestionOnEnter: "off" | "on";
        maximumLines: number;
    };
    focusWindowOnBreak: boolean;
    focusEditorOnBreak: boolean;
    onTaskErrors: "debugAnyway" | "showErrors" | "prompt" | "abort";
    showBreakpointsInOverviewRuler: boolean;
    showInlineBreakpointCandidates: boolean;
    confirmOnExit: "always" | "never";
    disassemblyView: {
        showSourceCode: boolean;
    };
    autoExpandLazyVariables: "auto" | "off" | "on";
    enableStatusBarColor: boolean;
    showVariableTypes: boolean;
    hideSlowPreLaunchWarning: boolean;
}

export interface IGlobalConfig {
    version: string;
    compounds: ICompound[];
    configurations: IConfig[];
}

export interface IConfigPresentation {
    hidden?: boolean;
    group?: string;
    order?: number;
}

/** Upstream `ITaskIdentifier` of `contrib/tasks/common/tasks.ts`. */
export interface ITaskIdentifier {
    type: string;
    [name: string]: unknown;
}

interface IEnvConfig {
    internalConsoleOptions?: "neverOpen" | "openOnSessionStart" | "openOnFirstSessionStart";
    preRestartTask?: string | ITaskIdentifier;
    postRestartTask?: string | ITaskIdentifier;
    preLaunchTask?: string | ITaskIdentifier;
    postDebugTask?: string | ITaskIdentifier;
    debugServer?: number;
    noDebug?: boolean;
    suppressMultipleSessionWarning?: boolean;
    presentation?: IConfigPresentation;
}

export interface IConfig extends IEnvConfig {
    // fundamental attributes
    type: string;
    request: string;
    name: string;
    presentation?: IConfigPresentation;
    // platform specifics
    windows?: IEnvConfig;
    osx?: IEnvConfig;
    linux?: IEnvConfig;

    // internals
    __sessionId?: string;
    __restart?: unknown;
    __autoAttach?: boolean;
    __configurationTarget?: ConfigurationTarget;
    port?: number; // TODO
}

export interface ICompound {
    name: string;
    stopAll?: boolean;
    preLaunchTask?: string | ITaskIdentifier;
    configurations: (string | { name: string; folder: string })[];
    presentation?: IConfigPresentation;
}

export function isDebugConfig(thing: IConfig | ICompound): thing is IConfig {
    return "type" in thing && "request" in thing;
}

export interface IDebugAdapter extends IDisposable {
    readonly onError: Event<Error>;
    readonly onExit: Event<number | null>;
    onRequest(callback: (request: DebugProtocol.Request) => void): void;
    onEvent(callback: (event: DebugProtocol.Event) => void): void;
    startSession(): Promise<void>;
    sendMessage(message: DebugProtocol.ProtocolMessage): void;
    sendResponse(response: DebugProtocol.Response): void;
    sendRequest(
        command: string,
        args: unknown,
        clb: (result: DebugProtocol.Response) => void,
        timeout?: number,
    ): number;
    stopSession(): Promise<void>;
}

export interface IDebugAdapterFactory {
    createDebugAdapter(session: IDebugSession): IDebugAdapter;
    substituteVariables(folder: IWorkspaceFolder | undefined, config: IConfig): Promise<IConfig>;
}

/**
 * Upstream's `resolveWithInteractionReplace(folder, config, 'launch', variables, target)`: every variable of the
 * configuration, `${command:…}` through the debugger's `variables` aliases and `${input:…}` from the `inputs` of the
 * file the configuration comes from (its `__configurationTarget`). `undefined` — the user cancelled.
 */
export type IDebugVariableResolver = (
    folder: IWorkspaceFolder | undefined,
    config: IConfig,
    variables: Readonly<Record<string, string>> | undefined,
) => Promise<IConfig | undefined>;

/** Upstream's `DebugConfigurationProviderTriggerKind` (the values of `vscode.DebugConfigurationProviderTriggerKind`). */
export const DebugConfigurationProviderTriggerKind = {
    /** Asked for the configurations of a new launch.json. */
    Initial: 1,
    /** Asked for configurations to pick among (Select and Start Debugging). */
    Dynamic: 2,
} as const;
export type DebugConfigurationProviderTriggerKind =
    (typeof DebugConfigurationProviderTriggerKind)[keyof typeof DebugConfigurationProviderTriggerKind];

/** A `vscode.DebugConfigurationProvider` of an extension; only the methods it implements are here. */
export interface IDebugConfigurationProvider {
    readonly type: string;
    readonly triggerKind: DebugConfigurationProviderTriggerKind;
    resolveDebugConfiguration?(
        folderUri: uri | undefined,
        debugConfiguration: IConfig,
        token: CancellationToken,
    ): Promise<IConfig | null | undefined>;
    resolveDebugConfigurationWithSubstitutedVariables?(
        folderUri: uri | undefined,
        debugConfiguration: IConfig,
        token: CancellationToken,
    ): Promise<IConfig | null | undefined>;
    provideDebugConfigurations?(folderUri: uri | undefined, token: CancellationToken): Promise<IConfig[]>;
}

export interface IDebugAdapterExecutableOptions {
    cwd?: string;
    env?: Record<string, string>;
}

export interface IDebugAdapterExecutable {
    readonly type: "executable";
    readonly command: string;
    readonly args: string[];
    readonly options?: IDebugAdapterExecutableOptions;
}

export interface IDebugAdapterServer {
    readonly type: "server";
    readonly port: number;
    readonly host?: string;
}

export interface IDebugAdapterNamedPipeServer {
    readonly type: "pipeServer";
    readonly path: string;
}

export interface IDebugAdapterInlineImpl extends IDisposable {
    readonly onDidSendMessage: Event<DebugProtocol.Message>;
    handleMessage(message: DebugProtocol.Message): void;
}

export interface IDebugAdapterImpl {
    readonly type: "implementation";
}

export type IAdapterDescriptor =
    | IDebugAdapterExecutable
    | IDebugAdapterServer
    | IDebugAdapterNamedPipeServer
    | IDebugAdapterImpl;

export interface IPlatformSpecificAdapterContribution {
    program?: string;
    args?: string[];
    runtime?: string;
    runtimeArgs?: string[];
}

export interface IDebuggerContribution extends IPlatformSpecificAdapterContribution {
    type: string;
    label?: string;
    win?: IPlatformSpecificAdapterContribution;
    winx86?: IPlatformSpecificAdapterContribution;
    windows?: IPlatformSpecificAdapterContribution;
    osx?: IPlatformSpecificAdapterContribution;
    linux?: IPlatformSpecificAdapterContribution;

    // internal
    aiKey?: string;

    // supported languages
    languages?: string[];

    // debug configuration support; upstream types the schemas as `IJSONSchema`/`IJSONSchemaSnippet`
    configurationAttributes?: Record<string, unknown>;
    initialConfigurations?: unknown[];
    configurationSnippets?: unknown[];
    variables?: Record<string, string>;
    when?: string;
    hiddenWhen?: string;
    deprecated?: string;
    strings?: Record<DebuggerString, string>;
    /** @deprecated */
    uiMessages?: Record<DebuggerString, string>;
}

export interface IBreakpointContribution {
    language: string;
    when?: string;
}

export interface IDebugAdapterDescriptorFactory {
    readonly type: string;
    createDebugAdapterDescriptor(session: IDebugSession): Promise<IAdapterDescriptor>;
}

/**
 * Ours: where the adapter's `runInTerminal` reverse request runs. Upstream's adapter factory (the extension host)
 * answers it through `vscode.window` terminals; the terminals are the core's here, so the core answers it.
 */
export interface IDebugTerminalLauncher {
    runInTerminal(
        args: DebugProtocol.RunInTerminalRequestArguments,
        session: IDebugSession,
    ): Promise<number | undefined>;
}

/** Upstream `enum DebuggerString`: only its value is used, as a key of `strings`. */
export type DebuggerString = "unverifiedBreakpoints";

/** Upstream's `{ editor, created }`: `opened` stands for a non-null editor. */
export interface IOpenConfigFileResult {
    readonly opened: boolean;
    readonly created: boolean;
}

export interface ILaunch {
    /** Resource pointing to the launch.json this object is wrapping. */
    readonly uri: uri;

    /** Name of the launch. */
    readonly name: string;

    /** Workspace of the launch. Can be undefined. */
    readonly workspace: IWorkspaceFolder | undefined;

    /** Should this launch be shown in the debug dropdown. */
    readonly hidden: boolean;

    /** Returns a configuration with the specified name. Returns undefined if there is no configuration with the specified name. */
    getConfiguration(name: string): IConfig | undefined;

    /** Returns a compound with the specified name. Returns undefined if there is no compound with the specified name. */
    getCompound(name: string): ICompound | undefined;

    /** Returns the names of all configurations and compounds. Ignores configurations which are invalid. */
    getConfigurationNames(ignoreCompoundsAndPresentation?: boolean): string[];

    /**
     * Opens the launch.json file. Creates if it does not exist. Upstream gives back the editor pane; ours tells
     * whether one was opened.
     */
    openConfigFile(options: {
        preserveFocus: boolean;
        type?: string;
        suppressInitialConfigs?: boolean;
    }): Promise<IOpenConfigFileResult>;
}

/** Upstream `IConfigurationManager`, without the dynamic configurations of Select and Start Debugging. */
export interface IConfigurationManager {
    /** Returns an object containing the selected launch configuration and the selected configuration name. */
    readonly selectedConfiguration: {
        launch: ILaunch | undefined;
        getConfig: () => Promise<IConfig | undefined>;
        name: string | undefined;
        /** Only dynamic configurations have a type set (not here yet: the dynamic configurations of Select and Start Debugging). */
        type: string | undefined;
    };

    selectConfiguration(launch: ILaunch | undefined, name?: string, config?: IConfig): Promise<void>;

    getLaunches(): readonly ILaunch[];
    getLaunch(workspaceUri: uri | undefined): ILaunch | undefined;
    getAllConfigurations(): { launch: ILaunch; name: string; presentation?: IConfigPresentation }[];

    /** Allows to register on change of selected debug configuration. */
    readonly onDidSelectConfiguration: Event<void>;

    readonly onDidChangeConfigurationProviders: Event<void>;

    registerDebugConfigurationProvider(debugConfigurationProvider: IDebugConfigurationProvider): IDisposable;
    /** If no trigger kind is given, `Initial` is assumed. */
    hasDebugConfigurationProvider(debugType: string, triggerKind?: DebugConfigurationProviderTriggerKind): boolean;
    /**
     * The providers of the type, then the `*` ones; again when a provider changed the type. `undefined` aborts the
     * launch, `null` aborts it and opens launch.json.
     */
    resolveConfigurationByProviders(
        folderUri: uri | undefined,
        type: string | undefined,
        config: IConfig,
        token: CancellationToken,
    ): Promise<IConfig | null | undefined>;
    resolveDebugConfigurationWithSubstitutedVariables(
        folderUri: uri | undefined,
        type: string | undefined,
        config: IConfig,
        token: CancellationToken,
    ): Promise<IConfig | null | undefined>;
    /** The `Initial` providers of the type: the configurations of a new launch.json. */
    provideDebugConfigurations(folderUri: uri | undefined, type: string, token: CancellationToken): Promise<IConfig[]>;
}

/** Upstream `IAdapterManager`: where the debuggers and the adapters of a debug type are registered. */
export interface IAdapterManager {
    readonly onDidRegisterDebugger: Event<void>;
    hasEnabledDebuggers(): boolean;
    getDebugger(type: string): (IDebugger & IDebuggerMetadata) | undefined;
    /**
     * Ours: the `debuggers` extension point of upstream's adapter manager as a call — `contributes.debuggers` of
     * extensions (`bindExtensionDebuggers`) and the tests register a debug type through it.
     */
    registerDebugger(contribution: IDebuggerContribution): IDisposable;
    /** Ours, like `registerDebugger`: one `contributes.breakpoints` entry of an extension. */
    registerBreakpoints(contribution: IBreakpointContribution): IDisposable;
    /** Upstream takes the text model: here its language. */
    canSetBreakpointsIn(languageId: string): boolean;
    /** Ours: `canSetBreakpointsIn` or `hasEnabledDebuggers` may answer differently (not for a `debug.*` setting). */
    readonly onDidChangeCanSetBreakpoints: Event<void>;
    /** `activationEvent`, `onDebug` and, with a type, `activationEvent:type` — all awaited. */
    activateDebuggers(activationEvent: string, debugType?: string): Promise<void>;
    registerDebugAdapterFactory(debugTypes: string[], debugAdapterFactory: IDebugAdapterFactory): IDisposable;
    createDebugAdapter(session: IDebugSession): IDebugAdapter | undefined;
    substituteVariables(debugType: string, folder: IWorkspaceFolder | undefined, config: IConfig): Promise<IConfig>;
    /** Upstream also takes the debug type, to ask that type's adapter factory: here the core answers for all types. */
    runInTerminal(args: DebugProtocol.RunInTerminalRequestArguments, sessionId: string): Promise<number | undefined>;
}

/** Upstream `IDebugService`, the part the sessions and the commands of this layer use. */
export interface IDebugService {
    /** Gets the current debug state. */
    readonly state: State;
    readonly initializingOptions?: IDebugSessionOptions | undefined;
    readonly onDidChangeState: Event<State>;
    /** Before the session is launched: it is in the model already. Extensions hear its custom events from here on. */
    readonly onWillNewSession: Event<IDebugSession>;
    /** The session answered `launch`/`attach`. */
    readonly onDidNewSession: Event<IDebugSession>;
    readonly onDidEndSession: Event<{ session: IDebugSession; restart: boolean }>;

    getAdapterManager(): IAdapterManager;
    getConfigurationManager(): IConfigurationManager;
    getModel(): IDebugModel;
    getViewModel(): IViewModel;

    /** Sets the focused stack frame and evaluates all expressions against the newly focused stack frame. */
    focusStackFrame(
        focusedStackFrame: IStackFrame | undefined,
        thread?: IThread,
        session?: IDebugSession,
        options?: { explicit?: boolean; preserveFocus?: boolean; sideBySide?: boolean; pinned?: boolean },
    ): Promise<void>;

    setExceptionBreakpointsForSession(
        session: IDebugSession,
        filters: DebugProtocol.ExceptionBreakpointsFilter[],
    ): void;

    /** The source of the uri cannot be loaded: its frames are not opened again. */
    sourceIsNotAvailable(uri: uri): void;

    /** Upstream takes the text model: here its language. */
    canSetBreakpointsIn(languageId: string): boolean;

    /** Updates the breakpoints; with `sendOnResourceSaved` they go to the adapters when the file is saved. */
    updateBreakpoints(uri: uri, data: Map<string, IBreakpointUpdateData>, sendOnResourceSaved: boolean): Promise<void>;
    sendAllBreakpoints(session?: IDebugSession): Promise<void>;
    sendBreakpoints(modelUri: uri, sourceModified?: boolean, session?: IDebugSession): Promise<void>;

    /** Adds new breakpoints to the model for the file specified with the uri. Notifies debug adapter of breakpoint changes. */
    addBreakpoints(uri: uri, rawBreakpoints: IBreakpointData[]): Promise<IBreakpoint[]>;

    /**
     * Enables or disables all breakpoints. If breakpoint is passed only enables or disables the passed breakpoint.
     * Notifies debug adapter of breakpoint changes.
     */
    enableOrDisableBreakpoints(enable: boolean, breakpoint?: IEnablement): Promise<void>;

    /**
     * Sets the global activated property for all breakpoints.
     * Notifies debug adapter of breakpoint changes.
     */
    setBreakpointsActivated(activated: boolean): Promise<void>;

    /**
     * Removes all breakpoints. If id is passed only removes the breakpoint associated with that id.
     * Notifies debug adapter of breakpoint changes.
     */
    removeBreakpoints(id?: string | string[]): Promise<void>;

    /**
     * Adds a new function breakpoint for the given name.
     */
    addFunctionBreakpoint(opts?: IFunctionBreakpointOptions, id?: string): Promise<void>;

    /**
     * Removes all function breakpoints. If id is passed only removes the function breakpoint with the passed id.
     * Notifies debug adapter of breakpoint changes.
     */
    removeFunctionBreakpoints(id?: string): Promise<void>;

    /**
     * Updates an already existing function breakpoint.
     * Notifies debug adapter of breakpoint changes.
     */
    updateFunctionBreakpoint(
        id: string,
        update: { name?: string; hitCondition?: string; condition?: string },
    ): Promise<void>;

    /**
     * Adds a new data breakpoint.
     */
    addDataBreakpoint(opts: IDataBreakpointOptions): Promise<void>;

    /**
     * Updates an already existing data breakpoint.
     * Notifies debug adapter of breakpoint changes.
     */
    updateDataBreakpoint(id: string, update: { hitCondition?: string; condition?: string }): Promise<void>;

    /**
     * Removes all data breakpoints. If id is passed only removes the data breakpoint with the passed id.
     * Notifies debug adapter of breakpoint changes.
     */
    removeDataBreakpoints(id?: string): Promise<void>;

    /**
     * Removes the instruction breakpoints at the reference (and the `offset` when specified). When no arguments are
     * provided, all instruction breakpoints are removed. Notifies the debug adapter of breakpoint changes.
     */
    removeInstructionBreakpoints(instructionReference?: string, offset?: number, address?: bigint): Promise<void>;

    /**
     * Adds a new instruction breakpoint.
     */
    addInstructionBreakpoint(opts: IInstructionBreakpointOptions): Promise<void>;

    /**
     * Sets the condition of an exception breakpoint and sends the exception breakpoints to the adapters.
     */
    setExceptionBreakpointCondition(breakpoint: IExceptionBreakpoint, condition: string | undefined): Promise<void>;

    /**
     * Adds a new watch expression and evaluates it against the debug adapter.
     */
    addWatchExpression(name?: string): void;

    /**
     * Renames a watch expression and evaluates it against the debug adapter.
     */
    renameWatchExpression(id: string, newName: string): void;

    /**
     * Moves a watch expression to a new possition. Used for reordering watch expressions.
     */
    moveWatchExpression(id: string, position: number): void;

    /**
     * Removes all watch expressions. If id is passed only removes the watch expression with the passed id.
     */
    removeWatchExpressions(id?: string): void;

    /**
     * Starts debugging. If the configOrName is not passed uses the selected configuration in the debug dropdown.
     * Also saves all files, manages if compounds are present in the configuration and resolves configurations
     * via DebugConfigurationProviders.
     *
     * Returns true if the start debugging was successful. For compound launches, all configurations have to be
     * started successfully for it to return success. On errors, startDebugging will throw an error, however some
     * error and cancelations are handled and in that case will simply return false.
     */
    startDebugging(
        launch: ILaunch | undefined,
        configOrName?: IConfig | string,
        options?: IDebugSessionOptions,
        saveBeforeStart?: boolean,
    ): Promise<boolean>;

    /** Restarts a session or creates a new one if there is no active session. */
    restartSession(session: IDebugSession, restartData?: unknown): Promise<void>;

    /** Stops the session. If no session is specified then all sessions are stopped. */
    stopSession(session: IDebugSession | undefined, disconnect?: boolean, suspend?: boolean): Promise<void>;
}
