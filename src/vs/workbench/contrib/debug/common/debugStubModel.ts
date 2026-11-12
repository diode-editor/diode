import { Emitter } from "../../../../base/common/event.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import {
    type ContextKeyService,
    ContextKeyServiceDIToken,
} from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";

/**
 * SPIKE (not for merge): a fake debug session shaped like upstream's `debugModel.ts` — threads, frames, scopes,
 * variables with lazily loaded children, watch expressions, breakpoints and the REPL. The views read only this
 * model, so a real DAP session can take its place later. The data mimics a C++ program under CodeLLDB.
 */

export type DebugState = "inactive" | "running" | "stopped";

/** How a value is colored: upstream `renderExpressionValue` decides the same by the value's text. */
export type ValueKind = "number" | "string" | "boolean" | "object" | "pointer" | "error" | "plain";

/** Upstream `IExpression`: a variable, a scope, a chunk of a big array, a watch or a REPL result. */
export interface IDebugValue {
    /** Stable across stops: a path, so a view keeps the expansion and the change highlight finds the old value. */
    readonly id: string;
    readonly name: string;
    readonly value: string;
    readonly type?: string;
    readonly kind: ValueKind;
    readonly expandable: boolean;
    /** The value differs from the previous stop's. */
    readonly changed: boolean;
    /** A scope row (`Locals`, `Registers`): upstream draws it without a value. */
    readonly isScope?: boolean;
    getChildren(): Promise<IDebugValue[]>;
}

export interface IDebugFrame {
    readonly id: string;
    readonly name: string;
    /** `undefined` — no source: upstream draws such a frame dimmed (`presentationHint: subtle`). */
    readonly source?: string;
    readonly line: number;
    readonly column: number;
}

export interface IDebugThread {
    readonly id: number;
    readonly name: string;
    /** `PAUSED ON BREAKPOINT`, `PAUSED`, `RUNNING`. */
    readonly stateLabel: string;
    readonly frames: readonly IDebugFrame[];
    /** DAP `totalFrames`: upstream loads the first 20 and shows "Load More Stack Frames". */
    readonly totalFrames: number;
}

export interface IDebugBreakpoint {
    readonly id: number;
    readonly file: string;
    readonly dir: string;
    readonly line: number;
    enabled: boolean;
    readonly condition?: string;
    readonly logMessage?: string;
    readonly hitCondition?: string;
    readonly verified: boolean;
}

export interface IExceptionFilter {
    readonly id: string;
    readonly label: string;
    enabled: boolean;
}

export type ReplSeverity = "stdout" | "stderr" | "info" | "warning" | "error";

export type ReplEntry =
    | { readonly kind: "output"; readonly id: string; readonly text: string; readonly severity: ReplSeverity; readonly source?: string }
    | { readonly kind: "input"; readonly id: string; readonly text: string }
    | { readonly kind: "result"; readonly id: string; readonly value: IDebugValue };

export interface IWatchExpression {
    readonly id: string;
    readonly expression: string;
}

/** Simulated adapter latency of `variables`/`evaluate`: long enough to see the loading row. */
const LATENCY_MS = 250;

const MAIN_CPP = "main.cpp";
const LIST_CPP = "list.cpp";
const SRC_DIR = "src";

class StubValue implements IDebugValue {
    private cache: Promise<IDebugValue[]> | undefined;

    public constructor(
        public readonly id: string,
        public readonly name: string,
        public readonly value: string,
        public readonly kind: ValueKind,
        public readonly changed: boolean,
        private readonly childFactory?: () => IDebugValue[],
        public readonly type?: string,
        public readonly isScope?: boolean,
    ) {}

    public get expandable(): boolean {
        return this.childFactory !== undefined;
    }

    public getChildren(): Promise<IDebugValue[]> {
        const factory = this.childFactory;
        if (factory === undefined) return Promise.resolve([]);
        this.cache ??= new Promise((resolve) => {
            setTimeout(() => {
                resolve(factory());
            }, LATENCY_MS);
        });
        return this.cache;
    }
}

