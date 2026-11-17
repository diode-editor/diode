// A debug adapter in the same process that speaks real DAP through `AbstractDebugAdapter`, with the data of the
// approved spike (`spike/debug-views`, `debugStubModel.ts`): a C++ program `hello` under CodeLLDB. Three threads, 26
// frames on the main one (the first 20 come in a page, then "Load More"), Locals/Static/Global/Registers, `nums` of
// 1000 (chunked by the model), a linked list, a `std::map`, a value that is an error, an exception on the third
// step over, stdout/stderr/console output and a latency on `variables`/`evaluate`. Tests, e2e and the views of the
// debugger series run on it. A launch configuration with CodeLLDB's `terminal: "integrated" | "external"` runs its
// `program` with `args`, `cwd` and `env` through the `runInTerminal` reverse request before it answers `launch`.
// The loop of `accumulate` is lines 27-31 of `main.cpp`, once per `i`: with a condition, a hit count or a log message
// on a breakpoint there, Continue runs the loop line by line — a logpoint writes its message with `{i}` and `{sum}`
// interpolated, a breakpoint stops where its condition (`i % 100 == 0`, `i > 5`) and hit count (`>= 5`, or `5`)
// hold, and the program exits at `i == 1000`; without them Continue keeps the spike's jump of 100 to line 31.

import type { IDisposable } from "../vs/base/common/lifecycle.ts";
import { AbstractDebugAdapter } from "../vs/workbench/contrib/debug/common/abstractDebugAdapter.ts";
import type { IAdapterManager, IConfig, IDebugAdapterFactory } from "../vs/workbench/contrib/debug/common/debug.ts";

export const SYNTHETIC_DEBUG_TYPE = "synthetic";

/** The launch configuration of the synthetic program, as `debug.startFromConfig` takes it. */
export const SYNTHETIC_LAUNCH_CONFIG: IConfig = {
    type: SYNTHETIC_DEBUG_TYPE,
    request: "launch",
    name: "Launch hello (lldb)",
};

export interface ISyntheticTiming {
    /** `variables` and `evaluate`: long enough to see a loading row. */
    readonly latencyMs: number;
    /** From `configurationDone` to the stop on the breakpoint at `main.cpp:27`. */
    readonly launchMs: number;
    readonly continueMs: number;
    readonly stepMs: number;
}

/** The spike's delays. */
export const SPIKE_TIMING: ISyntheticTiming = { latencyMs: 250, launchMs: 600, continueMs: 700, stepMs: 120 };
/** No waiting: for unit tests that only need the order of things. */
export const NO_DELAY_TIMING: ISyntheticTiming = { latencyMs: 0, launchMs: 0, continueMs: 0, stepMs: 0 };

export const SYNTHETIC_PROGRAM_ROOT = "/home/user/hello";
const MAIN_CPP = "main.cpp";
const LIST_CPP = "list.cpp";
const QUEUE_CPP = "queue.cpp";

export const SYNTHETIC_CAPABILITIES: DebugProtocol.Capabilities = {
    supportsConfigurationDoneRequest: true,
    supportsTerminateRequest: true,
    supportsSetVariable: true,
    supportsSetExpression: true,
    supportsClipboardContext: true,
    supportsExceptionInfoRequest: true,
    supportsLoadedSourcesRequest: true,
    supportsRestartFrame: true,
    supportsTerminateThreadsRequest: true,
    supportsEvaluateForHovers: true,
    supportsDelayedStackTraceLoading: true,
    supportsFunctionBreakpoints: true,
    supportsConditionalBreakpoints: true,
    supportsHitConditionalBreakpoints: true,
    supportsLogPoints: true,
    supportsDataBreakpoints: true,
    supportsDataBreakpointBytes: true,
    supportsExceptionFilterOptions: true,
    supportsInstructionBreakpoints: true,
    breakpointModes: [
        { mode: "software", label: "Software", description: "A trap instruction in the code", appliesTo: ["source"] },
        { mode: "hardware", label: "Hardware", description: "A debug register of the CPU", appliesTo: ["source"] },
    ],
    supportsCompletionsRequest: true,
    exceptionBreakpointFilters: [
        {
            filter: "cpp_throw",
            label: "C++: on throw",
            default: false,
            supportsCondition: true,
            conditionDescription: "Comma-separated list of exception types",
        },
        { filter: "cpp_catch", label: "C++: on catch", default: false },
    ],
};

/** Output in SGR colors with a file link, as test runners print: green `PASS`, bold yellow count, the location. */
export const SYNTHETIC_ANSI_LINE = `\u001b[32mPASS\u001b[0m self-check \u001b[1;33m3/3\u001b[0m at ${SYNTHETIC_PROGRAM_ROOT}/src/main.cpp:27:9`;

