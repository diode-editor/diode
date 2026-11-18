/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/debugSession.ts
// Deviations: the services come in as one object, not by injection; the label is the name alone (one folder per
// window, upstream adds the folder only with several); `debug.autoExpandLazyVariables: auto` is off (no screen
// reader mode); breakpoint paths go out without the Windows drive-letter normalization. Not here yet, each with its
// task: the test run a session is correlated with (#1162). Not planned: telemetry, aria
// announcements, focusing the OS window on a break, the memory view (`getMemory`).

import { distinct } from "../../../../base/common/arrays.ts";
import { raceTimeout, RunOnceScheduler } from "../../../../base/common/async.ts";
import { CancellationTokenSource, type ICancellationToken } from "../../../../base/common/cancellation.ts";
import { CancellationError, isCancellationError } from "../../../../base/common/errorSerialization.ts";
import { Emitter, type Event } from "../../../../base/common/event.ts";
import { Lazy } from "../../../../base/common/lazy.ts";
import { Disposable, DisposableMap, DisposableStore, MutableDisposable } from "../../../../base/common/lifecycle.ts";
import type { Uri as URI } from "../../../../base/common/uri.ts";
import { generateUuid } from "../../../../base/common/uuid.ts";
import type { IPosition, Position } from "../../../../editor/common/core/position.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { IWorkspaceFolder } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import {
    type AdapterEndEvent,
    type IBreakpoint,
    type IConfig,
    type IDataBreakpoint,
    type IDataBreakpointInfoResponse,
    type IDebugConfiguration,
    type IDebugger,
    type IDebugLocationReferenced,
    type IDebugService,
    type IDebugSession,
    type IDebugSessionOptions,
    type IExceptionBreakpoint,
    type IExceptionInfo,
    type IFunctionBreakpoint,
    type IInstructionBreakpoint,
    type INewReplElementData,
    type IRawModelUpdate,
    type IRawStoppedDetails,
    type IReplElement,
    isFrameDeemphasized,
    type IStackFrame,
    type IThread,
    type LoadedSourceEvent,
    type ReplSeverity,
    State,
} from "../common/debug.ts";
import { type DebugModel, ExpressionContainer, Thread } from "../common/debugModel.ts";
import { Source } from "../common/debugSource.ts";
import { type IReplConsoleConfiguration, ReplModel } from "../common/replModel.ts";

import { bodyOf, type IRawDebugSessionNotifier, RawDebugSession } from "./rawDebugSession.ts";

const TRIGGERED_BREAKPOINT_MAX_DELAY = 1500;

/** What a session needs besides the debug service: where errors and `important` output go, its log, the console. */
/** The `debug.*` settings the service and its sessions read. */
export type IDebugServiceConfiguration = Pick<
    IDebugConfiguration,
    | "openDebug"
    | "autoExpandLazyVariables"
    | "internalConsoleOptions"
    | "allowBreakpointsEverywhere"
    | "focusEditorOnBreak"
    | "showSubSessionsInToolBar"
    | "openExplorerOnEnd"
    | "closeReadonlyTabsOnEnd"
> & { readonly console: Pick<IDebugConfiguration["console"], "closeOnEnd"> };

export interface IDebugSessionServices {
    readonly notifier: IRawDebugSessionNotifier & {
        notify(message: string, severity: ReplSeverity, source: string): void;
    };
    readonly logger: ILogger;
    readonly replConfiguration: () => IReplConsoleConfiguration;
    /** The `debug.*` settings of {@link IDebugServiceConfiguration}. */
    readonly debugConfiguration: () => IDebugServiceConfiguration;
    /** Shows Run and Debug without taking the focus (`openOnDebugBreak`). */
    readonly openViewlet: () => void;
}

function noDebugAdapter(what: string): Error {
    return new Error(`No debugger available, can not send '${what}'`);
}

/** Upstream `Queue<void>` of `base/common/async.ts`: the tasks run one after another, in the order queued. */
class Queue {
    private last: Promise<void> = Promise.resolve();

    public queue(task: () => Promise<void>): void {
        this.last = this.last.then(task, task);
    }
}

export class DebugSession implements IDebugSession {
    public parentSession: IDebugSession | undefined;
    public rememberedCapabilities?: DebugProtocol.Capabilities;

    private subIdValue: string | undefined;
    public raw: RawDebugSession | undefined;
    private initialized = false;
    private readonly options: IDebugSessionOptions;

    private readonly sources = new Map<string, Source>();
    private readonly threads = new Map<number, Thread>();
    // Stryker disable next-line ArrayDeclaration: ids read before the first update find no thread either way
    private threadIds: number[] = [];
    private readonly cancellationMap = new Map<number, CancellationTokenSource[]>();
    private readonly rawSubscriptions = new DisposableStore();
    private readonly globalDisposables = new DisposableStore();
    private readonly fetchThreadsScheduler = new Lazy(() => {
        const inst = new RunOnceScheduler(() => {
            void this.fetchThreads();
        }, 100);
        // Stryker disable next-line CallExpression: a scheduler left after the shutdown fetches nothing, there is no adapter
        this.rawSubscriptions.add(inst);
        return inst;
    });
    private readonly passFocusScheduler: RunOnceScheduler;
    private lastContinuedThreadId: number | undefined;
    private repl: ReplModel;
    private stoppedDetails: IRawStoppedDetails[] = [];
    private readonly statusQueue = this.rawSubscriptions.add(new ThreadStatusScheduler());

    private readonly onDidChangeStateEmitter = new Emitter<void>();
    private readonly onDidEndAdapterEmitter = new Emitter<AdapterEndEvent | undefined>();

    private readonly onDidLoadedSourceEmitter = new Emitter<LoadedSourceEvent>();
    private readonly onDidCustomEventEmitter = new Emitter<DebugProtocol.Event>();
    private readonly onDidProgressStartEmitter = new Emitter<DebugProtocol.ProgressStartEvent>();
    private readonly onDidProgressUpdateEmitter = new Emitter<DebugProtocol.ProgressUpdateEvent>();
    private readonly onDidProgressEndEmitter = new Emitter<DebugProtocol.ProgressEndEvent>();
    private readonly onDidInvalidMemoryEmitter = new Emitter<DebugProtocol.MemoryEvent>();

    private readonly onDidChangeReplElementsEmitter = new Emitter<IReplElement | undefined>();

    private nameValue: string | undefined;
    private readonly onDidChangeNameEmitter = new Emitter<string>();

    /**
     * Promise set while enabling dependent breakpoints to block the debugger
     * from continuing from a stopped state.
     */
    private waitToResume?: Promise<unknown>;

    public constructor(
        private readonly id: string,
        private configurationValue: { resolved: IConfig; unresolved: IConfig | undefined },
        public root: IWorkspaceFolder | undefined,
        private readonly model: DebugModel,
        options: IDebugSessionOptions | undefined,
        private readonly debugService: IDebugService,
        private readonly services: IDebugSessionServices,
    ) {
        this.options = options ?? {};
        this.parentSession = this.options.parentSession;
        this.repl = this.hasSeparateRepl()
            ? new ReplModel(services.replConfiguration)
            : (this.parentSession as DebugSession).repl;

        const toDispose = this.globalDisposables;
        const replListener = toDispose.add(new MutableDisposable());
        replListener.value = this.repl.onDidChangeElements((e) => {
            this.onDidChangeReplElementsEmitter.fire(e);
        });

        this.passFocusScheduler = new RunOnceScheduler(() => {
            this.passFocus();
        }, 800);

        const compoundRoot = this.options.compoundRoot;
        if (compoundRoot) {
            toDispose.add(
                compoundRoot.onDidSessionStop(() => {
                    void this.terminate();
                }),
            );
        }

        const parent = this.options.parentSession;
        if (parent) {
            toDispose.add(
                parent.onDidEndAdapter(() => {
                    // copy the parent repl and get a new detached repl for this child, and
                    // remove its parent, if it's still running
                    if (!this.hasSeparateRepl() && this.raw?.isInShutdown === false) {
                        this.repl = this.repl.clone();
                        replListener.value = this.repl.onDidChangeElements((e) => {
                            this.onDidChangeReplElementsEmitter.fire(e);
                        });
                        this.parentSession = undefined;
                    }
                }),
            );
        }
    }