export const DebugStubModelDIToken = token<DebugStubModel>("DebugStubModel");

export class DebugStubModel extends Disposable {
    public static dependencies = [ContextKeyServiceDIToken] as const;

    private readonly onDidChangeStateEmitter = this.register(new Emitter<void>());
    /** A stop, a continue, a step, the end: the call stack, variables and watch are read anew. */
    public readonly onDidChangeState = this.onDidChangeStateEmitter.event;
    private readonly onDidChangeReplEmitter = this.register(new Emitter<void>());
    public readonly onDidChangeRepl = this.onDidChangeReplEmitter.event;
    private readonly onDidChangeBreakpointsEmitter = this.register(new Emitter<void>());
    public readonly onDidChangeBreakpoints = this.onDidChangeBreakpointsEmitter.event;
    private readonly onDidChangeWatchEmitter = this.register(new Emitter<void>());
    public readonly onDidChangeWatch = this.onDidChangeWatchEmitter.event;
    private readonly onDidFocusFrameEmitter = this.register(new Emitter<void>());
    public readonly onDidFocusFrame = this.onDidFocusFrameEmitter.event;

    private stateValue: DebugState = "inactive";
    /** The loop counter of `accumulate`: every step moves it. */
    private iteration = 0;
    private line = 27;
    private stopReason = "breakpoint";
    private focusedThreadId = 1;
    private focusedFrameIndex = 0;
    /** Path → value of the previous stop: what `changed` compares against. */
    private previousValues = new Map<string, string>();
    private currentValues = new Map<string, string>();
    private timer: ReturnType<typeof setTimeout> | undefined;
    private entryCounter = 0;
    private watchCounter = 0;

    public readonly repl: ReplEntry[] = [];
    public readonly watches: IWatchExpression[] = [
        { id: "w0", expression: "sum" },
        { id: "w1", expression: "nums[i]" },
        { id: "w2", expression: "p" },
        { id: "w3", expression: "total / count" },
    ];
    public readonly exceptionFilters: IExceptionFilter[] = [
        { id: "cpp_throw", label: "C++: on throw", enabled: false },
        { id: "cpp_catch", label: "C++: on catch", enabled: false },
    ];
    public readonly breakpoints: IDebugBreakpoint[] = [
        { id: 1, file: MAIN_CPP, dir: SRC_DIR, line: 27, enabled: true, verified: true },
        { id: 2, file: MAIN_CPP, dir: SRC_DIR, line: 58, enabled: true, verified: true },
        { id: 3, file: LIST_CPP, dir: SRC_DIR, line: 42, enabled: false, verified: true },
        {
            id: 4,
            file: MAIN_CPP,
            dir: SRC_DIR,
            line: 31,
            enabled: true,
            condition: "i % 100 == 0",
            verified: true,
        },
        {
            id: 5,
            file: MAIN_CPP,
            dir: SRC_DIR,
            line: 35,
            enabled: true,
            logMessage: "sum={sum} i={i}",
            verified: true,
        },
        { id: 6, file: "util.h", dir: "include", line: 12, enabled: true, verified: false },
    ];
    private nextBreakpointId = 7;

    public constructor(private readonly contextKeys: ContextKeyService) {
        super();
        this.syncContextKeys();
        this.register({
            dispose: () => {
                clearTimeout(this.timer);
            },
        });
    }

    public get state(): DebugState {
        return this.stateValue;
    }

    public get sessionName(): string {
        return "Launch hello (lldb)";
    }

    public get focusedFrameId(): string | undefined {
        if (this.stateValue !== "stopped") return undefined;
        return this.threads.find((t) => t.id === this.focusedThreadId)?.frames[this.focusedFrameIndex]?.id;
    }

