/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/rawDebugSession.ts
// Deviations: an error with a `url` is reported by its message alone, without the "More Info" action (there is no
// opener of links in error notifications yet); `launchVSCode` (an extension development host window) is not
// planned and answers as an unknown request; telemetry is not kept. The end event carries `failure` — the error of
// an adapter that went away by itself — for the debug service to write to the Debug Console.

import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { CancellationError } from "../../../../base/common/errorSerialization.ts";
import { Emitter, type Event } from "../../../../base/common/event.ts";
import { DisposableStore, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { AdapterEndEvent, IConfig, IDebugAdapter, IDebugger } from "../common/debug.ts";
import { formatPII } from "../common/debugUtils.ts";

/** The part of the notification service the session reports adapter errors to (`showUser`). */
export interface IRawDebugSessionNotifier {
    error(message: string): void;
}

/** Adapters may leave a response's body out, though the protocol's types say it is there. */
export function bodyOf<R extends { body?: unknown }>(response: R | undefined): R["body"] | undefined {
    return response?.body;
}

/** What a failed request rejects with: the adapter's message, and whether it asked to show it to the user. */
export class DebugRequestError extends Error {
    public constructor(
        message: string,
        public readonly showUser: boolean | undefined,
    ) {
        super(message);
    }
}

/**
 * Encapsulates the DebugAdapter lifecycle and some idiosyncrasies of the Debug Adapter Protocol.
 */
export class RawDebugSession implements IDisposable {
    private allThreadsContinued = true;
    private readyForBreakpointsValue = false;
    private capabilitiesValue: DebugProtocol.Capabilities = {};

    // shutdown
    private inShutdown = false;
    private terminated = false;

    private didReceiveStoppedEvent = false;

    private readonly toDispose = new DisposableStore();

    // DAP events
    private readonly onDidInitializeEmitter = this.toDispose.add(new Emitter<DebugProtocol.InitializedEvent>());
    private readonly onDidStopEmitter = this.toDispose.add(new Emitter<DebugProtocol.StoppedEvent>());
    private readonly onDidContinuedEmitter = this.toDispose.add(new Emitter<DebugProtocol.ContinuedEvent>());
    private readonly onDidTerminateDebugeeEmitter = this.toDispose.add(new Emitter<DebugProtocol.TerminatedEvent>());
    private readonly onDidExitDebugeeEmitter = this.toDispose.add(new Emitter<DebugProtocol.ExitedEvent>());
    private readonly onDidThreadEmitter = this.toDispose.add(new Emitter<DebugProtocol.ThreadEvent>());
    private readonly onDidOutputEmitter = this.toDispose.add(new Emitter<DebugProtocol.OutputEvent>());
    private readonly onDidBreakpointEmitter = this.toDispose.add(new Emitter<DebugProtocol.BreakpointEvent>());
    private readonly onDidLoadedSourceEmitter = this.toDispose.add(new Emitter<DebugProtocol.LoadedSourceEvent>());
    private readonly onDidProgressStartEmitter = this.toDispose.add(new Emitter<DebugProtocol.ProgressStartEvent>());
    private readonly onDidProgressUpdateEmitter = this.toDispose.add(new Emitter<DebugProtocol.ProgressUpdateEvent>());
    private readonly onDidProgressEndEmitter = this.toDispose.add(new Emitter<DebugProtocol.ProgressEndEvent>());
    private readonly onDidInvalidatedEmitter = this.toDispose.add(new Emitter<DebugProtocol.InvalidatedEvent>());
    private readonly onDidInvalidateMemoryEmitter = this.toDispose.add(new Emitter<DebugProtocol.MemoryEvent>());
    private readonly onDidCustomEventEmitter = this.toDispose.add(new Emitter<DebugProtocol.Event>());
    private readonly onDidEventEmitter = this.toDispose.add(new Emitter<DebugProtocol.Event>());

    // DA events
    private readonly onDidExitAdapterEmitter = this.toDispose.add(new Emitter<AdapterEndEvent>());
    private debugAdapter: IDebugAdapter | null;

    // Stryker disable next-line BooleanLiteral: every step sets the flag before it reads it, so its first value is never read
    private stoppedSinceLastStep = false;

    public constructor(
        debugAdapter: IDebugAdapter,
        public readonly dbgr: IDebugger,
        private readonly sessionId: string,
        private readonly name: string,
        private readonly notifier: IRawDebugSessionNotifier,
    ) {
        this.debugAdapter = debugAdapter;

        // An adapter that fails to stop is reported, not left as an unhandled rejection (upstream leaves it).
        this.toDispose.add(
            debugAdapter.onError((err) => {
                this.shutdown(err).catch(onUnexpectedError);
            }),
        );

        this.toDispose.add(
            debugAdapter.onExit((code) => {
                // normal exit when the code is 0
                const error = code !== 0 ? new Error(`exit code: ${String(code)}`) : undefined;
                this.shutdown(error).catch(onUnexpectedError);
            }),
        );

        debugAdapter.onEvent((event) => {
            this.dispatchEvent(event);
            this.onDidEventEmitter.fire(event);
        });

        debugAdapter.onRequest((request) => void this.dispatchRequest(request));
    }

    private dispatchEvent(event: DebugProtocol.Event): void {
        switch (event.event) {
            case "initialized":
                this.readyForBreakpointsValue = true;
                this.onDidInitializeEmitter.fire(event);
                break;
            case "loadedSource":
                this.onDidLoadedSourceEmitter.fire(event as DebugProtocol.LoadedSourceEvent);
                break;
            case "capabilities":
                this.mergeCapabilities((event as DebugProtocol.CapabilitiesEvent).body.capabilities);
                break;
            case "stopped":
                this.didReceiveStoppedEvent = true;
                this.stoppedSinceLastStep = true;
                this.onDidStopEmitter.fire(event as DebugProtocol.StoppedEvent);
                break;
            case "continued":
                this.allThreadsContinued = (event as DebugProtocol.ContinuedEvent).body.allThreadsContinued !== false;
                this.onDidContinuedEmitter.fire(event as DebugProtocol.ContinuedEvent);
                break;
            case "thread":
                this.onDidThreadEmitter.fire(event as DebugProtocol.ThreadEvent);
                break;
            case "output":
                this.onDidOutputEmitter.fire(event as DebugProtocol.OutputEvent);
                break;
            case "breakpoint":
                this.onDidBreakpointEmitter.fire(event as DebugProtocol.BreakpointEvent);
                break;
            case "terminated":
                this.onDidTerminateDebugeeEmitter.fire(event as DebugProtocol.TerminatedEvent);
                break;
            case "exited":
                this.onDidExitDebugeeEmitter.fire(event as DebugProtocol.ExitedEvent);
                break;
            case "progressStart":
                this.onDidProgressStartEmitter.fire(event as DebugProtocol.ProgressStartEvent);
                break;
            case "progressUpdate":
                this.onDidProgressUpdateEmitter.fire(event as DebugProtocol.ProgressUpdateEvent);
                break;
            case "progressEnd":
                this.onDidProgressEndEmitter.fire(event as DebugProtocol.ProgressEndEvent);
                break;
            case "invalidated":
                this.onDidInvalidatedEmitter.fire(event as DebugProtocol.InvalidatedEvent);
                break;
            case "memory":
                this.onDidInvalidateMemoryEmitter.fire(event as DebugProtocol.MemoryEvent);
                break;
            case "process":
            case "module":
                break;
            default:
                this.onDidCustomEventEmitter.fire(event);
                break;
        }
    }

    public get isInShutdown(): boolean {
        return this.inShutdown;
    }

    public get onDidExitAdapter(): Event<AdapterEndEvent> {
        return this.onDidExitAdapterEmitter.event;
    }

    public get capabilities(): DebugProtocol.Capabilities {
        return this.capabilitiesValue;
    }

    /**
     * DA is ready to accepts setBreakpoint requests.
     * Becomes true after "initialized" events has been received.
     */
    public get readyForBreakpoints(): boolean {
        return this.readyForBreakpointsValue;
    }

    //---- DAP events

    public get onDidInitialize(): Event<DebugProtocol.InitializedEvent> {
        return this.onDidInitializeEmitter.event;
    }

    public get onDidStop(): Event<DebugProtocol.StoppedEvent> {
        return this.onDidStopEmitter.event;
    }

    public get onDidContinued(): Event<DebugProtocol.ContinuedEvent> {
        return this.onDidContinuedEmitter.event;
    }

    public get onDidTerminateDebugee(): Event<DebugProtocol.TerminatedEvent> {
        return this.onDidTerminateDebugeeEmitter.event;
    }

    public get onDidExitDebugee(): Event<DebugProtocol.ExitedEvent> {
        return this.onDidExitDebugeeEmitter.event;
    }

    public get onDidThread(): Event<DebugProtocol.ThreadEvent> {
        return this.onDidThreadEmitter.event;
    }

    public get onDidOutput(): Event<DebugProtocol.OutputEvent> {
        return this.onDidOutputEmitter.event;
    }

    public get onDidBreakpoint(): Event<DebugProtocol.BreakpointEvent> {
        return this.onDidBreakpointEmitter.event;
    }

    public get onDidLoadedSource(): Event<DebugProtocol.LoadedSourceEvent> {
        return this.onDidLoadedSourceEmitter.event;
    }

    public get onDidCustomEvent(): Event<DebugProtocol.Event> {
        return this.onDidCustomEventEmitter.event;
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

    public get onDidInvalidated(): Event<DebugProtocol.InvalidatedEvent> {
        return this.onDidInvalidatedEmitter.event;
    }

    public get onDidInvalidateMemory(): Event<DebugProtocol.MemoryEvent> {
        return this.onDidInvalidateMemoryEmitter.event;
    }

    public get onDidEvent(): Event<DebugProtocol.Event> {
        return this.onDidEventEmitter.event;
    }

    //---- DebugAdapter lifecycle

    /**
     * Starts the underlying debug adapter.
     */
    public async start(): Promise<void> {
        if (!this.debugAdapter) {
            throw new Error("No debug adapter, can not start debug session.");
        }
        await this.debugAdapter.startSession();
    }

    /**
     * Send client capabilities to the debug adapter and receive DA capabilities in return.
     */
    public async initialize(
        args: DebugProtocol.InitializeRequestArguments,
    ): Promise<DebugProtocol.InitializeResponse | undefined> {
        const response = await this.send<DebugProtocol.InitializeResponse>(
            "initialize",
            args,
            undefined,
            undefined,
            false,
        );
        if (response) {
            this.mergeCapabilities(response.body);
        }
        return response;
    }

    /**
     * Terminate the debuggee and shutdown the adapter
     */
    public disconnect(args: DebugProtocol.DisconnectArguments): Promise<void> {
        const terminateDebuggee = this.capabilities.supportTerminateDebuggee ? args.terminateDebuggee : undefined;
        const suspendDebuggee =
            this.capabilities.supportTerminateDebuggee && this.capabilities.supportSuspendDebuggee
                ? args.suspendDebuggee
                : undefined;
        return this.shutdown(undefined, args.restart, terminateDebuggee, suspendDebuggee);
    }

    //---- DAP requests

    public async launchOrAttach(config: IConfig): Promise<DebugProtocol.Response | undefined> {
        const response = await this.send(config.request, config, undefined, undefined, false);
        if (response) {
            this.mergeCapabilities(response.body as DebugProtocol.Capabilities | undefined);
        }
        return response;
    }

    /**
     * Try killing the debuggee softly...
     */
    public terminate(restart = false): Promise<DebugProtocol.TerminateResponse | undefined> {
        if (this.capabilities.supportsTerminateRequest) {
            if (!this.terminated) {
                this.terminated = true;
                return this.send("terminate", { restart }, undefined);
            }
            return this.disconnect({ terminateDebuggee: true, restart }).then(() => undefined);
        }
        return Promise.reject(new Error("terminated not supported"));
    }

    public restart(args: DebugProtocol.RestartArguments): Promise<DebugProtocol.RestartResponse | undefined> {
        if (this.capabilities.supportsRestartRequest) {
            return this.send("restart", args);
        }
        return Promise.reject(new Error("restart not supported"));
    }

    /** Read through a call: a `stopped` event may set the flag while the request is out. */
    private stoppedMeanwhile(): boolean {
        return this.stoppedSinceLastStep;
    }

    /** A step whose response comes without a `stopped` event meanwhile: the thread runs, as if `continued` came. */
    private async step<R extends DebugProtocol.Response>(
        command: string,
        args: unknown,
        threadId: number,
    ): Promise<R | undefined> {
        this.stoppedSinceLastStep = false;
        const response = await this.send<R>(command, args);
        if (!this.stoppedMeanwhile()) {
            this.fireSimulatedContinuedEvent(threadId);
        }
        return response;
    }

    public next(args: DebugProtocol.NextArguments): Promise<DebugProtocol.NextResponse | undefined> {
        return this.step("next", args, args.threadId);
    }

    public stepIn(args: DebugProtocol.StepInArguments): Promise<DebugProtocol.StepInResponse | undefined> {
        return this.step("stepIn", args, args.threadId);
    }

    public stepOut(args: DebugProtocol.StepOutArguments): Promise<DebugProtocol.StepOutResponse | undefined> {
        return this.step("stepOut", args, args.threadId);
    }

    public async continue(args: DebugProtocol.ContinueArguments): Promise<DebugProtocol.ContinueResponse | undefined> {
        this.stoppedSinceLastStep = false;
        const response = await this.send<DebugProtocol.ContinueResponse>("continue", args);
        // An adapter may leave the body out.
        const allThreadsContinued = bodyOf(response)?.allThreadsContinued;
        if (allThreadsContinued !== undefined) {
            this.allThreadsContinued = allThreadsContinued;
        }
        if (!this.stoppedMeanwhile()) {
            this.fireSimulatedContinuedEvent(args.threadId, this.allThreadsContinued);
        }
        return response;
    }

    public pause(args: DebugProtocol.PauseArguments): Promise<DebugProtocol.PauseResponse | undefined> {
        return this.send("pause", args);
    }

    public terminateThreads(
        args: DebugProtocol.TerminateThreadsArguments,
    ): Promise<DebugProtocol.TerminateThreadsResponse | undefined> {
        if (this.capabilities.supportsTerminateThreadsRequest) {
            return this.send("terminateThreads", args);
        }
        return Promise.reject(new Error("terminateThreads not supported"));
    }

    public setVariable(
        args: DebugProtocol.SetVariableArguments,
    ): Promise<DebugProtocol.SetVariableResponse | undefined> {
        if (this.capabilities.supportsSetVariable) {
            return this.send<DebugProtocol.SetVariableResponse>("setVariable", args);
        }
        return Promise.reject(new Error("setVariable not supported"));
    }

    public setExpression(
        args: DebugProtocol.SetExpressionArguments,
    ): Promise<DebugProtocol.SetExpressionResponse | undefined> {
        if (this.capabilities.supportsSetExpression) {
            return this.send<DebugProtocol.SetExpressionResponse>("setExpression", args);
        }
        return Promise.reject(new Error("setExpression not supported"));
    }

    public restartFrame(
        args: DebugProtocol.RestartFrameArguments,
        threadId: number,
    ): Promise<DebugProtocol.RestartFrameResponse | undefined> {
        if (this.capabilities.supportsRestartFrame) {
            return this.step("restartFrame", args, threadId);
        }
        return Promise.reject(new Error("restartFrame not supported"));
    }

    public stepInTargets(
        args: DebugProtocol.StepInTargetsArguments,
    ): Promise<DebugProtocol.StepInTargetsResponse | undefined> {
        if (this.capabilities.supportsStepInTargetsRequest) {
            return this.send("stepInTargets", args);
        }
        return Promise.reject(new Error("stepInTargets not supported"));
    }

    public completions(
        args: DebugProtocol.CompletionsArguments,
        token: ICancellationToken,
    ): Promise<DebugProtocol.CompletionsResponse | undefined> {
        if (this.capabilities.supportsCompletionsRequest) {
            return this.send<DebugProtocol.CompletionsResponse>("completions", args, token);
        }
        return Promise.reject(new Error("completions not supported"));
    }

    public setBreakpoints(
        args: DebugProtocol.SetBreakpointsArguments,
    ): Promise<DebugProtocol.SetBreakpointsResponse | undefined> {
        return this.send<DebugProtocol.SetBreakpointsResponse>("setBreakpoints", args);
    }

    public setFunctionBreakpoints(
        args: DebugProtocol.SetFunctionBreakpointsArguments,
    ): Promise<DebugProtocol.SetFunctionBreakpointsResponse | undefined> {
        if (this.capabilities.supportsFunctionBreakpoints) {
            return this.send<DebugProtocol.SetFunctionBreakpointsResponse>("setFunctionBreakpoints", args);
        }
        return Promise.reject(new Error("setFunctionBreakpoints not supported"));
    }

    public dataBreakpointInfo(
        args: DebugProtocol.DataBreakpointInfoArguments,
    ): Promise<DebugProtocol.DataBreakpointInfoResponse | undefined> {
        if (this.capabilities.supportsDataBreakpoints) {
            return this.send<DebugProtocol.DataBreakpointInfoResponse>("dataBreakpointInfo", args);
        }
        return Promise.reject(new Error("dataBreakpointInfo not supported"));
    }

    public setDataBreakpoints(
        args: DebugProtocol.SetDataBreakpointsArguments,
    ): Promise<DebugProtocol.SetDataBreakpointsResponse | undefined> {
        if (this.capabilities.supportsDataBreakpoints) {
            return this.send<DebugProtocol.SetDataBreakpointsResponse>("setDataBreakpoints", args);
        }
        return Promise.reject(new Error("setDataBreakpoints not supported"));
    }

    public setExceptionBreakpoints(
        args: DebugProtocol.SetExceptionBreakpointsArguments,
    ): Promise<DebugProtocol.SetExceptionBreakpointsResponse | undefined> {
        return this.send<DebugProtocol.SetExceptionBreakpointsResponse>("setExceptionBreakpoints", args);
    }

    public breakpointLocations(
        args: DebugProtocol.BreakpointLocationsArguments,
    ): Promise<DebugProtocol.BreakpointLocationsResponse | undefined> {
        if (this.capabilities.supportsBreakpointLocationsRequest) {
            return this.send("breakpointLocations", args);
        }
        return Promise.reject(new Error("breakpointLocations is not supported"));
    }

    public configurationDone(): Promise<DebugProtocol.ConfigurationDoneResponse | undefined> {
        if (this.capabilities.supportsConfigurationDoneRequest) {
            return this.send("configurationDone", null);
        }
        return Promise.reject(new Error("configurationDone not supported"));
    }

    public stackTrace(
        args: DebugProtocol.StackTraceArguments,
        token: ICancellationToken,
    ): Promise<DebugProtocol.StackTraceResponse | undefined> {
        return this.send<DebugProtocol.StackTraceResponse>("stackTrace", args, token);
    }

    public exceptionInfo(
        args: DebugProtocol.ExceptionInfoArguments,
    ): Promise<DebugProtocol.ExceptionInfoResponse | undefined> {
        if (this.capabilities.supportsExceptionInfoRequest) {
            return this.send<DebugProtocol.ExceptionInfoResponse>("exceptionInfo", args);
        }
        return Promise.reject(new Error("exceptionInfo not supported"));
    }

    public scopes(
        args: DebugProtocol.ScopesArguments,
        token: ICancellationToken,
    ): Promise<DebugProtocol.ScopesResponse | undefined> {
        return this.send<DebugProtocol.ScopesResponse>("scopes", args, token);
    }

    public variables(
        args: DebugProtocol.VariablesArguments,
        token?: ICancellationToken,
    ): Promise<DebugProtocol.VariablesResponse | undefined> {
        return this.send<DebugProtocol.VariablesResponse>("variables", args, token);
    }

    public source(args: DebugProtocol.SourceArguments): Promise<DebugProtocol.SourceResponse | undefined> {
        return this.send<DebugProtocol.SourceResponse>("source", args);
    }

    public locations(args: DebugProtocol.LocationsArguments): Promise<DebugProtocol.LocationsResponse | undefined> {
        return this.send<DebugProtocol.LocationsResponse>("locations", args);
    }

    public loadedSources(
        args: DebugProtocol.LoadedSourcesArguments,
    ): Promise<DebugProtocol.LoadedSourcesResponse | undefined> {
        if (this.capabilities.supportsLoadedSourcesRequest) {
            return this.send<DebugProtocol.LoadedSourcesResponse>("loadedSources", args);
        }
        return Promise.reject(new Error("loadedSources not supported"));
    }

    public threads(): Promise<DebugProtocol.ThreadsResponse | undefined> {
        return this.send<DebugProtocol.ThreadsResponse>("threads", null);
    }

    public evaluate(args: DebugProtocol.EvaluateArguments): Promise<DebugProtocol.EvaluateResponse | undefined> {
        return this.send<DebugProtocol.EvaluateResponse>("evaluate", args);
    }

    public stepBack(args: DebugProtocol.StepBackArguments): Promise<DebugProtocol.StepBackResponse | undefined> {
        if (this.capabilities.supportsStepBack) {
            return this.step("stepBack", args, args.threadId);
        }
        return Promise.reject(new Error("stepBack not supported"));
    }

    public reverseContinue(
        args: DebugProtocol.ReverseContinueArguments,
    ): Promise<DebugProtocol.ReverseContinueResponse | undefined> {
        if (this.capabilities.supportsStepBack) {
            return this.step("reverseContinue", args, args.threadId);
        }
        return Promise.reject(new Error("reverseContinue not supported"));
    }

    public gotoTargets(
        args: DebugProtocol.GotoTargetsArguments,
    ): Promise<DebugProtocol.GotoTargetsResponse | undefined> {
        if (this.capabilities.supportsGotoTargetsRequest) {
            return this.send("gotoTargets", args);
        }
        return Promise.reject(new Error("gotoTargets is not supported"));
    }

    public goto(args: DebugProtocol.GotoArguments): Promise<DebugProtocol.GotoResponse | undefined> {
        if (this.capabilities.supportsGotoTargetsRequest) {
            return this.step("goto", args, args.threadId);
        }
        return Promise.reject(new Error("goto is not supported"));
    }

    public setInstructionBreakpoints(
        args: DebugProtocol.SetInstructionBreakpointsArguments,
    ): Promise<DebugProtocol.SetInstructionBreakpointsResponse | undefined> {
        if (this.capabilities.supportsInstructionBreakpoints) {
            return this.send("setInstructionBreakpoints", args);
        }
        return Promise.reject(new Error("setInstructionBreakpoints is not supported"));
    }

    public disassemble(
        args: DebugProtocol.DisassembleArguments,
    ): Promise<DebugProtocol.DisassembleResponse | undefined> {
        if (this.capabilities.supportsDisassembleRequest) {
            return this.send("disassemble", args);
        }
        return Promise.reject(new Error("disassemble is not supported"));
    }

    public readMemory(args: DebugProtocol.ReadMemoryArguments): Promise<DebugProtocol.ReadMemoryResponse | undefined> {
        if (this.capabilities.supportsReadMemoryRequest) {
            return this.send("readMemory", args);
        }
        return Promise.reject(new Error("readMemory is not supported"));
    }

    public writeMemory(
        args: DebugProtocol.WriteMemoryArguments,
    ): Promise<DebugProtocol.WriteMemoryResponse | undefined> {
        if (this.capabilities.supportsWriteMemoryRequest) {
            return this.send("writeMemory", args);
        }
        return Promise.reject(new Error("writeMemory is not supported"));
    }

    public cancel(args: DebugProtocol.CancelArguments): Promise<DebugProtocol.CancelResponse | undefined> {
        return this.send("cancel", args);
    }

    public custom(request: string, args: unknown): Promise<DebugProtocol.Response | undefined> {
        return this.send(request, args);
    }

    //---- private

    private async shutdown(
        error?: Error,
        restart = false,
        terminateDebuggee?: boolean,
        suspendDebuggee?: boolean,
    ): Promise<void> {
        if (this.inShutdown) {
            return;
        }
        // Only a shutdown lets go of the adapter, so it is still here.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const da = this.debugAdapter!;
        this.inShutdown = true;
        try {
            const args: DebugProtocol.DisconnectArguments = { restart };
            if (typeof terminateDebuggee === "boolean") {
                args.terminateDebuggee = terminateDebuggee;
            }
            if (typeof suspendDebuggee === "boolean") {
                args.suspendDebuggee = suspendDebuggee;
            }
            // if there's an error, the DA is probably already gone, so give it a much shorter timeout.
            await this.send("disconnect", args, undefined, error ? 200 : 2000);
        } catch {
            // Catch the potential 'disconnect' error - no need to show it to the user since the adapter is shutting down
        } finally {
            await this.stopAdapter(da, error);
        }
    }

    /** Once, from the shutdown: upstream's guards against a second stop and a second exit event are not needed. */
    private async stopAdapter(da: IDebugAdapter, error?: Error): Promise<void> {
        let stopped = false;
        try {
            this.debugAdapter = null;
            await da.stopSession();
            stopped = true;
        } finally {
            const e: AdapterEndEvent = { emittedStopped: this.didReceiveStoppedEvent, sessionLengthInSeconds: 0 };
            if (error && !stopped) {
                e.error = error;
            }
            // Only an adapter's error or exit shuts down with an error: it went away by itself.
            if (error) {
                e.failure = error;
            }
            this.onDidExitAdapterEmitter.fire(e);
        }
    }

    private async dispatchRequest(request: DebugProtocol.Request): Promise<void> {
        const response: DebugProtocol.Response = {
            type: "response",
            seq: 0,
            command: request.command,
            request_seq: request.seq,
            success: true,
        };

        const safeSendResponse = (r: DebugProtocol.Response): void => this.debugAdapter?.sendResponse(r);

        try {
            if (request.command === "runInTerminal") {
                const shellProcessId = await this.dbgr.runInTerminal(
                    request.arguments as DebugProtocol.RunInTerminalRequestArguments,
                    this.sessionId,
                );
                const resp = response as DebugProtocol.RunInTerminalResponse;
                resp.body = {};
                if (typeof shellProcessId === "number") {
                    resp.body.shellProcessId = shellProcessId;
                }
            } else if (request.command === "startDebugging") {
                const args = request.arguments as DebugProtocol.StartDebuggingRequestArguments;
                const config: IConfig = {
                    ...args.configuration,
                    request: args.request,
                    type: this.dbgr.type,
                    name: (args.configuration.name as string | undefined) ?? this.name,
                };
                const success = await this.dbgr.startDebugging(config, this.sessionId);
                if (!success) {
                    response.success = false;
                    response.message = "Failed to start debugging";
                }
            } else {
                response.success = false;
                response.message = `unknown request '${request.command}'`;
            }
        } catch (err) {
            response.success = false;
            response.message = (err as Error).message;
        }
        safeSendResponse(response);
    }

    private send<R extends DebugProtocol.Response>(
        command: string,
        args: unknown,
        token?: ICancellationToken,
        timeout?: number,
        showErrors = true,
    ): Promise<R | undefined> {
        return new Promise<R | undefined>((completeDispatch, errorDispatch) => {
            if (!this.debugAdapter) {
                // Only a shutdown lets go of the adapter: we are in shutdown, silently complete
                completeDispatch(undefined);
                return;
            }

            let cancelationListener: IDisposable | undefined;
            const requestId = this.debugAdapter.sendRequest(
                command,
                args,
                (response: DebugProtocol.Response) => {
                    cancelationListener?.dispose();
                    if (response.success) {
                        completeDispatch(response as R);
                    } else {
                        errorDispatch(this.handleErrorResponse(response, showErrors));
                    }
                },
                timeout,
            );

            if (token) {
                cancelationListener = token.onCancellationRequested(() => {
                    cancelationListener?.dispose();
                    if (this.capabilities.supportsCancelRequest) {
                        void this.cancel({ requestId });
                    }
                });
            }
        });
    }

    private handleErrorResponse(errorResponse: DebugProtocol.Response, showErrors: boolean): Error {
        if (errorResponse.command === "canceled" && errorResponse.message === "canceled") {
            return new CancellationError();
        }

        const error = bodyOf(errorResponse as DebugProtocol.ErrorResponse)?.error;
        const errorMessage = errorResponse.message ?? "";

        const userMessage = error ? formatPII(error.format, false, error.variables) : errorMessage;
        if (showErrors && error?.showUser) {
            this.notifier.error(userMessage);
        }
        return new DebugRequestError(userMessage, error?.showUser);
    }

    private mergeCapabilities(capabilities: DebugProtocol.Capabilities | undefined): void {
        // In place, as upstream's `mixin`: `rememberedCapabilities` of the session is this very object. Nothing to
        // merge (`undefined`) changes nothing.
        Object.assign(this.capabilitiesValue, capabilities);
    }

    private fireSimulatedContinuedEvent(threadId: number, allThreadsContinued = false): void {
        this.onDidContinuedEmitter.fire({
            type: "event",
            event: "continued",
            body: {
                threadId,
                allThreadsContinued,
            },
            seq: undefined as unknown as number,
        });
    }

    public dispose(): void {
        this.toDispose.dispose();
    }
}