/** The Nth number of `nums`. */
export function numAt(i: number): number {
    return ((i * 37) % 101) - 17;
}

interface IFrame {
    readonly id: number;
    readonly name: string;
    readonly file?: string;
    readonly line: number;
    readonly column: number;
}

type Children = () => DebugProtocol.Variable[];

/** The lines of the loop of `accumulate` in `main.cpp`: one pass per `i`. */
const LOOP_FIRST_LINE = 27;
const LOOP_LAST_LINE = 31;

/** A breakpoint the adapter was given, with how many times its condition held. */
interface ISetBreakpoint {
    readonly id: number;
    readonly condition: string | undefined;
    readonly hitCondition: string | undefined;
    readonly logMessage: string | undefined;
    hits: number;
}

/** The program's state between requests; the adapter answers DAP from it. */
class Program {
    /** The loop counter of `accumulate`: every pass over the loop moves it. */
    public iteration = 0;
    public line = 27;
    public stepsOver = 0;
    public readonly exitedThreads = new Set<number>();
    /** `setVariable` results, by `evaluateName`: they outlive a stop. */
    public readonly overrides = new Map<string, string>();

    public sum(): number {
        let sum = 0;
        for (let i = 0; i < this.iteration; i++) sum += numAt(i);
        return sum;
    }

    public threads(): DebugProtocol.Thread[] {
        return [
            { id: 1, name: "hello" },
            { id: 2, name: "worker-1" },
            { id: 3, name: "worker-2" },
        ].filter((t) => !this.exitedThreads.has(t.id));
    }

    public frames(threadId: number): IFrame[] {
        if (threadId === 2) {
            return [
                { id: 2000, name: "__futex_abstimed_wait_common", line: 0, column: 0 },
                { id: 2001, name: "std::condition_variable::wait(std::unique_lock<std::mutex>&)", line: 0, column: 0 },
                { id: 2002, name: "WorkQueue::pop()", file: QUEUE_CPP, line: 18, column: 7 },
                { id: 2003, name: "worker(int)", file: MAIN_CPP, line: 70, column: 21 },
            ];
        }
        if (threadId === 3) {
            return [
                { id: 3000, name: "__futex_abstimed_wait_common", line: 0, column: 0 },
                { id: 3001, name: "WorkQueue::pop()", file: QUEUE_CPP, line: 18, column: 7 },
            ];
        }
        const frames: IFrame[] = [
            { id: 1000, name: "accumulate(std::vector<int> const&)", file: MAIN_CPP, line: this.line, column: 9 },
            { id: 1001, name: "process(Config const&)", file: MAIN_CPP, line: 47, column: 14 },
            { id: 1002, name: "main(int, char**)", file: MAIN_CPP, line: 58, column: 12 },
        ];
        for (let i = 0; i < 20; i++) {
            frames.push({
                id: 1003 + i,
                name: `recurse<${String(i)}>(Node*)`,
                file: LIST_CPP,
                line: 90 + i,
                column: 5,
            });
        }
        frames.push(
            { id: 1023, name: "__libc_start_call_main", line: 0, column: 0 },
            { id: 1024, name: "__libc_start_main_impl", line: 0, column: 0 },
            { id: 1025, name: "_start", line: 0, column: 0 },
        );
        return frames;
    }

    public frame(frameId: number): IFrame | undefined {
        return this.frames(Math.floor(frameId / 1000)).find((f) => f.id === frameId);
    }
}

export class SyntheticDebugAdapter extends AbstractDebugAdapter {
    /** Every request the session sent, in order. */
    public readonly requests: DebugProtocol.Request[] = [];
    /** The session's answers to the adapter's reverse requests, in order. */
    public readonly responses: DebugProtocol.Response[] = [];
    /** The adapter data the answer to `setBreakpoints` gives every breakpoint's source, when set. */
    public breakpointAdapterData: unknown;
    private readonly pendingReverse = new Map<number, () => void>();
    private readonly program = new Program();
    private readonly handles = new Map<number, Children>();
    private nextHandle = 1;
    private nextBreakpointId = 1;
    /** The breakpoints set at `path:line`: a stop on a breakpoint names the ones at its line. */
    private readonly breakpointsAt = new Map<string, ISetBreakpoint[]>();
    private seq = 1;
    private readonly timers = new Set<ReturnType<typeof setTimeout>>();
    private launched = false;
    private configured = false;
    private running = false;

    /** `root`: where the program's sources are; a test that opens them in the editor puts real files there. */
    public constructor(
        private readonly timing: ISyntheticTiming = SPIKE_TIMING,
        private readonly root = SYNTHETIC_PROGRAM_ROOT,
    ) {
        super();
    }

    public startSession(): Promise<void> {
        return Promise.resolve();
    }

    public stopSession(): Promise<void> {
        this.clearTimers();
        return Promise.resolve();
    }