    public get threads(): readonly IDebugThread[] {
        if (this.stateValue === "inactive") return [];
        const running = this.stateValue === "running";
        const mainFrames: IDebugFrame[] = [
            { id: "t1f0", name: "accumulate(std::vector<int> const&)", source: MAIN_CPP, line: this.line, column: 9 },
            { id: "t1f1", name: "process(Config const&)", source: MAIN_CPP, line: 47, column: 14 },
            { id: "t1f2", name: "main(int, char**)", source: MAIN_CPP, line: 58, column: 12 },
        ];
        for (let i = 0; i < 20; i++) {
            mainFrames.push({ id: `t1f${String(3 + i)}`, name: `recurse<${String(i)}>(Node*)`, source: LIST_CPP, line: 90 + i, column: 5 });
        }
        mainFrames.push(
            { id: "t1f23", name: "__libc_start_call_main", line: 0, column: 0 },
            { id: "t1f24", name: "__libc_start_main_impl", line: 0, column: 0 },
            { id: "t1f25", name: "_start", line: 0, column: 0 },
        );
        const stopLabel =
            this.stopReason === "exception" ? "PAUSED ON EXCEPTION" : `PAUSED ON ${this.stopReason.toUpperCase()}`;
        return [
            {
                id: 1,
                name: "hello",
                stateLabel: running ? "RUNNING" : stopLabel,
                frames: running ? [] : mainFrames,
                totalFrames: mainFrames.length,
            },
            {
                id: 2,
                name: "worker-1",
                stateLabel: running ? "RUNNING" : "PAUSED",
                frames: running
                    ? []
                    : [
                          { id: "t2f0", name: "__futex_abstimed_wait_common", line: 0, column: 0 },
                          { id: "t2f1", name: "std::condition_variable::wait(std::unique_lock<std::mutex>&)", line: 0, column: 0 },
                          { id: "t2f2", name: "WorkQueue::pop()", source: "queue.cpp", line: 18, column: 7 },
                          { id: "t2f3", name: "worker(int)", source: MAIN_CPP, line: 70, column: 21 },
                      ],
                totalFrames: 4,
            },
            {
                id: 3,
                name: "worker-2",
                stateLabel: running ? "RUNNING" : "PAUSED",
                frames: running
                    ? []
                    : [
                          { id: "t3f0", name: "__futex_abstimed_wait_common", line: 0, column: 0 },
                          { id: "t3f1", name: "WorkQueue::pop()", source: "queue.cpp", line: 18, column: 7 },
                      ],
                totalFrames: 2,
            },
        ];
    }

    public focusFrame(frameId: string): void {
        for (const thread of this.threads) {
            const index = thread.frames.findIndex((f) => f.id === frameId);
            if (index < 0) continue;
            if (thread.id === this.focusedThreadId && index === this.focusedFrameIndex) return;
            this.focusedThreadId = thread.id;
            this.focusedFrameIndex = index;
            this.onDidFocusFrameEmitter.fire();
            return;
        }
    }

    /** Upstream `StackFrame.getScopes()` of the focused frame. */
    public getScopes(): IDebugValue[] {
        if (this.stateValue !== "stopped") return [];
        const frame = this.threads.find((t) => t.id === this.focusedThreadId)?.frames[this.focusedFrameIndex];
        if (frame === undefined) return [];
        const scopes: IDebugValue[] = [];
        if (frame.source !== undefined) {
            scopes.push(
                this.scope(`${frame.id}/Locals`, "Locals", () => this.locals(`${frame.id}/Locals`, frame)),
                this.scope(`${frame.id}/Static`, "Static", () => [
                    this.leaf(`${frame.id}/Static/instances`, "Counter::instances", "3", "number", "int"),
                ]),
                this.scope(`${frame.id}/Global`, "Global", () => [
                    this.leaf(`${frame.id}/Global/g_verbose`, "g_verbose", "false", "boolean", "bool"),
                    this.leaf(`${frame.id}/Global/g_name`, "g_name", '"hello"', "string", "char const*"),
                ]),
            );
        }
        scopes.push(this.scope(`${frame.id}/Registers`, "Registers", () => this.registers(`${frame.id}/Registers`)));
        return scopes;
    }