    /** If there is some session or thread that is stopped pass focus to it. */
    private passFocus(): void {
        if (
            !this.debugService
                .getModel()
                .getSessions()
                .some((s) => s.state === State.Stopped) &&
            !this.getAllThreads().some((t) => t.stopped)
        ) {
            return;
        }
        if (typeof this.lastContinuedThreadId === "number") {
            const thread = this.debugService.getViewModel().focusedThread;
            if (thread?.threadId === this.lastContinuedThreadId && !thread.stopped) {
                const toFocusThreadId = this.getStoppedDetails()?.threadId;
                // Stryker disable next-line ConditionalExpression: a stop without a thread id finds no thread either way
                const toFocusThread = typeof toFocusThreadId === "number" ? this.getThread(toFocusThreadId) : undefined;
                void this.debugService.focusStackFrame(undefined, toFocusThread);
            }
        } else {
            const session = this.debugService.getViewModel().focusedSession;
            if (session?.getId() === this.getId() && session.state !== State.Stopped) {
                void this.debugService.focusStackFrame(undefined);
            }
        }
    }

    public getId(): string {
        return this.id;
    }

    public setSubId(subId: string | undefined): void {
        this.subIdValue = subId;
    }

    public get subId(): string | undefined {
        return this.subIdValue;
    }

    public get configuration(): IConfig {
        return this.configurationValue.resolved;
    }

    public get unresolvedConfiguration(): IConfig | undefined {
        return this.configurationValue.unresolved;
    }

    public get lifecycleManagedByParent(): boolean {
        return !!this.options.lifecycleManagedByParent;
    }

    public get compact(): boolean {
        return !!this.options.compact;
    }

    public get saveBeforeRestart(): boolean {
        return this.options.saveBeforeRestart ?? !this.options.parentSession;
    }

    public get suppressDebugStatusbar(): boolean {
        return this.options.suppressDebugStatusbar ?? false;
    }

    public get suppressDebugToolbar(): boolean {
        return this.options.suppressDebugToolbar ?? false;
    }

    public get suppressDebugView(): boolean {
        return this.options.suppressDebugView ?? false;
    }

    public get autoExpandLazyVariables(): boolean {
        // `auto` follows the screen reader optimized mode, which diode does not have.
        return this.services.debugConfiguration().autoExpandLazyVariables === "on";
    }

    public setConfiguration(configuration: { resolved: IConfig; unresolved: IConfig | undefined }): void {
        this.configurationValue = configuration;
    }

    public getLabel(): string {
        return this.name;
    }

    public setName(name: string): void {
        this.nameValue = name;
        this.onDidChangeNameEmitter.fire(name);
    }

    public get name(): string {
        return this.nameValue ?? this.configuration.name;
    }

    public get state(): State {
        if (!this.initialized) {
            return State.Initializing;
        }
        if (!this.raw) {
            return State.Inactive;
        }

        const focusedThread = this.debugService.getViewModel().focusedThread;
        if (focusedThread?.session === this) {
            return focusedThread.stopped ? State.Stopped : State.Running;
        }
        if (this.getAllThreads().some((t) => t.stopped)) {
            return State.Stopped;
        }

        return State.Running;
    }

    public get capabilities(): DebugProtocol.Capabilities {
        return this.raw ? this.raw.capabilities : {};
    }

    //---- events

    public get onDidChangeState(): Event<void> {
        return this.onDidChangeStateEmitter.event;
    }

    public get onDidEndAdapter(): Event<AdapterEndEvent | undefined> {
        return this.onDidEndAdapterEmitter.event;
    }

    public get onDidChangeReplElements(): Event<IReplElement | undefined> {
        return this.onDidChangeReplElementsEmitter.event;
    }

    public get onDidChangeName(): Event<string> {
        return this.onDidChangeNameEmitter.event;
    }

    //---- DAP events

    public get onDidCustomEvent(): Event<DebugProtocol.Event> {
        return this.onDidCustomEventEmitter.event;
    }

    public get onDidLoadedSource(): Event<LoadedSourceEvent> {
        return this.onDidLoadedSourceEmitter.event;
    }

    public get onDidProgressStart(): Event<DebugProtocol.ProgressStartEvent> {
        return this.onDidProgressStartEmitter.event;
    }

    public get onDidProgressUpdate(): Event<DebugProtocol.ProgressUpdateEvent> {
        return this.onDidProgressUpdateEmitter.event;
    }

    public get onDidProgressEnd(): Event<DebugProtocol.ProgressEndEvent> {
        return this.onDidProgressEndEmitter.event;
    }

    public get onDidInvalidateMemory(): Event<DebugProtocol.MemoryEvent> {
        return this.onDidInvalidMemoryEmitter.event;
    }

    //---- DAP requests

    /**
     * create and initialize a new debug adapter for this session
     */
    public async initialize(dbgr: IDebugger): Promise<void> {
        if (this.raw) {
            // if there was already a connection make sure to remove old listeners
            this.shutdown();
        }

        try {
            const debugAdapter = await dbgr.createDebugAdapter(this);
            this.raw = new RawDebugSession(
                debugAdapter,
                dbgr,
                this.id,
                this.configuration.name,
                this.services.notifier,
            );

            await this.raw.start();
            this.registerListeners(this.raw);
            await this.raw.initialize({
                clientID: "vscode",
                clientName: "Diode",
                adapterID: this.configuration.type,
                pathFormat: "path",
                linesStartAt1: true,
                columnsStartAt1: true,
                supportsVariableType: true, // #8858
                supportsVariablePaging: true, // #9537
                supportsRunInTerminalRequest: true, // #10574
                locale: "en", // #169114
                supportsProgressReporting: true, // #92253
                supportsInvalidatedEvent: true, // #106745
                supportsMemoryReferences: true, //#129684
                supportsArgsCanBeInterpretedByShell: true, // #149910
                supportsMemoryEvent: true, // #133643
                supportsStartDebuggingRequest: true,
                supportsANSIStyling: true,
            });

            this.initialized = true;
            this.onDidChangeStateEmitter.fire();
            this.rememberedCapabilities = this.raw.capabilities;
            this.debugService.setExceptionBreakpointsForSession(
                this,
                this.raw.capabilities.exceptionBreakpointFilters ?? [],
            );
            this.debugService
                .getModel()
                .registerBreakpointModes(this.configuration.type, this.raw.capabilities.breakpointModes ?? []);
        } catch (err) {
            this.initialized = true;
            this.onDidChangeStateEmitter.fire();
            this.shutdown();
            throw err;
        }
    }

    /**
     * launch or attach to the debuggee
     */
    public async launchOrAttach(config: IConfig): Promise<void> {
        if (!this.raw) {
            throw noDebugAdapter("launch or attach");
        }
        if (this.parentSession?.state === State.Inactive) {
            throw new CancellationError();
        }

        // __sessionID only used for EH debugging (but we add it always for now...)
        config.__sessionId = this.getId();
        try {
            await this.raw.launchOrAttach(config);
        } catch (err) {
            this.shutdown();
            throw err;
        }
    }