    public sendMessage(message: DebugProtocol.ProtocolMessage): void {
        if (message.type === "request") {
            const request = message as DebugProtocol.Request;
            this.requests.push(request);
            this.dispatch(request);
        } else {
            // The client sends requests and the answers to the adapter's reverse requests.
            const response = message as DebugProtocol.Response;
            this.responses.push(response);
            this.pendingReverse.get(response.request_seq)?.();
            this.pendingReverse.delete(response.request_seq);
        }
    }

    public override dispose(): void {
        this.clearTimers();
        super.dispose();
    }

    private clearTimers(): void {
        for (const timer of this.timers) clearTimeout(timer);
        this.timers.clear();
    }

    private later(ms: number, run: () => void): void {
        const timer = setTimeout(() => {
            this.timers.delete(timer);
            run();
        }, ms);
        this.timers.add(timer);
    }

    private respond(request: DebugProtocol.Request, body?: unknown): void {
        this.acceptMessage({
            type: "response",
            seq: this.seq++,
            request_seq: request.seq,
            command: request.command,
            success: true,
            body,
        } as DebugProtocol.Response);
    }

    private fail(request: DebugProtocol.Request, message: string): void {
        this.acceptMessage({
            type: "response",
            seq: this.seq++,
            request_seq: request.seq,
            command: request.command,
            success: false,
            message,
        } as DebugProtocol.Response);
    }

    /** CodeLLDB's `terminal` launch setting: the debuggee runs in the client's terminal, `launch` is answered after. */
    private launchInTerminal(
        request: DebugProtocol.Request,
        kind: "integrated" | "external",
        config: Record<string, unknown>,
    ): void {
        const seq = this.seq++;
        this.pendingReverse.set(seq, () => {
            this.launch(request);
        });
        const args: DebugProtocol.RunInTerminalRequestArguments = {
            kind,
            title: config.name as string,
            cwd: (config.cwd as string | undefined) ?? SYNTHETIC_PROGRAM_ROOT,
            args: [config.program as string, ...((config.args as string[] | undefined) ?? [])],
            env: config.env as Record<string, string | null> | undefined,
        };
        this.acceptMessage({
            type: "request",
            seq,
            command: "runInTerminal",
            arguments: args,
        } as DebugProtocol.Request);
    }

    private event(event: string, body?: unknown): void {
        this.acceptMessage({ type: "event", seq: this.seq++, event, body } as DebugProtocol.Event);
    }

    private output(category: string, output: string, location?: { file: string; line: number }): void {
        this.event("output", {
            category,
            output: `${output}\n`,
            source: location && this.source(location.file),
            line: location?.line,
        });
    }

    private source(file: string): DebugProtocol.Source {
        return { name: file, path: `${this.root}/src/${file}` };
    }

    private launch(request: DebugProtocol.Request): void {
        this.launched = true;
        this.respond(request);
        this.output("console", "Launching: /home/user/hello/build/hello --verbose input.txt");
        this.output("console", "Launched process 48213 from '/home/user/hello/build/hello'");
        this.startIfReady();
    }