    public evaluate(expression: string, idPrefix: string): IDebugValue {
        const trimmed = expression.trim();
        if (this.stateValue !== "stopped") {
            return this.leaf(idPrefix, trimmed, "<not available>", "error");
        }
        const frame = this.threads[0]?.frames[0];
        const locals = frame === undefined ? [] : this.locals(idPrefix, frame);
        const byName = new Map(locals.map((v) => [v.name, v]));
        const direct = byName.get(trimmed);
        if (direct !== undefined) return direct;
        const index = /^(\w+)\[(\w+)\]$/u.exec(trimmed);
        if (index !== null && index[1] === "nums") {
            const i = index[2] === "i" ? this.iteration : Number(index[2]);
            if (Number.isInteger(i) && i >= 0 && i < 1000) {
                return this.leaf(idPrefix, trimmed, String(numAt(i)), "number", "int");
            }
        }
        const member = /^(\w+)\.(\w+)$/u.exec(trimmed);
        if (member !== null && member[1] === "p") {
            if (member[2] === "x") return this.leaf(idPrefix, trimmed, "1.5", "number", "double");
            if (member[2] === "y") return this.leaf(idPrefix, trimmed, "-2", "number", "double");
        }
        if (trimmed === "nums.size()") return this.leaf(idPrefix, trimmed, "1000", "number", "size_t");
        if (trimmed === "head->next->value") return this.leaf(idPrefix, trimmed, "2", "number", "int");
        let unknown: string | undefined;
        const substituted = trimmed.replace(/[A-Za-z_]\w*/gu, (word) => {
            const local = byName.get(word);
            if (local?.kind === "number") return local.value;
            unknown ??= word;
            return word;
        });
        if (unknown !== undefined) {
            return this.leaf(idPrefix, trimmed, `error: use of undeclared identifier '${unknown}'`, "error");
        }
        if (/^[\d\s+\-*/().]+$/u.test(substituted) && substituted.trim() !== "") {
            const result = evaluateArithmetic(substituted);
            if (result !== undefined) return this.leaf(idPrefix, trimmed, String(result), "number", "long");
            return this.leaf(idPrefix, trimmed, "error: division by zero", "error");
        }
        return this.leaf(idPrefix, trimmed, "error: expected expression", "error");
    }

    // --- Session control ---------------------------------------------------------------------------------------------

    public start(): void {
        if (this.stateValue !== "inactive") return;
        this.iteration = 0;
        this.line = 27;
        this.previousValues = new Map();
        this.currentValues = new Map();
        this.repl.length = 0;
        this.setState("running");
        this.append({ kind: "output", text: "Launching: /home/user/hello/build/hello --verbose input.txt", severity: "info" });
        this.append({ kind: "output", text: "Launched process 48213 from '/home/user/hello/build/hello'", severity: "info" });
        this.timer = setTimeout(() => {
            this.append({ kind: "output", text: "Hello from hello 1.2.0!", severity: "stdout" });
            this.append({ kind: "output", text: "Reading input.txt: 1000 numbers", severity: "stdout" });
            this.append({
                kind: "output",
                text: "warning: (x86_64) /lib/x86_64-linux-gnu/libstdc++.so.6 unable to locate separate debug file (dwo id 0x9a3c7e1f00b2d14e): No such file or directory — this line is long on purpose to see what the console does with it",
                severity: "warning",
            });
            this.stop("breakpoint");
        }, 600);
    }

    public continue(): void {
        if (this.stateValue !== "stopped") return;
        this.setState("running");
        this.timer = setTimeout(() => {
            this.iteration += 100;
            this.line = 31;
            this.append({ kind: "output", text: `sum=${String(this.sum())} i=${String(this.iteration)}`, severity: "info", source: "main.cpp:35" });
            this.stop("breakpoint");
        }, 700);
    }

    public pause(): void {
        if (this.stateValue !== "running") return;
        clearTimeout(this.timer);
        this.stop("pause");
    }