    /**
     * terminate the current debug adapter session
     */
    public async terminate(restart = false): Promise<void> {
        if (!this.raw) {
            // Adapter went down but it did not send a 'terminated' event, simulate like the event has been sent
            this.onDidExitAdapter();
        }

        this.cancelAllRequests();
        if (this.options.lifecycleManagedByParent && this.parentSession) {
            await this.parentSession.terminate(restart);
        } else if (this.raw) {
            if (this.raw.capabilities.supportsTerminateRequest && this.configuration.request === "launch") {
                await this.raw.terminate(restart);
            } else {
                await this.raw.disconnect({ restart, terminateDebuggee: true });
            }
        }

        if (!restart) {
            this.options.compoundRoot?.sessionStopped();
        }
    }

    /**
     * end the current debug adapter session
     */
    public async disconnect(restart = false, suspend = false): Promise<void> {
        if (!this.raw) {
            // Adapter went down but it did not send a 'terminated' event, simulate like the event has been sent
            this.onDidExitAdapter();
        }

        this.cancelAllRequests();
        if (this.options.lifecycleManagedByParent && this.parentSession) {
            await this.parentSession.disconnect(restart, suspend);
        } else if (this.raw) {
            // TODO terminateDebuggee should be undefined by default?
            await this.raw.disconnect({ restart, terminateDebuggee: false, suspendDebuggee: suspend });
        }

        if (!restart) {
            this.options.compoundRoot?.sessionStopped();
        }
    }

    /**
     * restart debug adapter session
     */
    public async restart(): Promise<void> {
        if (!this.raw) {
            throw noDebugAdapter("restart");
        }

        this.cancelAllRequests();
        if (this.options.lifecycleManagedByParent && this.parentSession) {
            await this.parentSession.restart();
        } else {
            await this.raw.restart({ arguments: this.configuration });
        }
    }

    /** The adapter's answer for each breakpoint, by the breakpoint's id, into the model. */
    private setBreakpointSessionData(
        breakpoints: readonly { getId(): string }[],
        response: { breakpoints: DebugProtocol.Breakpoint[] } | undefined,
    ): void {
        if (response) {
            const data = new Map<string, DebugProtocol.Breakpoint>();
            for (let i = 0; i < breakpoints.length; i++) {
                data.set(breakpoints[i].getId(), response.breakpoints[i]);
            }
            this.model.setBreakpointSessionData(this.getId(), this.capabilities, data);
        }
    }

    public async sendBreakpoints(
        modelUri: URI,
        breakpointsToSend: IBreakpoint[],
        sourceModified: boolean,
    ): Promise<void> {
        if (!this.raw) {
            throw noDebugAdapter("breakpoints");
        }
        if (!this.raw.readyForBreakpoints) {
            return;
        }

        const rawSource = this.getRawSource(modelUri);
        if (breakpointsToSend.length && !rawSource.adapterData) {
            rawSource.adapterData = breakpointsToSend[0].adapterData;
        }

        const response = await this.raw.setBreakpoints({
            source: rawSource,
            lines: breakpointsToSend.map((bp) => bp.sessionAgnosticData.lineNumber),
            breakpoints: breakpointsToSend.map((bp) => bp.toDAP()),
            sourceModified,
        });
        this.setBreakpointSessionData(breakpointsToSend, response?.body);
    }

    public async sendFunctionBreakpoints(fbpts: IFunctionBreakpoint[]): Promise<void> {
        if (!this.raw) {
            throw noDebugAdapter("function breakpoints");
        }
        if (this.raw.readyForBreakpoints) {
            const response = await this.raw.setFunctionBreakpoints({ breakpoints: fbpts.map((bp) => bp.toDAP()) });
            this.setBreakpointSessionData(fbpts, response?.body);
        }
    }

    public async sendExceptionBreakpoints(exbpts: IExceptionBreakpoint[]): Promise<void> {
        if (!this.raw) {
            throw noDebugAdapter("exception breakpoints");
        }
        if (this.raw.readyForBreakpoints) {
            const args: DebugProtocol.SetExceptionBreakpointsArguments = this.capabilities
                .supportsExceptionFilterOptions
                ? {
                      filters: [],
                      filterOptions: exbpts.map((exb) =>
                          exb.condition ? { filterId: exb.filter, condition: exb.condition } : { filterId: exb.filter },
                      ),
                  }
                : { filters: exbpts.map((exb) => exb.filter) };
            const response = await this.raw.setExceptionBreakpoints(args);
            const breakpoints = response?.body?.breakpoints;
            this.setBreakpointSessionData(exbpts, breakpoints && { breakpoints });
        }
    }

    public dataBytesBreakpointInfo(address: string, bytes: number): Promise<IDataBreakpointInfoResponse | undefined> {
        if (this.raw?.capabilities.supportsDataBreakpointBytes === false) {
            throw new Error("Session does not support breakpoints with bytes");
        }

        return this.dataBreakpointInfoOf({ name: address, bytes, asAddress: true });
    }

    public dataBreakpointInfo(
        name: string,
        variablesReference?: number,
        frameId?: number,
    ): Promise<IDataBreakpointInfoResponse | undefined> {
        return this.dataBreakpointInfoOf({ name, variablesReference, frameId });
    }

    private async dataBreakpointInfoOf(
        args: DebugProtocol.DataBreakpointInfoArguments,
    ): Promise<IDataBreakpointInfoResponse | undefined> {
        if (!this.raw) {
            throw noDebugAdapter("data breakpoints info");
        }
        if (!this.raw.readyForBreakpoints) {
            throw new Error("Session is not ready for breakpoints");
        }

        const response = await this.raw.dataBreakpointInfo(args);
        return response?.body;
    }

    public async sendDataBreakpoints(dataBreakpoints: IDataBreakpoint[]): Promise<void> {
        if (!this.raw) {
            throw noDebugAdapter("data breakpoints");
        }

        if (this.raw.readyForBreakpoints) {
            const converted = await Promise.all(
                dataBreakpoints.map(async (bp) => {
                    try {
                        const dap = await bp.toDAP(this);
                        return { dap, bp };
                    } catch (e) {
                        return { bp, message: (e as Error).message };
                    }
                }),
            );
            const response = await this.raw.setDataBreakpoints({
                breakpoints: converted.flatMap((d) => (d.dap ? [d.dap] : [])),
            });
            if (response?.body) {
                const data = new Map<string, DebugProtocol.Breakpoint>();
                let i = 0;
                for (const dap of converted) {
                    if (!dap.dap) {
                        // Upstream stores the bare message here; as an unverified breakpoint it reads the same.
                        data.set(dap.bp.getId(), { verified: false, message: dap.message });
                    } else {
                        // Upstream stops at the end of the answers; past it the model gets nothing to set either.
                        data.set(dap.bp.getId(), response.body.breakpoints[i++]);
                    }
                }
                this.model.setBreakpointSessionData(this.getId(), this.capabilities, data);
            }
        }
    }

    public async sendInstructionBreakpoints(instructionBreakpoints: IInstructionBreakpoint[]): Promise<void> {
        if (!this.raw) {
            throw noDebugAdapter("instruction breakpoints");
        }
        if (this.raw.readyForBreakpoints) {
            const response = await this.raw.setInstructionBreakpoints({
                breakpoints: instructionBreakpoints.map((ib) => ib.toDAP()),
            });
            this.setBreakpointSessionData(instructionBreakpoints, response?.body);
        }
    }