    private dispatch(request: DebugProtocol.Request): void {
        const args = (request.arguments ?? {}) as Record<string, unknown>;
        switch (request.command) {
            case "initialize":
                this.respond(request, SYNTHETIC_CAPABILITIES);
                this.event("initialized");
                return;
            case "launch":
                if (args.terminal === "integrated" || args.terminal === "external") {
                    this.launchInTerminal(request, args.terminal, args);
                    return;
                }
            // falls through
            case "attach":
                this.launch(request);
                return;
            case "configurationDone":
                this.configured = true;
                this.respond(request);
                this.startIfReady();
                return;
            case "setBreakpoints":
                this.setBreakpoints(request, args as unknown as DebugProtocol.SetBreakpointsArguments);
                return;
            case "dataBreakpointInfo": {
                const name = String(args.name);
                if (args.asAddress === true) {
                    // Any range of memory can be watched, for its reads, writes or both.
                    const bytes = Number(args.bytes ?? 1);
                    this.respond(request, {
                        dataId: `${name}+${String(bytes)}`,
                        description: `${name} (${String(bytes)} bytes)`,
                        accessTypes: ["read", "write", "readWrite"],
                        canPersist: true,
                    });
                    return;
                }
                // Any variable can be watched for a change; `count` for its reads and accesses too.
                this.respond(request, {
                    dataId: `${Number(args.variablesReference ?? 0)}:${name}`,
                    description: name,
                    accessTypes: name === "count" ? ["read", "write", "readWrite"] : undefined,
                    canPersist: false,
                });
                return;
            }
            case "setFunctionBreakpoints":
            case "setDataBreakpoints":
            case "setInstructionBreakpoints":
                this.respond(request, {
                    breakpoints: ((args.breakpoints ?? []) as unknown[]).map(() => ({
                        id: this.nextBreakpointId++,
                        verified: true,
                    })),
                });
                return;
            case "setExceptionBreakpoints":
            case "disconnect":
                this.clearTimers();
                this.respond(request);
                return;
            case "threads":
                this.respond(request, { threads: this.program.threads() });
                return;
            case "stackTrace":
                this.stackTrace(request, args as unknown as DebugProtocol.StackTraceArguments);
                return;
            case "scopes":
                this.respond(request, {
                    scopes: this.scopes((args as unknown as DebugProtocol.ScopesArguments).frameId),
                });
                return;
            case "variables":
                this.later(this.timing.latencyMs, () => {
                    this.variables(request, args as unknown as DebugProtocol.VariablesArguments);
                });
                return;
            case "evaluate":
                this.later(this.timing.latencyMs, () => {
                    this.evaluate(request, (args as unknown as DebugProtocol.EvaluateArguments).expression);
                });
                return;
            case "setVariable":
                this.setVariable(request, args as unknown as DebugProtocol.SetVariableArguments);
                return;
            case "setExpression":
                this.setExpression(request, args as unknown as DebugProtocol.SetExpressionArguments);
                return;
            case "completions":
                this.completions(request, args as unknown as DebugProtocol.CompletionsArguments);
                return;
            case "continue":
                this.respond(request, { allThreadsContinued: true });
                if (this.loopHasConditions()) {
                    this.resume(this.timing.continueMs, () => {
                        this.runLoop();
                    });
                    return;
                }
                this.resume(this.timing.continueMs, () => {
                    this.program.iteration += 100;
                    this.program.line = 31;
                    this.output("console", `sum=${String(this.program.sum())} i=${String(this.program.iteration)}`, {
                        file: MAIN_CPP,
                        line: 35,
                    });
                    this.stop("breakpoint");
                });
                return;
            case "next":
                this.respond(request);
                this.resume(this.timing.stepMs, () => {
                    this.program.stepsOver++;
                    this.program.line = this.program.line >= 31 ? 27 : this.program.line + 1;
                    if (this.program.line === 27) this.program.iteration++;
                    if (this.program.stepsOver === 3) {
                        this.output("stderr", "terminate called after throwing an instance of 'std::out_of_range'");
                        this.stop("exception", "std::out_of_range");
                        return;
                    }
                    this.stop("step");
                });
                return;
            case "stepIn":
                this.respond(request);
                this.resume(this.timing.stepMs, () => {
                    this.program.line = 28;
                    this.stop("step");
                });
                return;
            case "stepOut":
                this.respond(request);
                this.resume(this.timing.stepMs, () => {
                    this.program.line = 27;
                    this.program.iteration++;
                    this.stop("step");
                });
                return;
            case "restartFrame":
                this.respond(request);
                this.resume(this.timing.stepMs, () => {
                    this.program.line = 27;
                    this.stop("restart");
                });
                return;
            case "pause":
                this.respond(request);
                if (this.running) {
                    this.clearTimers();
                    this.stop("pause");
                }
                return;
            case "exceptionInfo":
                this.respond(request, {
                    exceptionId: "std::out_of_range",
                    description: "vector::_M_range_check: __n (which is 1000) >= this->size() (which is 1000)",
                    breakMode: "always",
                });
                return;
            case "terminateThreads":
                this.respond(request);
                for (const threadId of (args.threadIds ?? []) as number[]) {
                    this.program.exitedThreads.add(threadId);
                    this.event("thread", { reason: "exited", threadId });
                }
                return;
            case "loadedSources":
                this.respond(request, { sources: [MAIN_CPP, LIST_CPP, QUEUE_CPP].map((f) => this.source(f)) });
                return;
            case "terminate":
                this.clearTimers();
                this.respond(request);
                this.output("console", "Process exited with code 0.");
                this.event("exited", { exitCode: 0 });
                this.event("terminated");
                return;
            default:
                this.fail(request, `Unrecognized request '${request.command}'`);
        }
    }

    private startIfReady(): void {
        if (!this.launched || !this.configured) return;
        this.resume(this.timing.launchMs, () => {
            this.output("stdout", "Hello from hello 1.2.0!");
            this.output("stdout", "Reading input.txt: 1000 numbers");
            this.output("stdout", SYNTHETIC_ANSI_LINE);
            this.output(
                "console",
                "warning: (x86_64) /lib/x86_64-linux-gnu/libstdc++.so.6 unable to locate separate debug file (dwo id 0x9a3c7e1f00b2d14e): No such file or directory — this line is long on purpose to see what the console does with it",
            );
            this.stop("breakpoint");
        });
    }