    public step(kind: "over" | "into" | "out"): void {
        if (this.stateValue !== "stopped") return;
        this.setState("running");
        this.timer = setTimeout(() => {
            if (kind === "over") {
                this.line = this.line >= 31 ? 27 : this.line + 1;
                if (this.line === 27) this.iteration++;
            } else if (kind === "into") {
                this.line = 28;
            } else {
                this.line = 27;
                this.iteration++;
            }
            if (this.iteration === 3 && kind === "over") {
                this.append({ kind: "output", text: "terminate called after throwing an instance of 'std::out_of_range'", severity: "stderr" });
                this.stop("exception");
                return;
            }
            this.stop("step");
        }, 120);
    }

    public terminate(): void {
        if (this.stateValue === "inactive") return;
        clearTimeout(this.timer);
        this.append({ kind: "output", text: "Process exited with code 0.", severity: "info" });
        this.setState("inactive");
    }

    public restart(): void {
        this.terminate();
        this.start();
    }

    // --- REPL ----------------------------------------------------------------------------------------------------------

    public evaluateInRepl(expression: string): void {
        this.append({ kind: "input", text: expression });
        const id = this.nextEntryId();
        const delayed = (): void => {
            this.repl.push({ kind: "result", id, value: this.evaluate(expression, `repl/${id}`) });
            this.onDidChangeReplEmitter.fire();
        };
        setTimeout(delayed, 60);
    }

    public clearRepl(): void {
        this.repl.length = 0;
        this.onDidChangeReplEmitter.fire();
    }

    // --- Watch ---------------------------------------------------------------------------------------------------------

    public addWatch(expression: string): void {
        this.watches.push({ id: `w${String(100 + this.watchCounter++)}`, expression });
        this.onDidChangeWatchEmitter.fire();
    }

    public removeWatch(id: string): void {
        const index = this.watches.findIndex((w) => w.id === id);
        if (index < 0) return;
        this.watches.splice(index, 1);
        this.onDidChangeWatchEmitter.fire();
    }

    public removeAllWatches(): void {
        this.watches.length = 0;
        this.onDidChangeWatchEmitter.fire();
    }

    // --- Breakpoints ---------------------------------------------------------------------------------------------------

    public toggleBreakpoint(id: number): void {
        const bp = this.breakpoints.find((b) => b.id === id);
        if (bp === undefined) return;
        bp.enabled = !bp.enabled;
        this.onDidChangeBreakpointsEmitter.fire();
    }

    public toggleExceptionFilter(id: string): void {
        const filter = this.exceptionFilters.find((f) => f.id === id);
        if (filter === undefined) return;
        filter.enabled = !filter.enabled;
        this.onDidChangeBreakpointsEmitter.fire();
    }

    public removeBreakpoint(id: number): void {
        const index = this.breakpoints.findIndex((b) => b.id === id);
        if (index < 0) return;
        this.breakpoints.splice(index, 1);
        this.onDidChangeBreakpointsEmitter.fire();
    }

    public removeAllBreakpoints(): void {
        this.breakpoints.length = 0;
        this.onDidChangeBreakpointsEmitter.fire();
    }

    public addFunctionBreakpoint(name: string): void {
        this.breakpoints.push({ id: this.nextBreakpointId++, file: name, dir: "", line: 0, enabled: true, verified: true });
        this.onDidChangeBreakpointsEmitter.fire();
    }

    // --- Internals -----------------------------------------------------------------------------------------------------

    private stop(reason: string): void {
        this.stopReason = reason;
        this.focusedThreadId = 1;
        this.focusedFrameIndex = 0;
        this.previousValues = this.currentValues;
        this.currentValues = new Map();
        this.setState("stopped");
    }

    private setState(state: DebugState): void {
        this.stateValue = state;
        this.syncContextKeys();
        this.onDidChangeStateEmitter.fire();
    }