    public async breakpointsLocations(uri: URI, lineNumber: number): Promise<IPosition[]> {
        if (!this.raw) {
            throw noDebugAdapter("breakpoints locations");
        }

        const source = this.getRawSource(uri);
        const response = await this.raw.breakpointLocations({ source, line: lineNumber });
        const breakpoints = bodyOf(response)?.breakpoints;
        if (!breakpoints) {
            return [];
        }

        const positions = breakpoints.map((bp) => ({ lineNumber: bp.line, column: bp.column ?? 1 }));

        return distinct(positions, (p) => `${String(p.lineNumber)}:${String(p.column)}`);
    }

    public getDebugProtocolBreakpoint(breakpointId: string): DebugProtocol.Breakpoint | undefined {
        return this.model.getDebugProtocolBreakpoint(breakpointId, this.getId());
    }

    public customRequest(request: string, args: unknown): Promise<DebugProtocol.Response | undefined> {
        if (!this.raw) {
            throw noDebugAdapter(request);
        }

        return this.raw.custom(request, args);
    }

    public stackTrace(
        threadId: number,
        startFrame: number,
        levels: number,
        token: ICancellationToken,
    ): Promise<DebugProtocol.StackTraceResponse | undefined> {
        if (!this.raw) {
            throw noDebugAdapter("stackTrace");
        }

        const sessionToken = this.getNewCancellationToken(threadId, token);
        return this.raw.stackTrace({ threadId, startFrame, levels }, sessionToken);
    }

    public async exceptionInfo(threadId: number): Promise<IExceptionInfo | undefined> {
        if (!this.raw) {
            throw noDebugAdapter("exceptionInfo");
        }

        const response = await this.raw.exceptionInfo({ threadId });
        if (response) {
            return {
                id: response.body.exceptionId,
                description: response.body.description,
                breakMode: response.body.breakMode,
                details: response.body.details,
            };
        }

        return undefined;
    }

    public scopes(frameId: number, threadId: number): Promise<DebugProtocol.ScopesResponse | undefined> {
        if (!this.raw) {
            throw noDebugAdapter("scopes");
        }

        const token = this.getNewCancellationToken(threadId);
        return this.raw.scopes({ frameId }, token);
    }

    public variables(
        variablesReference: number,
        threadId: number | undefined,
        filter: "indexed" | "named" | undefined,
        start: number | undefined,
        count: number | undefined,
    ): Promise<DebugProtocol.VariablesResponse | undefined> {
        if (!this.raw) {
            throw noDebugAdapter("variables");
        }

        const token = threadId ? this.getNewCancellationToken(threadId) : undefined;
        return this.raw.variables({ variablesReference, filter, start, count }, token);
    }

    public evaluate(
        expression: string,
        frameId: number,
        context?: string,
        location?: { line: number; column: number; source: DebugProtocol.Source },
    ): Promise<DebugProtocol.EvaluateResponse | undefined> {
        if (!this.raw) {
            throw noDebugAdapter("evaluate");
        }

        return this.raw.evaluate({
            expression,
            frameId,
            context,
            line: location?.line,
            column: location?.column,
            source: location?.source,
        });
    }

    public async restartFrame(frameId: number, threadId: number): Promise<void> {
        await this.waitForTriggeredBreakpoints();
        if (!this.raw) {
            throw noDebugAdapter("restartFrame");
        }

        await this.raw.restartFrame({ frameId }, threadId);
    }

    private setLastSteppingGranularity(threadId: number, granularity?: DebugProtocol.SteppingGranularity): void {
        const thread = this.getThread(threadId);
        if (thread) {
            thread.lastSteppingGranularity = granularity;
        }
    }

    /** A step of the thread: after the dependent breakpoints are enabled, it remembers its granularity. */
    private async stepRequest(
        what: string,
        threadId: number,
        granularity: DebugProtocol.SteppingGranularity | undefined,
        send: (raw: RawDebugSession) => Promise<unknown>,
    ): Promise<void> {
        await this.waitForTriggeredBreakpoints();
        if (!this.raw) {
            throw noDebugAdapter(what);
        }

        this.setLastSteppingGranularity(threadId, granularity);
        await send(this.raw);
    }

    public next(threadId: number, granularity?: DebugProtocol.SteppingGranularity): Promise<void> {
        return this.stepRequest("next", threadId, granularity, (raw) => raw.next({ threadId, granularity }));
    }

    public stepIn(threadId: number, targetId?: number, granularity?: DebugProtocol.SteppingGranularity): Promise<void> {
        return this.stepRequest("stepIn", threadId, granularity, (raw) =>
            raw.stepIn({ threadId, targetId, granularity }),
        );
    }

    public stepOut(threadId: number, granularity?: DebugProtocol.SteppingGranularity): Promise<void> {
        return this.stepRequest("stepOut", threadId, granularity, (raw) => raw.stepOut({ threadId, granularity }));
    }

    public stepBack(threadId: number, granularity?: DebugProtocol.SteppingGranularity): Promise<void> {
        return this.stepRequest("stepBack", threadId, granularity, (raw) => raw.stepBack({ threadId, granularity }));
    }

    public async continue(threadId: number): Promise<void> {
        await this.waitForTriggeredBreakpoints();
        if (!this.raw) {
            throw noDebugAdapter("continue");
        }

        await this.raw.continue({ threadId });
    }

    public async reverseContinue(threadId: number): Promise<void> {
        await this.waitForTriggeredBreakpoints();
        if (!this.raw) {
            throw noDebugAdapter("reverse continue");
        }

        await this.raw.reverseContinue({ threadId });
    }

    public async pause(threadId: number): Promise<void> {
        if (!this.raw) {
            throw noDebugAdapter("pause");
        }

        await this.raw.pause({ threadId });
    }

    public async terminateThreads(threadIds?: number[]): Promise<void> {
        if (!this.raw) {
            throw noDebugAdapter("terminateThreads");
        }

        await this.raw.terminateThreads({ threadIds });
    }

    public setVariable(
        variablesReference: number,
        name: string,
        value: string,
    ): Promise<DebugProtocol.SetVariableResponse | undefined> {
        if (!this.raw) {
            throw noDebugAdapter("setVariable");
        }

        return this.raw.setVariable({ variablesReference, name, value });
    }

    public setExpression(
        frameId: number,
        expression: string,
        value: string,
    ): Promise<DebugProtocol.SetExpressionResponse | undefined> {
        if (!this.raw) {
            throw noDebugAdapter("setExpression");
        }

        return this.raw.setExpression({ expression, value, frameId });
    }

    public gotoTargets(
        source: DebugProtocol.Source,
        line: number,
        column?: number,
    ): Promise<DebugProtocol.GotoTargetsResponse | undefined> {
        if (!this.raw) {
            throw noDebugAdapter("gotoTargets");
        }

        return this.raw.gotoTargets({ source, line, column });
    }

    public goto(threadId: number, targetId: number): Promise<DebugProtocol.GotoResponse | undefined> {
        if (!this.raw) {
            throw noDebugAdapter("goto");
        }

        return this.raw.goto({ threadId, targetId });
    }

    public loadSource(resource: URI): Promise<DebugProtocol.SourceResponse | undefined> {
        if (!this.raw) {
            return Promise.reject(noDebugAdapter("loadSource"));
        }

        const source = this.getSourceForUri(resource);
        let rawSource: DebugProtocol.Source;
        if (source) {
            rawSource = source.raw;
        } else {
            // create a Source
            const data = Source.getEncodedDebugData(resource);
            rawSource = { path: data.path, sourceReference: data.sourceReference };
        }

        return this.raw.source({ sourceReference: rawSource.sourceReference ?? 0, source: rawSource });
    }

    public async getLoadedSources(): Promise<Source[]> {
        if (!this.raw) {
            throw noDebugAdapter("getLoadedSources");
        }

        const response = await this.raw.loadedSources({});
        return bodyOf(response)?.sources.map((src) => this.getSource(src)) ?? [];
    }

