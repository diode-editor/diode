/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/common/debug.ts
// The model's half of upstream `debug.ts`: the raw and model interfaces, `State`, breakpoints, launch
// configurations and the adapter contract. The `CONTEXT_*` keys are typed keys of `ContextKeyTypes`
// (platform/contextkey/common/contextKeys.ts) under the upstream names. Not here yet, each with the task that
// implements it: `IDebugService`, `IConfigurationManager`, `IAdapterManager`, `ILaunch`, the configuration providers
// (session, launch.json and `vscode.debug`),
// the editor contributions, `openInEditor` of frames and sources (with the editor service they need),
// compounds (`DebugCompoundRoot`), the test run a session is correlated with. Not planned: the memory view
// (`getMemory`, webview) and debug visualizers (proposed API).

import type { ICancellationToken as CancellationToken } from "../../../../base/common/cancellation.ts";
import type { Event } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import type { Uri as uri } from "../../../../base/common/uri.ts";
import type { IPosition, Position } from "../../../../editor/common/core/position.ts";
import type { IRange } from "../../../../editor/common/core/range.ts";
import type { IWorkspaceFolder } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";

import type { Source } from "./debugSource.ts";

export const DEBUG_SCHEME = "debug";

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

export interface IDebugAdapterFactory extends ITerminalLauncher {
    createDebugAdapter(session: IDebugSession): IDebugAdapter;
    substituteVariables(folder: IWorkspaceFolder | undefined, config: IConfig): Promise<IConfig>;
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

interface ITerminalLauncher {
    runInTerminal(args: DebugProtocol.RunInTerminalRequestArguments, sessionId: string): Promise<number | undefined>;
}

/** Upstream `enum DebuggerString`: only its value is used, as a key of `strings`. */
export type DebuggerString = "unverifiedBreakpoints";