    private syncContextKeys(): void {
        // Upstream `CONTEXT_DEBUG_STATE` and `CONTEXT_IN_DEBUG_MODE`.
        this.contextKeys.setRaw("debugState", this.stateValue);
        this.contextKeys.setRaw("inDebugMode", this.stateValue !== "inactive");
    }

    private append(entry: { kind: "output"; text: string; severity: ReplSeverity; source?: string } | { kind: "input"; text: string }): void {
        this.repl.push({ ...entry, id: this.nextEntryId() });
        this.onDidChangeReplEmitter.fire();
    }

    private nextEntryId(): string {
        return `e${String(this.entryCounter++)}`;
    }

    private sum(): number {
        let sum = 0;
        for (let i = 0; i < this.iteration; i++) sum += numAt(i);
        return sum;
    }

    private scope(id: string, name: string, children: () => IDebugValue[]): IDebugValue {
        return new StubValue(id, name, "", "plain", false, children, undefined, true);
    }

    private leaf(id: string, name: string, value: string, kind: ValueKind, type?: string): IDebugValue {
        return new StubValue(id, name, value, kind, this.track(id, value), undefined, type);
    }

    private node(id: string, name: string, value: string, type: string, children: () => IDebugValue[]): IDebugValue {
        return new StubValue(id, name, value, "object", this.track(id, value), children, type);
    }

    /** Records the value of this stop; `true` when the previous stop had another one. */
    private track(id: string, value: string): boolean {
        this.currentValues.set(id, value);
        const before = this.previousValues.get(id);
        return before !== undefined && before !== value;
    }

    private locals(prefix: string, frame: IDebugFrame): IDebugValue[] {
        if (frame.id !== "t1f0") {
            return [
                this.leaf(`${prefix}/argc`, "argc", "3", "number", "int"),
                this.node(`${prefix}/argv`, "argv", "0x00007fffffffe2a8", "char**", () => [
                    this.leaf(`${prefix}/argv/0`, "[0]", '"/home/user/hello/build/hello"', "string", "char*"),
                    this.leaf(`${prefix}/argv/1`, "[1]", '"--verbose"', "string", "char*"),
                    this.leaf(`${prefix}/argv/2`, "[2]", '"input.txt"', "string", "char*"),
                ]),
                this.leaf(`${prefix}/rc`, "rc", "0", "number", "int"),
            ];
        }
        const i = this.iteration;
        return [
            this.node(`${prefix}/nums`, "nums", "size=1000", "std::vector<int>", () => this.chunks(`${prefix}/nums`, 1000)),
            this.leaf(`${prefix}/i`, "i", String(i), "number", "size_t"),
            this.leaf(`${prefix}/sum`, "sum", String(this.sum()), "number", "long"),
            this.leaf(`${prefix}/total`, "total", String(this.sum() * 2), "number", "long"),
            this.leaf(`${prefix}/count`, "count", "0", "number", "int"),
            this.leaf(`${prefix}/name`, "name", '"accumulator"', "string", "std::string"),
            this.leaf(`${prefix}/ok`, "ok", i % 2 === 0 ? "true" : "false", "boolean", "bool"),
            this.node(`${prefix}/p`, "p", "{x:1.5, y:-2}", "Point", () => [
                this.leaf(`${prefix}/p/x`, "x", "1.5", "number", "double"),
                this.leaf(`${prefix}/p/y`, "y", "-2", "number", "double"),
            ]),
            this.listNode(`${prefix}/head`, "head", 1),
            this.node(`${prefix}/flags`, "flags", "size=3", "std::map<std::string, bool>", () => [
                this.leaf(`${prefix}/flags/debug`, '["debug"]', "true", "boolean", "bool"),
                this.leaf(`${prefix}/flags/trace`, '["trace"]', "false", "boolean", "bool"),
                this.leaf(`${prefix}/flags/verbose`, '["verbose"]', "true", "boolean", "bool"),
            ]),
            this.node(
                `${prefix}/cfg`,
                "cfg",
                "{path=\"/home/user/hello/input.txt\", limits={min=-1000, max=1000}, retries=3, mode=Fast, tags=size=2, ...}",
                "Config const&",
                () => [
                    this.leaf(`${prefix}/cfg/path`, "path", '"/home/user/hello/input.txt"', "string", "std::string"),
                    this.node(`${prefix}/cfg/limits`, "limits", "{min=-1000, max=1000}", "Limits", () => [
                        this.leaf(`${prefix}/cfg/limits/min`, "min", "-1000", "number", "int"),
                        this.leaf(`${prefix}/cfg/limits/max`, "max", "1000", "number", "int"),
                    ]),
                    this.leaf(`${prefix}/cfg/retries`, "retries", "3", "number", "int"),
                    this.leaf(`${prefix}/cfg/mode`, "mode", "Fast", "plain", "Mode"),
                ],
            ),
            this.leaf(`${prefix}/bad`, "bad", "<error: Cannot access memory at address 0x0>", "error", "Node*"),
        ];
    }