    public async completions(
        frameId: number | undefined,
        threadId: number,
        text: string,
        position: Position,
        token: ICancellationToken,
    ): Promise<DebugProtocol.CompletionsResponse | undefined> {
        if (!this.raw) {
            throw noDebugAdapter("completions");
        }
        const sessionCancelationToken = this.getNewCancellationToken(threadId, token);

        return this.raw.completions(
            {
                frameId,
                text,
                column: position.column,
                line: position.lineNumber,
            },
            sessionCancelationToken,
        );
    }

    public async stepInTargets(frameId: number): Promise<DebugProtocol.StepInTarget[] | undefined> {
        if (!this.raw) {
            throw noDebugAdapter("stepInTargets");
        }

        const response = await this.raw.stepInTargets({ frameId });
        return response?.body.targets;
    }

    public async cancel(progressId: string): Promise<DebugProtocol.CancelResponse | undefined> {
        if (!this.raw) {
            throw noDebugAdapter("cancel");
        }

        return this.raw.cancel({ progressId });
    }

    public async disassemble(
        memoryReference: string,
        offset: number,
        instructionOffset: number,
        instructionCount: number,
    ): Promise<DebugProtocol.DisassembledInstruction[] | undefined> {
        if (!this.raw) {
            throw noDebugAdapter("disassemble");
        }

        const response = await this.raw.disassemble({
            memoryReference,
            offset,
            instructionOffset,
            instructionCount,
            resolveSymbols: true,
        });
        return response?.body?.instructions;
    }

    public readMemory(
        memoryReference: string,
        offset: number,
        count: number,
    ): Promise<DebugProtocol.ReadMemoryResponse | undefined> {
        if (!this.raw) {
            return Promise.reject(noDebugAdapter("readMemory"));
        }

        return this.raw.readMemory({ count, memoryReference, offset });
    }

    public writeMemory(
        memoryReference: string,
        offset: number,
        data: string,
        allowPartial?: boolean,
    ): Promise<DebugProtocol.WriteMemoryResponse | undefined> {
        if (!this.raw) {
            return Promise.reject(noDebugAdapter("writeMemory"));
        }

        return this.raw.writeMemory({ memoryReference, offset, allowPartial, data });
    }

    public async resolveLocationReference(locationReference: number): Promise<IDebugLocationReferenced> {
        if (!this.raw) {
            throw noDebugAdapter("locations");
        }
        const location = await this.raw.locations({ locationReference });
        if (!location?.body) {
            throw noDebugAdapter("locations");
        }
        const source = this.getSource(location.body.source);
        return { column: 1, ...location.body, source };
    }

    //---- threads

    public getThread(threadId: number): Thread | undefined {
        return this.threads.get(threadId);
    }

    public getAllThreads(): IThread[] {
        return this.threadIds.flatMap((threadId) => this.threads.get(threadId) ?? []);
    }

    public clearThreads(removeThreads: boolean, reference?: number): void {
        if (reference !== undefined) {
            const thread = this.threads.get(reference);
            if (thread) {
                thread.clearCallStack();
                thread.stoppedDetails = undefined;
                thread.stopped = false;

                if (removeThreads) {
                    this.threads.delete(reference);
                }
            }
        } else {
            this.threads.forEach((thread) => {
                thread.clearCallStack();
                thread.stoppedDetails = undefined;
                thread.stopped = false;
            });

            if (removeThreads) {
                this.threads.clear();
                this.threadIds = [];
                ExpressionContainer.allValues.clear();
            }
        }
    }

    public getStoppedDetails(): IRawStoppedDetails | undefined {
        return this.stoppedDetails.at(0);
    }

    public rawUpdate(data: IRawModelUpdate): void {
        this.threadIds = data.threads.map((thread) => thread.id);
        data.threads.forEach((thread) => {
            const oldThread = this.threads.get(thread.id);
            if (!oldThread) {
                // A new thread came in, initialize it.
                this.threads.set(thread.id, new Thread(this, thread.name, thread.id));
            } else if (thread.name) {
                // Just the thread name got updated #18244
                oldThread.name = thread.name;
            }
        });
        this.threads.forEach((t) => {
            // Remove all old threads which are no longer part of the update #75980
            if (!this.threadIds.includes(t.threadId)) {
                this.threads.delete(t.threadId);
            }
        });

        const stoppedDetails = data.stoppedDetails;
        if (stoppedDetails) {
            // Set the availability of the threads' callstacks depending on
            // whether the thread is stopped or not
            if (stoppedDetails.allThreadsStopped) {
                this.threads.forEach((thread) => {
                    thread.stoppedDetails =
                        thread.threadId === stoppedDetails.threadId
                            ? stoppedDetails
                            : { reason: thread.stoppedDetails?.reason };
                    thread.stopped = true;
                    thread.clearCallStack();
                });
            } else {
                const thread =
                    // Stryker disable next-line ConditionalExpression: a stop without a thread id finds no thread either way
                    typeof stoppedDetails.threadId === "number" ? this.threads.get(stoppedDetails.threadId) : undefined;
                if (thread) {
                    // One thread is stopped, only update that thread.
                    thread.stoppedDetails = stoppedDetails;
                    thread.clearCallStack();
                    thread.stopped = true;
                }
            }
        }
    }

    private async waitForTriggeredBreakpoints(): Promise<void> {
        if (this.waitToResume) {
            await raceTimeout(this.waitToResume, TRIGGERED_BREAKPOINT_MAX_DELAY);
        }
    }

    /**
     * An adapter that goes away cancels the request: the threads are gone with it (upstream leaves the rejection
     * unhandled at every caller).
     */
    private async fetchThreads(stoppedDetails?: IRawStoppedDetails): Promise<void> {
        if (this.raw) {
            let response: DebugProtocol.ThreadsResponse | undefined;
            try {
                response = await this.raw.threads();
            } catch (e) {
                if (isCancellationError(e)) return;
                throw e;
            }
            const threads = bodyOf(response)?.threads;
            if (threads) {
                this.model.rawUpdate({
                    sessionId: this.getId(),
                    threads,
                    stoppedDetails,
                });
            }
        }
    }

    public initializeForTest(raw: RawDebugSession): void {
        this.raw = raw;
        this.registerListeners(raw);
    }

    //---- private