    /** The program runs for `ms`, then `stopAgain` decides where it stops. Variable handles die with the stop. */
    private resume(ms: number, stopAgain: () => void): void {
        this.running = true;
        this.handles.clear();
        this.later(ms, stopAgain);
    }

    /** A breakpoint with a condition, a hit count or a log message on a line of the loop. */
    private loopHasConditions(): boolean {
        for (let line = LOOP_FIRST_LINE; line <= LOOP_LAST_LINE; line++) {
            const set = this.breakpointsAt.get(`${this.root}/src/${MAIN_CPP}:${String(line)}`) ?? [];
            if (set.some((bp) => !!bp.condition || !!bp.hitCondition || !!bp.logMessage)) return true;
        }
        return false;
    }

    /** The loop line by line from where the program is, until a breakpoint holds or the loop ends. */
    private runLoop(): void {
        const program = this.program;
        for (;;) {
            if (program.line >= LOOP_LAST_LINE) {
                program.line = LOOP_FIRST_LINE;
                program.iteration++;
            } else {
                program.line++;
            }
            if (program.iteration >= 1000) {
                this.running = false;
                this.output("console", "Process exited with code 0.");
                this.event("exited", { exitCode: 0 });
                this.event("terminated");
                return;
            }
            const hit = this.hitsAt(program.line);
            if (hit.length > 0) {
                this.stop("breakpoint", undefined, hit);
                return;
            }
        }
    }