    /** Upstream splits a variable with more than 100 indexed children into `[0..99]` chunks. */
    private chunks(prefix: string, size: number): IDebugValue[] {
        const result: IDebugValue[] = [];
        for (let start = 0; start < size; start += 100) {
            const end = Math.min(size, start + 100) - 1;
            result.push(
                new StubValue(`${prefix}/[${String(start)}]`, `[${String(start)}..${String(end)}]`, "", "plain", false, () => {
                    const items: IDebugValue[] = [];
                    for (let i = start; i <= end; i++) {
                        items.push(this.leaf(`${prefix}/${String(i)}`, `[${String(i)}]`, String(numAt(i)), "number", "int"));
                    }
                    return items;
                }),
            );
        }
        return result;
    }

    private listNode(id: string, name: string, value: number): IDebugValue {
        if (value > 6) return this.leaf(id, name, "nullptr", "pointer", "Node*");
        const address = `0x000055555556${(0xb2c0 + value * 0x20).toString(16)}`;
        return this.node(id, name, address, "Node*", () => [
            this.leaf(`${id}/value`, "value", String(value), "number", "int"),
            this.listNode(`${id}/next`, "next", value + 1),
        ]);
    }

    private registers(prefix: string): IDebugValue[] {
        const names = ["rax", "rbx", "rcx", "rdx", "rsi", "rdi", "rbp", "rsp", "r8", "r9", "r10", "r11", "r12", "r13", "r14", "r15", "rip", "eflags"];
        return names.map((name, index) => {
            const raw = name === "rip" ? 0x555555555189 + this.line * 4 : 0x7fffffffe000 + index * 0x18 + (name === "rax" ? this.iteration : 0);
            return this.leaf(`${prefix}/${name}`, name, `0x${raw.toString(16).padStart(16, "0")}`, "number", "unsigned long");
        });
    }
}

function numAt(i: number): number {
    return ((i * 37) % 101) - 17;
}

/** `+ - * /` and parentheses over integers: enough for the REPL demo. */
function evaluateArithmetic(text: string): number | undefined {
    const tokens = text.match(/\d+|[+\-*/()]/gu) ?? [];
    let pos = 0;
    const expr = (): number | undefined => {
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
        while (left !== undefined && (tokens[pos] === "*" || tokens[pos] === "/")) {
            const op = tokens[pos++];
            const right = factor();
            if (right === undefined || (op === "/" && right === 0)) return undefined;
            left = op === "*" ? left * right : Math.trunc(left / right);
        }
        return left;
    };
    const factor = (): number | undefined => {
        const t = tokens[pos++];
        if (t === "(") {
            const value = expr();
            if (tokens[pos++] !== ")") return undefined;
            return value;
        }
        if (t === "-") {
            const value = factor();
            return value === undefined ? undefined : -value;
        }
        return t !== undefined && /^\d+$/u.test(t) ? Number(t) : undefined;
    };
    const result = expr();
    return pos === tokens.length ? result : undefined;
}