    private registerListeners(raw: RawDebugSession): void {
        this.rawSubscriptions.add(
            raw.onDidInitialize(async () => {
                const sendConfigurationDone = async (): Promise<void> => {
                    const current = this.raw;
                    if (current?.capabilities.supportsConfigurationDoneRequest) {
                        try {
                            await current.configurationDone();
                        } catch (e) {
                            // Disconnect the debug session on configuration done error #10596
                            this.services.notifier.error((e as Error).message);
                            void current.disconnect({});
                        }
                    }
                };

                // Send all breakpoints
                try {
                    await this.debugService.sendAllBreakpoints(this);
                } finally {
                    await sendConfigurationDone();
                    await this.fetchThreads();
                }
            }),
        );

        const statusQueue = this.statusQueue;
        this.rawSubscriptions.add(raw.onDidStop((event) => void this.handleStop(event.body)));

        this.rawSubscriptions.add(
            raw.onDidThread((event) => {
                statusQueue.cancel([event.body.threadId]);
                if (event.body.reason === "started") {
                    if (!this.fetchThreadsScheduler.value.isScheduled()) {
                        this.fetchThreadsScheduler.value.schedule();
                    }
                } else if (event.body.reason === "exited") {
                    this.model.clearThreads(this.getId(), true, event.body.threadId);
                    const viewModel = this.debugService.getViewModel();
                    const focusedThread = viewModel.focusedThread;
                    this.passFocusScheduler.cancel();
                    if (event.body.threadId === focusedThread?.threadId) {
                        // De-focus the thread in case it was focused
                        void this.debugService.focusStackFrame(undefined, undefined, viewModel.focusedSession, {
                            explicit: false,
                        });
                    }
                }
            }),
        );

        this.rawSubscriptions.add(
            raw.onDidTerminateDebugee(async (event) => {
                if (event.body?.restart) {
                    await this.debugService.restartSession(this, event.body.restart);
                } else {
                    await raw.disconnect({ terminateDebuggee: false });
                }
            }),
        );

        this.rawSubscriptions.add(raw.onDidContinued((event) => void this.handleContinued(event)));

        const outputQueue = new Queue();
        this.rawSubscriptions.add(
            raw.onDidOutput((event) => {
                this.handleOutput(event, outputQueue);
            }),
        );

        this.rawSubscriptions.add(
            raw.onDidBreakpoint((event) => {
                this.handleBreakpointEvent(event);
            }),
        );

        this.rawSubscriptions.add(
            raw.onDidLoadedSource((event) => {
                this.onDidLoadedSourceEmitter.fire({
                    reason: event.body.reason,
                    source: this.getSource(event.body.source),
                });
            }),
        );

        this.rawSubscriptions.add(
            raw.onDidCustomEvent((event) => {
                this.onDidCustomEventEmitter.fire(event);
            }),
        );

        this.rawSubscriptions.add(
            raw.onDidProgressStart((event) => {
                this.onDidProgressStartEmitter.fire(event);
            }),
        );
        this.rawSubscriptions.add(
            raw.onDidProgressUpdate((event) => {
                this.onDidProgressUpdateEmitter.fire(event);
            }),
        );
        this.rawSubscriptions.add(
            raw.onDidProgressEnd((event) => {
                this.onDidProgressEndEmitter.fire(event);
            }),
        );
        this.rawSubscriptions.add(
            raw.onDidInvalidateMemory((event) => {
                this.onDidInvalidMemoryEmitter.fire(event);
            }),
        );
        this.rawSubscriptions.add(raw.onDidInvalidated((event) => void this.handleInvalidated(event)));

        this.rawSubscriptions.add(
            raw.onDidExitAdapter((event) => {
                this.onDidExitAdapter(event);
            }),
        );
    }

    private async handleContinued(event: DebugProtocol.ContinuedEvent): Promise<void> {
        const allThreads = event.body.allThreadsContinued !== false;

        let affectedThreads: number[] | Promise<number[]>;
        if (!allThreads) {
            affectedThreads = [event.body.threadId];
            if (!this.threadIds.includes(event.body.threadId)) {
                this.fetchThreadsScheduler.rawValue?.cancel();
                affectedThreads = this.fetchThreads().then(() => [event.body.threadId]);
            }
        } else if (this.fetchThreadsScheduler.value.isScheduled()) {
            this.fetchThreadsScheduler.value.cancel();
            affectedThreads = this.fetchThreads().then(() => this.threadIds);
        } else {
            affectedThreads = this.threadIds;
        }

        // Deviation: only the stops that came before this event. The filter runs a microtask later, and an adapter's
        // `continued` and `stopped` processed in one task (two events, no task boundary between them: CodeLLDB sends
        // `continued` right before the stop of a step) would drop the new stop, and CALL STACK its "Paused on step".
        const earlierStops = new Set(this.stoppedDetails);
        this.statusQueue.cancel(allThreads ? undefined : [event.body.threadId]);
        await this.statusQueue.run(affectedThreads, (threadId) => {
            this.stoppedDetails = this.stoppedDetails.filter((sd) => sd.threadId !== threadId || !earlierStops.has(sd));
            const tokens = this.cancellationMap.get(threadId);
            // Stryker disable next-line CallExpression: the tokens left in the map are cancelled already; cancelling them again does nothing
            this.cancellationMap.delete(threadId);
            tokens?.forEach(cancelAndDispose);
            this.model.clearThreads(this.getId(), false, threadId);
            return Promise.resolve();
        });

        // We need to pass focus to other sessions / threads with a timeout in case a quick stop event occurs #130321
        this.lastContinuedThreadId = allThreads ? undefined : event.body.threadId;
        this.passFocusScheduler.schedule();
        this.onDidChangeStateEmitter.fire();
    }

    private handleOutput(event: DebugProtocol.OutputEvent, outputQueue: Queue): void {
        const outputSeverity: ReplSeverity =
            event.body.category === "stderr" ? "error" : event.body.category === "console" ? "warning" : "info";
        const isImportant = event.body.category === "important";
        const source =
            event.body.source && event.body.line
                ? {
                      lineNumber: event.body.line,
                      column: event.body.column ?? 1,
                      source: this.getSource(event.body.source),
                  }
                : undefined;

        // When a variables event is received, execute immediately to obtain the variables value #126967
        if (event.body.variablesReference) {
            const container = new ExpressionContainer(this, undefined, event.body.variablesReference, generateUuid());
            const children = container.getChildren();
            // we should put appendToRepl into queue to make sure the logs to be displayed in correct order
            // see https://github.com/microsoft/vscode/issues/126967#issuecomment-874954269
            outputQueue.queue(async () => {
                const resolved = await children;
                // For single logged variables, try to use the output if we can so
                // present a better (i.e. ANSI-aware) representation of the output
                if (resolved.length === 1) {
                    this.appendToRepl(
                        { output: event.body.output, expression: resolved[0], sev: outputSeverity, source },
                        isImportant,
                    );
                    return;
                }

                resolved.forEach((child) => {
                    // Since we can not display multiple trees in a row, we are displaying these variables one after the other (ignoring their names)
                    (child as { name: string | null }).name = null;
                    this.appendToRepl({ output: "", expression: child, sev: outputSeverity, source }, isImportant);
                });
            });
            return;
        }
        outputQueue.queue(() => {
            // Telemetry output is not shown: the extension's telemetry endpoint is not supported.
            if (event.body.category === "telemetry") {
                return Promise.resolve();
            }

            if (event.body.group === "start" || event.body.group === "startCollapsed") {
                const expanded = event.body.group === "start";
                this.repl.startGroup(this, event.body.output, expanded, source);
                return Promise.resolve();
            }
            if (event.body.group === "end") {
                this.repl.endGroup();
                if (!event.body.output) {
                    // Only return if the end event does not have additional output in it
                    return Promise.resolve();
                }
            }

            this.appendToRepl({ output: event.body.output, sev: outputSeverity, source }, isImportant);
            return Promise.resolve();
        });
    }