    /** The ids of the breakpoints of a line that stop the program; its logpoints log. */
    private hitsAt(line: number): number[] {
        const hit: number[] = [];
        for (const bp of this.breakpointsAt.get(`${this.root}/src/${MAIN_CPP}:${String(line)}`) ?? []) {
            if (bp.condition && this.valueOf(bp.condition) === 0) continue;
            bp.hits++;
            if (bp.hitCondition && !hitConditionHolds(bp.hitCondition, bp.hits)) continue;
            if (bp.logMessage) {
                const message = bp.logMessage.replace(/\{([^}]*)\}/gu, (_, expression: string) =>
                    String(this.valueOf(expression) ?? `<error: ${expression}>`),
                );
                this.output("console", message, { file: MAIN_CPP, line });
                continue;
            }
            hit.push(bp.id);
        }
        return hit;
    }

    /** A number the expression evaluates to in the top frame, as `evaluate` does; `undefined` on an error. */
    private valueOf(expression: string): number | undefined {
        const byName = new Map(this.locals(this.program.frames(1)[0]).map((v) => [v.name, v.value]));
        const words = expression.match(/[A-Za-z_]\w*/gu) ?? [];
        if (words.some((word) => !/^-?\d+$/u.test(byName.get(word) ?? ""))) return undefined;
        return evaluateArithmetic(expression.trim().replace(/[A-Za-z_]\w*/gu, (word) => byName.get(word) ?? word));
    }

    private stop(reason: string, text?: string, hitBreakpointIds?: number[]): void {
        this.running = false;
        this.event("stopped", {
            reason,
            threadId: 1,
            allThreadsStopped: true,
            text,
            description: reason === "exception" ? "Exception has occurred." : undefined,
            hitBreakpointIds:
                hitBreakpointIds ??
                (reason === "breakpoint"
                    ? this.breakpointsAt
                          .get(`${this.root}/src/${MAIN_CPP}:${String(this.program.line)}`)
                          ?.map((bp) => bp.id)
                    : undefined),
        });
    }

    /** A file of the program verifies its breakpoints; any other has no code to break in. */
    private setBreakpoints(request: DebugProtocol.Request, args: DebugProtocol.SetBreakpointsArguments): void {
        const path = args.source.path ?? "";
        const known = path.startsWith(`${this.root}/`);
        for (const key of [...this.breakpointsAt.keys()]) {
            if (key.startsWith(`${path}:`)) this.breakpointsAt.delete(key);
        }
        const breakpoints = (args.breakpoints ?? []).map((bp) => {
            const id = this.nextBreakpointId++;
            const key = `${path}:${String(bp.line)}`;
            if (known) {
                const set: ISetBreakpoint = {
                    id,
                    condition: bp.condition,
                    hitCondition: bp.hitCondition,
                    logMessage: bp.logMessage,
                    hits: 0,
                };
                this.breakpointsAt.set(key, [...(this.breakpointsAt.get(key) ?? []), set]);
            }
            const source =
                this.breakpointAdapterData === undefined
                    ? undefined
                    : { ...args.source, adapterData: this.breakpointAdapterData };
            return { id, verified: known, line: bp.line, source };
        });
        this.respond(request, { breakpoints });
    }

    private stackTrace(request: DebugProtocol.Request, args: DebugProtocol.StackTraceArguments): void {
        const frames = this.program.frames(args.threadId);
        const start = args.startFrame ?? 0;
        const levels = args.levels ?? 0;
        const page = frames.slice(start, levels > 0 ? start + levels : undefined);
        this.respond(request, {
            totalFrames: frames.length,
            stackFrames: page.map(
                (f): DebugProtocol.StackFrame => ({
                    id: f.id,
                    name: f.name,
                    source: f.file === undefined ? undefined : this.source(f.file),
                    line: f.line,
                    column: f.column,
                    presentationHint: f.file === undefined ? "subtle" : undefined,
                }),
            ),
        });
    }

    private handle(children: Children): number {
        const handle = this.nextHandle++;
        this.handles.set(handle, children);
        return handle;
    }

    private scopes(frameId: number): DebugProtocol.Scope[] {
        const frame = this.program.frame(frameId);
        if (frame === undefined) return [];
        const scopes: DebugProtocol.Scope[] = [];
        if (frame.file !== undefined) {
            scopes.push(
                {
                    name: "Locals",
                    presentationHint: "locals",
                    variablesReference: this.handle(() => this.locals(frame)),
                    expensive: false,
                },
                {
                    name: "Static",
                    variablesReference: this.handle(() => [this.leaf("Counter::instances", "3", "int")]),
                    expensive: false,
                },
                {
                    name: "Global",
                    variablesReference: this.handle(() => [
                        this.leaf("g_verbose", "false", "bool"),
                        this.leaf("g_name", '"hello"', "char const*"),
                    ]),
                    expensive: false,
                },
            );
        }
        scopes.push({
            name: "Registers",
            presentationHint: "registers",
            variablesReference: this.handle(() => this.registers()),
            expensive: false,
        });
        return scopes;
    }

    private variables(request: DebugProtocol.Request, args: DebugProtocol.VariablesArguments): void {
        const children = this.handles.get(args.variablesReference);
        if (children === undefined) {
            this.fail(request, `Invalid variable reference ${String(args.variablesReference)}`);
            return;
        }
        let variables = children();
        if (args.filter === "named") {
            variables = variables.filter((v) => !v.name.startsWith("["));
        } else if (args.filter === "indexed") {
            const start = args.start ?? 0;
            variables = variables
                .filter((v) => v.name.startsWith("["))
                .slice(start, start + (args.count ?? variables.length));
        }
        this.respond(request, { variables });
    }

    private leaf(name: string, value: string, type: string, evaluateName = name): DebugProtocol.Variable {
        return {
            name,
            value: this.program.overrides.get(evaluateName) ?? value,
            type,
            evaluateName,
            variablesReference: 0,
        };
    }

    private node(
        name: string,
        value: string,
        type: string,
        children: Children,
        extra: Partial<DebugProtocol.Variable> = {},
    ): DebugProtocol.Variable {
        return { name, value, type, evaluateName: name, variablesReference: this.handle(children), ...extra };
    }

    private locals(frame: IFrame): DebugProtocol.Variable[] {
        if (frame.id !== 1000) {
            return [
                this.leaf("argc", "3", "int"),
                this.node("argv", "0x00007fffffffe2a8", "char**", () => [
                    this.leaf("[0]", '"/home/user/hello/build/hello"', "char*", "argv[0]"),
                    this.leaf("[1]", '"--verbose"', "char*", "argv[1]"),
                    this.leaf("[2]", '"input.txt"', "char*", "argv[2]"),
                ]),
                this.leaf("rc", "0", "int"),
            ];
        }
        const program = this.program;
        return [
            this.node(
                "nums",
                "size=1000",
                "std::vector<int>",
                () =>
                    Array.from({ length: 1000 }, (_, i) =>
                        this.leaf(`[${String(i)}]`, String(numAt(i)), "int", `nums[${String(i)}]`),
                    ),
                { indexedVariables: 1000 },
            ),
            this.leaf("i", String(program.iteration), "size_t"),
            this.leaf("sum", String(program.sum()), "long"),
            this.leaf("total", String(program.sum() * 2), "long"),
            this.leaf("count", "0", "int"),
            this.leaf("name", '"accumulator"', "std::string"),
            this.leaf("ok", program.iteration % 2 === 0 ? "true" : "false", "bool"),
            this.node("p", "{x:1.5, y:-2}", "Point", () => [
                this.leaf("x", "1.5", "double", "p.x"),
                this.leaf("y", "-2", "double", "p.y"),
            ]),
            this.listNode("head", "head", 1),
            this.node("flags", "size=3", "std::map<std::string, bool>", () => [
                this.leaf('["debug"]', "true", "bool", 'flags["debug"]'),
                this.leaf('["trace"]', "false", "bool", 'flags["trace"]'),
                // An entry the debugger has no expression for (as CodeLLDB's synthetic children).
                this.leaf('["verbose"]', "true", "bool", ""),
            ]),
            this.node(
                "cfg",
                '{path="/home/user/hello/input.txt", limits={min=-1000, max=1000}, retries=3, mode=Fast, tags=size=2, ...}',
                "Config const&",
                () => [
                    this.leaf("path", '"/home/user/hello/input.txt"', "std::string", "cfg.path"),
                    this.node("limits", "{min=-1000, max=1000}", "Limits", () => [
                        this.leaf("min", "-1000", "int", "cfg.limits.min"),
                        this.leaf("max", "1000", "int", "cfg.limits.max"),
                    ]),
                    this.leaf("retries", "3", "int", "cfg.retries"),
                    this.leaf("mode", "Fast", "Mode", "cfg.mode"),
                ],
            ),
            this.leaf("bad", "<error: Cannot access memory at address 0x0>", "Node*"),
        ];
    }

    private listNode(name: string, evaluateName: string, value: number): DebugProtocol.Variable {
        if (value > 6) return this.leaf(name, "nullptr", "Node*", evaluateName);
        const address = `0x000055555556${(0xb2c0 + value * 0x20).toString(16)}`;
        return {
            ...this.node(name, address, "Node*", () => [
                this.leaf("value", String(value), "int", `${evaluateName}->value`),
                this.listNode("next", `${evaluateName}->next`, value + 1),
            ]),
            evaluateName,
        };
    }

    private registers(): DebugProtocol.Variable[] {
        const names = [
            "rax",
            "rbx",
            "rcx",
            "rdx",
            "rsi",
            "rdi",
            "rbp",
            "rsp",
            "r8",
            "r9",
            "r10",
            "r11",
            "r12",
            "r13",
            "r14",
            "r15",
            "rip",
            "eflags",
        ];
        return names.map((name, index) => {
            const raw =
                name === "rip"
                    ? 0x555555555189 + this.program.line * 4
                    : 0x7fffffffe000 + index * 0x18 + (name === "rax" ? this.program.iteration : 0);
            return this.leaf(name, `0x${raw.toString(16).padStart(16, "0")}`, "unsigned long");
        });
    }

    /** The locals of the top frame whose names start with the word before the cursor (on the text's first line). */
    private completions(request: DebugProtocol.Request, args: DebugProtocol.CompletionsArguments): void {
        const before = args.text.split("\n")[0].slice(0, args.column - 1);
        const word = before.slice(before.search(/[\w$]*$/u));
        const targets = this.locals(this.program.frames(1)[0])
            .filter((v) => v.name.startsWith(word))
            .map((v) => ({ label: v.name, type: "variable", detail: v.type, length: word.length }));
        this.respond(request, { targets });
    }

    private evaluate(request: DebugProtocol.Request, expression: string): void {
        if (this.running) {
            this.fail(request, "<not available>");
            return;
        }
        const trimmed = expression.trim();
        // In the scope of the main thread's top frame.
        const locals = this.locals(this.program.frames(1)[0]);
        const byName = new Map(locals.map((v) => [v.name, v]));
        const direct = byName.get(trimmed);
        if (direct !== undefined) {
            this.respond(request, {
                result: direct.value,
                type: direct.type,
                variablesReference: direct.variablesReference,
                indexedVariables: direct.indexedVariables,
            });
            return;
        }
        const index = /^nums\[(\w+)\]$/u.exec(trimmed);
        if (index !== null) {
            const i = index[1] === "i" ? this.program.iteration : Number(index[1]);
            if (Number.isInteger(i) && i >= 0 && i < 1000) {
                this.respond(request, { result: String(numAt(i)), type: "int", variablesReference: 0 });
                return;
            }
        }
        let unknown: string | undefined;
        const substituted = trimmed.replace(/[A-Za-z_]\w*/gu, (word) => {
            const local = byName.get(word);
            if (local !== undefined && /^-?\d+$/u.test(local.value)) return local.value;
            unknown ??= word;
            return word;
        });
        if (unknown !== undefined) {
            this.fail(request, `error: use of undeclared identifier '${unknown}'`);
            return;
        }
        const result = evaluateArithmetic(substituted);
        if (result === undefined) {
            this.fail(
                request,
                /\/\s*0\b/u.test(substituted) ? "error: division by zero" : "error: expected expression",
            );
            return;
        }
        this.respond(request, { result: String(result), type: "long", variablesReference: 0 });
    }

    private setVariable(request: DebugProtocol.Request, args: DebugProtocol.SetVariableArguments): void {
        const owner = this.handles
            .get(args.variablesReference)?.()
            .find((v) => v.name === args.name);
        if (owner === undefined) {
            this.fail(request, `Cannot set '${args.name}'`);
            return;
        }
        this.assign(request, owner, args.value);
    }

    /** A number goes only into a number (`int`, `long`, …), as the debugger's type check. */
    private assign(request: DebugProtocol.Request, owner: DebugProtocol.Variable, value: string): void {
        if (/^(int|long|size_t)$/u.test(String(owner.type)) && !/^-?\d+$/u.test(value)) {
            this.fail(request, `error: '${value}' is not a number`);
            return;
        }
        // Every variable of the program has its `evaluateName`.
        this.program.overrides.set(String(owner.evaluateName), value);
        this.respond(request, { value, type: owner.type });
    }

    /** A local of the top frame by its name: what WATCH sets. */
    private setExpression(request: DebugProtocol.Request, args: DebugProtocol.SetExpressionArguments): void {
        const frame = this.program.frame(args.frameId ?? 1000);
        const owner =
            frame === undefined ? undefined : this.locals(frame).find((v) => v.evaluateName === args.expression);
        if (owner === undefined) {
            this.fail(request, `Cannot set '${args.expression}'`);
            return;
        }
        this.assign(request, owner, args.value);
    }
}