    private handleBreakpointEvent(event: DebugProtocol.BreakpointEvent): void {
        const id = event.body.breakpoint.id;
        const sessionId = this.getId();
        const breakpoint = this.model.getBreakpoints().find((bp) => bp.getIdFromAdapter(sessionId) === id);
        const functionBreakpoint = this.model
            .getFunctionBreakpoints()
            .find((bp) => bp.getIdFromAdapter(sessionId) === id);
        const dataBreakpoint = this.model.getDataBreakpoints().find((dbp) => dbp.getIdFromAdapter(sessionId) === id);
        const exceptionBreakpoint = this.model
            .getExceptionBreakpoints()
            .find((excbp) => excbp.getIdFromAdapter(sessionId) === id);

        if (event.body.reason === "new" && event.body.breakpoint.source && event.body.breakpoint.line) {
            const source = this.getSource(event.body.breakpoint.source);
            const bps = this.model.addBreakpoints(
                source.uri,
                [
                    {
                        column: event.body.breakpoint.column,
                        enabled: true,
                        lineNumber: event.body.breakpoint.line,
                    },
                ],
                false,
            );
            // One breakpoint in, one out: upstream's check of the count always holds.
            const data = new Map<string, DebugProtocol.Breakpoint>([[bps[0].getId(), event.body.breakpoint]]);
            this.model.setBreakpointSessionData(sessionId, this.capabilities, data);
        }

        if (event.body.reason === "removed") {
            if (breakpoint) {
                this.model.removeBreakpoints([breakpoint]);
            }
            if (functionBreakpoint) {
                this.model.removeFunctionBreakpoints(functionBreakpoint.getId());
            }
            if (dataBreakpoint) {
                this.model.removeDataBreakpoints(dataBreakpoint.getId());
            }
        }

        if (event.body.reason === "changed") {
            if (breakpoint && !breakpoint.column) {
                event.body.breakpoint.column = undefined;
            }
            for (const bp of [breakpoint, functionBreakpoint, dataBreakpoint, exceptionBreakpoint]) {
                if (bp) {
                    const data = new Map<string, DebugProtocol.Breakpoint>([[bp.getId(), event.body.breakpoint]]);
                    this.model.setBreakpointSessionData(sessionId, this.capabilities, data);
                }
            }
        }
    }

    private async handleInvalidated(event: DebugProtocol.InvalidatedEvent): Promise<void> {
        const areas = event.body.areas ?? ["all"];
        // If invalidated event only requires to update variables or watch, do that, otherwise refetch threads https://github.com/microsoft/vscode/issues/106745
        if (areas.includes("threads") || areas.includes("stacks") || areas.includes("all")) {
            this.cancelAllRequests();
            this.model.clearThreads(this.getId(), true);

            const details = this.stoppedDetails.slice();
            this.stoppedDetails.length = 0;
            if (details.length) {
                await Promise.all(details.map((d) => this.handleStop(d)));
            } else if (!this.fetchThreadsScheduler.value.isScheduled()) {
                // threads are fetched as a side-effect of processing the stopped
                // event(s), but if there are none, schedule a thread update manually (#282777)
                this.fetchThreadsScheduler.value.schedule();
            }
        }

        const viewModel = this.debugService.getViewModel();
        if (viewModel.focusedSession === this) {
            viewModel.updateViews();
        }
    }

    private async handleStop(event: IRawStoppedDetails): Promise<void> {
        this.passFocusScheduler.cancel();
        this.stoppedDetails.push(event);

        // do this very eagerly if we have hitBreakpointIds, since it may take a
        // moment for breakpoints to set and we want to do our best to not miss
        // anything
        if (event.hitBreakpointIds) {
            this.waitToResume = this.enableDependentBreakpoints(event.hitBreakpointIds);
        }

        await this.statusQueue.run(
            this.fetchThreads(event).then(() => (event.threadId === undefined ? this.threadIds : [event.threadId])),
            async (threadId, token) => {
                const hasLotsOfThreads = event.threadId === undefined && this.threadIds.length > 10;

                // If the focus for the current session is on a non-existent thread, clear the focus.
                const focusedThread = this.debugService.getViewModel().focusedThread;
                const focusedThreadDoesNotExist =
                    focusedThread?.session === this && !this.threads.has(focusedThread.threadId);
                if (focusedThreadDoesNotExist) {
                    void this.debugService.focusStackFrame(undefined, undefined);
                }

                const thread = this.getThread(threadId);
                if (thread) {
                    // Call fetch call stack twice, the first only return the top stack frame.
                    // Second retrieves the rest of the call stack. For performance reasons #25605
                    // Second call is only done if there's few threads that stopped in this event.
                    const promises = this.model.refreshTopOfCallstack(thread, /* fetchFullStack= */ !hasLotsOfThreads);
                    const focus = async (): Promise<void> => {
                        if (focusedThreadDoesNotExist || (!event.preserveFocusHint && thread.getCallStack().length)) {
                            const focusedStackFrame = this.debugService.getViewModel().focusedStackFrame;
                            if (!focusedStackFrame || focusedStackFrame.thread.session === this) {
                                // Only take focus if nothing is focused, or if the focus is already on the current session
                                const preserveFocus = !this.services.debugConfiguration().focusEditorOnBreak;
                                await this.debugService.focusStackFrame(undefined, thread, undefined, {
                                    preserveFocus,
                                });
                            }

                            // Upstream also checks `thread.stoppedDetails`: a stopped event always sets them.
                            if (
                                // Stryker disable next-line ConditionalExpression: a continue cancels the token and clears the thread's stoppedDetails together, the reason check stops it as well
                                !isCancelled(token) &&
                                // Stryker disable next-line OptionalChaining: past an uncancelled token the thread still holds the details of this stop
                                thread.stoppedDetails?.reason === "breakpoint" &&
                                this.services.debugConfiguration().openDebug === "openOnDebugBreak" &&
                                !this.suppressDebugView
                            ) {
                                this.services.openViewlet();
                            }
                        }
                    };

                    await promises.topCallStack;

                    if (!event.hitBreakpointIds) {
                        // if hitBreakpointIds are present, this is handled earlier on
                        this.waitToResume = this.enableDependentBreakpoints(thread);
                    }

                    if (token.isCancellationRequested) {
                        return;
                    }

                    void focus();

                    await promises.wholeCallStack;
                    // Through a call: the token may be cancelled while the stack loads.
                    if (isCancelled(token)) {
                        return;
                    }

                    const focusedStackFrame = this.debugService.getViewModel().focusedStackFrame;
                    if (!focusedStackFrame || isFrameDeemphasized(focusedStackFrame)) {
                        // The top stack frame can be deemphesized so try to focus again #68616
                        void focus();
                    }
                }
                this.onDidChangeStateEmitter.fire();
            },
        );
    }

    private async enableDependentBreakpoints(hitBreakpointIdsOrThread: Thread | number[]): Promise<void> {
        let breakpoints: IBreakpoint[];
        if (Array.isArray(hitBreakpointIdsOrThread)) {
            breakpoints = this.model.getBreakpoints().filter((bp) => {
                const id = bp.getIdFromAdapter(this.id);
                return id !== undefined && hitBreakpointIdsOrThread.includes(id);
            });
        } else {
            const frame = hitBreakpointIdsOrThread.getTopStackFrame();
            if (frame === undefined) {
                return;
            }

            if (
                hitBreakpointIdsOrThread.stoppedDetails &&
                hitBreakpointIdsOrThread.stoppedDetails.reason !== "breakpoint"
            ) {
                return;
            }

            breakpoints = this.getBreakpointsAtPosition(
                frame.source.uri,
                frame.range.startLineNumber,
                frame.range.endLineNumber,
                frame.range.startColumn,
                frame.range.endColumn,
            );
        }

        // find the current breakpoints

        // check if the current breakpoints are dependencies, and if so collect and send the dependents to DA
        const urisToResend = new Map<string, URI>();
        this.model.getBreakpoints({ triggeredOnly: true, enabledOnly: true }).forEach((bp) => {
            breakpoints.forEach((cbp) => {
                if (bp.triggeredBy === cbp.getId()) {
                    bp.setSessionDidTrigger(this.getId());
                    urisToResend.set(bp.uri.toString(), bp.uri);
                }
            });
        });

        await Promise.all(
            [...urisToResend.values()].map((uri) => this.debugService.sendBreakpoints(uri, undefined, this)),
        );
    }

    private getBreakpointsAtPosition(
        uri: URI,
        startLineNumber: number,
        endLineNumber: number,
        startColumn: number,
        endColumn: number,
    ): IBreakpoint[] {
        return this.model.getBreakpoints({ uri: uri }).filter((bp) => {
            if (bp.lineNumber < startLineNumber || bp.lineNumber > endLineNumber) {
                return false;
            }

            if (bp.column && (bp.column < startColumn || bp.column > endColumn)) {
                return false;
            }
            return true;
        });
    }

    private onDidExitAdapter(event?: AdapterEndEvent): void {
        this.initialized = true;
        this.model.setBreakpointSessionData(this.getId(), this.capabilities, undefined);
        this.shutdown();
        this.onDidEndAdapterEmitter.fire(event);
    }

    // Disconnects and clears state. Session can be initialized again for a new connection.
    private shutdown(): void {
        this.rawSubscriptions.clear();
        if (this.raw) {
            // Send out disconnect and immediatly dispose (do not wait for response) #127418
            void this.raw.disconnect({});
            this.raw.dispose();
            this.raw = undefined;
        }
        this.passFocusScheduler.cancel();
        this.model.clearThreads(this.getId(), true);
        this.sources.clear();
        this.threads.clear();
        this.threadIds = [];
        this.stoppedDetails = [];
        this.onDidChangeStateEmitter.fire();
    }

    public dispose(): void {
        this.cancelAllRequests();
        // Stryker disable CallExpression: releasing the listeners of a disposed session, which nothing fires any more
        this.rawSubscriptions.dispose();
        this.globalDisposables.dispose();
        this.passFocusScheduler.dispose();
        this.onDidChangeStateEmitter.dispose();
        this.onDidEndAdapterEmitter.dispose();
        this.onDidLoadedSourceEmitter.dispose();
        this.onDidCustomEventEmitter.dispose();
        this.onDidProgressStartEmitter.dispose();
        this.onDidProgressUpdateEmitter.dispose();
        this.onDidProgressEndEmitter.dispose();
        this.onDidInvalidMemoryEmitter.dispose();
        this.onDidChangeReplElementsEmitter.dispose();
        this.onDidChangeNameEmitter.dispose();
        // Stryker restore CallExpression
        this.waitToResume = undefined;
    }

    //---- sources

    public getSourceForUri(uri: URI): Source | undefined {
        return this.sources.get(uri.toString());
    }

    public getSource(raw?: DebugProtocol.Source): Source {
        let source = new Source(raw, this.getId(), this.services.logger);
        const uriKey = source.uri.toString();
        const found = this.sources.get(uriKey);
        if (found) {
            source = found;
            // merge attributes of new into existing
            source.raw = { ...source.raw, ...raw };
            if (raw) {
                // Always take the latest presentation hint from adapter #42139
                source.raw.presentationHint = raw.presentationHint;
            }
        } else {
            this.sources.set(uriKey, source);
        }

        return source;
    }

    private getRawSource(uri: URI): DebugProtocol.Source {
        const source = this.getSourceForUri(uri);
        if (source) {
            return source.raw;
        } else {
            const data = Source.getEncodedDebugData(uri);
            return { name: data.name, path: data.path, sourceReference: data.sourceReference };
        }
    }

    private getNewCancellationToken(threadId: number, token?: ICancellationToken): ICancellationToken {
        const tokenSource = new CancellationTokenSource(token);
        const tokens = this.cancellationMap.get(threadId) ?? [];
        tokens.push(tokenSource);
        this.cancellationMap.set(threadId, tokens);

        return tokenSource.token;
    }

    private cancelAllRequests(): void {
        this.cancellationMap.forEach((tokens) => {
            tokens.forEach(cancelAndDispose);
        });
        this.cancellationMap.clear();
    }

    // REPL

    public getReplElements(): IReplElement[] {
        return this.repl.getReplElements();
    }

    public hasSeparateRepl(): boolean {
        return !this.parentSession || this.options.repl !== "mergeWithParent";
    }

    public removeReplExpressions(): void {
        this.repl.removeReplExpressions();
    }

    public async addReplExpression(stackFrame: IStackFrame | undefined, expression: string): Promise<void> {
        await this.repl.addReplExpression(this, stackFrame, expression);
        // Evaluate all watch expressions and fetch variables again since repl evaluation might have changed some.
        this.debugService.getViewModel().updateViews();
    }

    public appendToRepl(data: INewReplElementData, isImportant?: boolean): void {
        this.repl.appendToRepl(this, data);
        if (isImportant) {
            this.services.notifier.notify(data.output, data.sev, this.name);
        }
    }
}

function isCancelled(token: ICancellationToken): boolean {
    return token.isCancellationRequested;
}

/** Upstream `CancellationTokenSource.dispose(true)`: cancel, then let go of the listeners. */
function cancelAndDispose(source: CancellationTokenSource): void {
    source.cancel();
    source.dispose();
}

/**
 * Keeps track of events for threads, and cancels any previous operations for
 * a thread when the thread goes into a new state. Currently, the operations a thread has are:
 *
 * - started
 * - stopped
 * - continue
 * - exited
 *
 * In each case, the new state preempts the old state, so we don't need to
 * queue work, just cancel old work. It's up to the caller to make sure that
 * no UI effects happen at the point when the `token` is cancelled.
 */
export class ThreadStatusScheduler extends Disposable {
    /**
     * An array of set of thread IDs. When a 'stopped' event is encountered, the
     * editor refreshes its thread IDs. In the meantime, the thread may change
     * state it again. So the editor puts a Set into this array when it starts
     * the refresh, and checks it after the refresh is finished, to see if
     * any of the threads it looked up should now be invalidated.
     */
    private pendingCancellations: Set<number | undefined>[] = [];

    /**
     * Cancellation tokens for currently-running operations on threads.
     */
    private readonly threadOps = this.register(new DisposableMap<number, CancellationTokenSource>());

    /**
     * Runs the operation.
     * If thread is undefined it affects all threads.
     */
    public async run(
        threadIdsP: Promise<number[]> | number[],
        operation: (threadId: number, ct: ICancellationToken) => Promise<unknown>,
    ): Promise<void> {
        const cancelledWhileLookingUpThreads = new Set<number | undefined>();
        this.pendingCancellations.push(cancelledWhileLookingUpThreads);
        const threadIds = await threadIdsP;

        // Now that we got our threads,
        // 1. Remove our pending set, and
        // 2. Cancel any slower callers who might also have found this thread
        for (let i = 0; i < this.pendingCancellations.length; i++) {
            const s = this.pendingCancellations[i];
            if (s === cancelledWhileLookingUpThreads) {
                this.pendingCancellations.splice(i, 1);
                break;
            } else {
                for (const threadId of threadIds) {
                    s.add(threadId);
                }
            }
        }

        if (cancelledWhileLookingUpThreads.has(undefined)) {
            return;
        }

        await Promise.all(
            threadIds.map((threadId) => {
                if (cancelledWhileLookingUpThreads.has(threadId)) {
                    return Promise.resolve();
                }
                this.threadOps.get(threadId)?.cancel();
                const cts = new CancellationTokenSource();
                this.threadOps.set(threadId, cts);
                return operation(threadId, cts.token);
            }),
        );
    }

    /**
     * Cancels all ongoing state operations on the given threads.
     * If threads is undefined it cancel all threads.
     */
    public cancel(threadIds?: readonly number[]): void {
        if (!threadIds) {
            for (const [, op] of this.threadOps) {
                op.cancel();
            }
            this.threadOps.clearAndDisposeAll();
            for (const s of this.pendingCancellations) {
                s.add(undefined);
            }
        } else {
            for (const threadId of threadIds) {
                this.threadOps.get(threadId)?.cancel();
                this.threadOps.deleteAndDispose(threadId);
                for (const s of this.pendingCancellations) {
                    s.add(threadId);
                }
            }
        }
    }
}