/** `+ - * /` and parentheses over integers: enough for the REPL demo. `undefined` — not an expression, or `/ 0`. */
function evaluateArithmetic(text: string): number | undefined {
    const tokens = text.match(/\d+|==|[+\-*/%()>]|\S/gu) ?? [];
    let pos = 0;
    /** A comparison of two sums, as C's `0` or `1`. */
    const expr = (): number | undefined => {
        const left = additive();
        const op = tokens[pos];
        if (left === undefined || (op !== "==" && op !== ">")) return left;
        pos++;
        const right = additive();
        if (right === undefined) return undefined;
        return Number(op === "==" ? left === right : left > right);
    };
    const additive = (): number | undefined => {
        let left = term();
        while (left !== undefined && (tokens[pos] === "+" || tokens[pos] === "-")) {
            const op = tokens[pos++];
            const right = term();
            if (right === undefined) return undefined;
            left = op === "+" ? left + right : left - right;
        }
        return left;
    };
    const term = (): number | undefined => {
        let left = factor();
        while (left !== undefined && (tokens[pos] === "*" || tokens[pos] === "/" || tokens[pos] === "%")) {
            const op = tokens[pos++];
            const right = factor();
            if (right === undefined || (op !== "*" && right === 0)) return undefined;
            left = op === "*" ? left * right : op === "/" ? Math.trunc(left / right) : left % right;
        }
        return left;
    };
    const factor = (): number | undefined => {
        const t = tokens[pos++];
        if (t === "(") {
            const value = expr();
            return tokens[pos++] === ")" ? value : undefined;
        }
        if (t === "-") {
            const value = factor();
            return value === undefined ? undefined : -value;
        }
        return /^\d+$/u.test(t) ? Number(t) : undefined;
    };
    const result = expr();
    return tokens.length > 0 && pos === tokens.length ? result : undefined;
}

/** A hit count condition: the pass from which on the breakpoint stops, `>= 5` and `5` alike. */
function hitConditionHolds(condition: string, hits: number): boolean {
    return hits >= Number(/\d+/u.exec(condition)?.[0] ?? 0);
}

/** A factory of fresh synthetic adapters: each session (and each restart) gets its own program. */
export class SyntheticDebugAdapterFactory implements IDebugAdapterFactory {
    public readonly adapters: SyntheticDebugAdapter[] = [];

    public constructor(
        private readonly timing: ISyntheticTiming = SPIKE_TIMING,
        private readonly root = SYNTHETIC_PROGRAM_ROOT,
    ) {}

    public createDebugAdapter(): SyntheticDebugAdapter {
        const adapter = new SyntheticDebugAdapter(this.timing, this.root);
        this.adapters.push(adapter);
        return adapter;
    }

    public substituteVariables(_folder: unknown, config: IConfig): Promise<IConfig> {
        return Promise.resolve(config);
    }
}

/** Registers the `synthetic` debug type and its adapters, as an extension contributing a debugger would. */
export function registerSyntheticDebugger(
    adapterManager: IAdapterManager,
    timing: ISyntheticTiming = SPIKE_TIMING,
    root = SYNTHETIC_PROGRAM_ROOT,
): { readonly factory: SyntheticDebugAdapterFactory } & IDisposable {
    const factory = new SyntheticDebugAdapterFactory(timing, root);
    const debuggerRegistration = adapterManager.registerDebugger({
        type: SYNTHETIC_DEBUG_TYPE,
        label: "Synthetic (C++ under CodeLLDB)",
        languages: ["cpp"],
    });
    const factoryRegistration = adapterManager.registerDebugAdapterFactory([SYNTHETIC_DEBUG_TYPE], factory);
    return {
        factory,
        dispose: () => {
            factoryRegistration.dispose();
            debuggerRegistration.dispose();
        },
    };
}
