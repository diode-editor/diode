import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    createMockDebugModel,
    mockSession,
    mockStateService,
    testSession,
} from "../../../../../TestUtils/mockDebug.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../base/test/common/utils.ts";
import { NULL_LOGGER } from "../../../../platform/log/common/nullLogService.ts";

import { DataBreakpointSetType, type IDebugSession, type IStackFrame } from "./debug.ts";
import {
    Breakpoint,
    type DebugModel,
    Expression,
    ExpressionContainer,
    Scope,
    StackFrame,
    Thread,
    Variable,
} from "./debugModel.ts";
import { Source } from "./debugSource.ts";

const FILE = Uri.file("/src/main.cpp");
const RANGE = { startLineNumber: 4, startColumn: 2, endLineNumber: 4, endColumn: 9 };

function variablesOf(table: Record<number, DebugProtocol.Variable[]>): IDebugSession["variables"] {
    return (reference, _threadId, _filter, start, count) => {
        const all = table[reference] ?? [];
        const variables = start === undefined ? all : all.slice(start, start + (count ?? all.length));
        return Promise.resolve({ body: { variables } } as DebugProtocol.VariablesResponse);
    };
}

function frameIn(
    thread: Thread,
    name = "main",
    src = new Source({ path: "/a.cpp" }, "s", NULL_LOGGER),
    ip?: string,
): StackFrame {
    return new StackFrame(thread, 1, src, name, undefined, RANGE, 0, true, ip);
}

function scopesFrame(scopes: DebugProtocol.Scope[]): StackFrame {
    const session = mockSession({
        scopes: () => Promise.resolve({ body: { scopes } } as DebugProtocol.ScopesResponse),
    });
    return frameIn(new Thread(session, "main", 1));
}

describe("expressions and variables: details", () => {
    it("a container is not changed before it has a value, a scope never", () => {
        expect(new ExpressionContainer(undefined, 1, 0, "fresh").valueChanged).toBe(false);
        const session = mockSession();
        expect(new Scope(frameIn(new Thread(session, "t", 1)), 1, "Locals", 2, false).valueChanged).toBe(false);
    });

    it("exactly 10000 indexed children are 100 chunks of 100", async () => {
        const root = new ExpressionContainer(mockSession({ variables: variablesOf({}) }), 1, 9, "root", 0, 10_000);
        const chunks = (await root.getChildren()) as Variable[];
        expect(chunks).toHaveLength(100);
        expect(chunks[1].name).toBe("[100..199]");
        expect([chunks[1].evaluateName, chunks[1].available]).toEqual(["", true]);
    });

    it("a negative reference has no children", () => {
        expect(new ExpressionContainer(mockSession(), 1, -1, "neg").hasChildren).toBe(false);
    });

    it("autoExpandLazyVariables resolves only the lazy children", async () => {
        const table = {
            5: [
                { name: "lazy", value: "", variablesReference: 6, presentationHint: { lazy: true } },
                { name: "plain", value: "2", variablesReference: 7 },
            ],
            6: [{ name: "", value: "computed", variablesReference: 0 }],
            7: [{ name: "only", value: "child", variablesReference: 0 }],
        };
        const root = new ExpressionContainer(
            mockSession({ variables: variablesOf(table), autoExpandLazyVariables: true }),
            1,
            5,
            "r",
        );
        const [lazy, plain] = (await root.getChildren()) as Variable[];
        expect(lazy.value).toBe("computed");
        expect([plain.value, plain.reference]).toEqual(["2", 7]);
    });

    it("no answer to evaluate keeps the value, no answer to setVariable keeps it without an error", async () => {
        const silent = mockSession({
            evaluate: () => Promise.resolve(undefined),
            setVariable: () => Promise.resolve(undefined),
        });
        const frame = frameIn(new Thread(silent, "t", 1));
        const expression = new Expression("x");
        await expression.evaluate(silent, frame, "watch");
        expect(expression.value).toBe("not available");

        const v = new Variable(
            silent,
            1,
            new ExpressionContainer(silent, 1, 5, "p"),
            0,
            "v",
            "v",
            "1",
            0,
            0,
            undefined,
            undefined,
        );
        expect(v.available).toBe(true);
        await v.setVariable("2", frame);
        expect([v.value, v.errorMessage]).toEqual(["1", undefined]);
    });

    it("a variable without a session sets nothing and reports no error", async () => {
        const orphan = new Variable(
            undefined,
            1,
            new ExpressionContainer(undefined, 1, 5, "p"),
            0,
            "v",
            "v",
            "1",
            0,
            0,
            undefined,
            undefined,
        );
        await orphan.setVariable("2", frameIn(new Thread(mockSession(), "t", 1)));
        expect(orphan.errorMessage).toBeUndefined();
    });

    it("an evaluated expression reports its reference", async () => {
        const session = mockSession({
            evaluate: () =>
                Promise.resolve({ body: { result: "{...}", variablesReference: 5 } } as DebugProtocol.EvaluateResponse),
        });
        const expression = new Expression("obj");
        await expression.evaluate(session, frameIn(new Thread(session, "t", 1)), "watch");
        expect(expression.toDebugProtocolObject().variablesReference).toBe(5);
    });
});

describe("scopes: ids and ranges", () => {
    it("a scope keeps its id whatever its position in the answer", async () => {
        const locals = { name: "Locals", variablesReference: 1, expensive: false, line: 1, column: 1 };
        const globals = { name: "Globals", variablesReference: 2, expensive: false, line: 1, column: 1 };
        const first = await scopesFrame([locals, globals]).getScopes();
        const second = await scopesFrame([globals, locals]).getScopes();
        expect(second.find((s) => s.name === "Locals")?.getId()).toBe(first.find((s) => s.name === "Locals")?.getId());
    });

    it("a scope missing any end of its range has none", async () => {
        const base = { variablesReference: 1, expensive: false, line: 2, column: 1, endLine: 9, endColumn: 1 };
        const scopes = await scopesFrame([
            { ...base, name: "noLine", line: undefined },
            { ...base, name: "noColumn", column: undefined },
        ]).getScopes();
        expect(scopes.map((s) => s.range)).toEqual([undefined, undefined]);
    });

    it("the most specific scopes leave out the ones without a range when some have one, and sort by height", async () => {
        const scope = (name: string, line?: number, endLine?: number): DebugProtocol.Scope => ({
            name,
            variablesReference: 1,
            expensive: false,
            ...(line === undefined ? {} : { line, column: 1, endLine, endColumn: 99 }),
        });
        const frame = scopesFrame([scope("Function", 1, 10), scope("NoRange"), scope("Block", 4, 12)]);
        expect((await frame.getMostSpecificScopes(RANGE)).map((s) => s.name)).toEqual(["Block", "Function"]);
    });
});

describe("threads: details", () => {
    const getSource = (raw?: DebugProtocol.Source): Source => new Source(raw, "s", NULL_LOGGER);

    it("has no stale call stack before it is first cleared", () => {
        expect(new Thread(mockSession(), "t", 1).getStaleCallStack()).toEqual([]);
    });

    it("an instruction stop skips frames without an instruction pointer and without a source", () => {
        const thread = new Thread(mockSession(), "t", 1);
        thread.stoppedDetails = { reason: "instruction breakpoint" };
        const blank = frameIn(thread, "blank", new Source(undefined, "s", NULL_LOGGER));
        const asm = frameIn(thread, "asm", new Source(undefined, "s", NULL_LOGGER), "0x1");
        (thread as unknown as { callStack: IStackFrame[] }).callStack = [blank, asm];
        expect(thread.getTopStackFrame()).toBe(asm);
    });

    it("reaches the end when the total is fetched, also when the adapter gave more than asked", async () => {
        const frames = Array.from({ length: 4 }, (_, i) => ({ id: i, name: `f${String(i)}`, line: 1, column: 1 }));
        const thread = new Thread(
            mockSession({
                stackTrace: () =>
                    Promise.resolve({
                        body: { stackFrames: frames, totalFrames: 4 },
                    } as DebugProtocol.StackTraceResponse),
                getSource,
            }),
            "t",
            1,
        );
        thread.stopped = true;
        thread.stoppedDetails = { reason: "step" };
        await thread.fetchCallStack(2);
        expect(thread.getCallStack()).toHaveLength(4);
        expect(thread.reachedEndOfCallStack).toBe(true);
    });
});

describe("breakpoints: details", () => {
    it("a breakpoint that never triggered forgets nothing", () => {
        const bp = new Breakpoint(
            { uri: FILE, lineNumber: 1, column: undefined, adapterData: undefined, triggeredBy: undefined },
            { isDirty: () => false },
            NULL_LOGGER,
        );
        bp.setSessionDidTrigger("s", false);
        expect(bp.getSessionDidTrigger("s")).toBe(false);
    });

    it("update leaves out what it is not given", () => {
        const bp = new Breakpoint(
            {
                uri: FILE,
                lineNumber: 1,
                column: 3,
                adapterData: undefined,
                triggeredBy: undefined,
                hitCondition: "2",
                logMessage: "m",
            },
            { isDirty: () => false },
            NULL_LOGGER,
        );
        bp.update({});
        expect([bp.column, bp.hitCondition, bp.logMessage]).toEqual([3, "2", "m"]);
    });
});

describe("DebugModel: details", () => {
    const disposables = ensureNoDisposablesAreLeakedInTestSuite();
    let model: DebugModel;
    let events: ReturnType<typeof vi.fn<(e: unknown) => void>>;

    beforeEach(() => {
        model = createMockDebugModel(disposables);
        events = vi.fn<(e: unknown) => void>();
        disposables.add(model.onDidChangeBreakpoints(events));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("breakpoints start activated", () => {
        expect(model.areBreakpointsActivated()).toBe(true);
    });

    it("reports exactly what was added, changed and removed", () => {
        const fbp = model.addFunctionBreakpoint({ name: "f" }, "f1");
        expect(events).toHaveBeenLastCalledWith({ added: [fbp], sessionOnly: false });

        model.addDataBreakpoint(
            {
                description: "d",
                src: { type: DataBreakpointSetType.Variable, dataId: "d" },
                canPersist: false,
                accessTypes: undefined,
                accessType: "write",
            },
            "d1",
        );
        model.addDataBreakpoint(
            {
                description: "e",
                src: { type: DataBreakpointSetType.Variable, dataId: "e" },
                canPersist: false,
                accessTypes: undefined,
                accessType: "write",
            },
            "d2",
        );
        const [d1, d2] = model.getDataBreakpoints();
        expect(events).toHaveBeenLastCalledWith({ added: [d2], sessionOnly: false });
        model.updateDataBreakpoint("d1", { hitCondition: "3" });
        expect(events).toHaveBeenLastCalledWith({ changed: [d1], sessionOnly: false });
        model.removeDataBreakpoints("d1");
        expect(events).toHaveBeenLastCalledWith({ removed: [d1], sessionOnly: false });
        expect(model.getDataBreakpoints()).toEqual([d2]);

        model.addInstructionBreakpoint({ instructionReference: "r", offset: 0, address: 1n, canPersist: false });
        model.addInstructionBreakpoint({ instructionReference: "q", offset: 0, address: 2n, canPersist: false });
        const [i1, i2] = model.getInstructionBreakpoints();
        expect(events).toHaveBeenLastCalledWith({ added: [i2], sessionOnly: true });
        model.removeInstructionBreakpoints(undefined, undefined, 1n);
        expect(events).toHaveBeenLastCalledWith({ removed: [i1], sessionOnly: false });
        expect(model.getInstructionBreakpoints()).toEqual([i2]);

        model.setBreakpointsActivated(false);
        expect(events).toHaveBeenLastCalledWith(undefined);
    });

    it("an update keeps the fields it is not given, a removal by id keeps the others", () => {
        const f1 = model.addFunctionBreakpoint({ name: "f", condition: "c", hitCondition: "h" }, "f1");
        const f2 = model.addFunctionBreakpoint({ name: "g" }, "f2");
        model.updateFunctionBreakpoint("f1", { name: "renamed" });
        expect([f1.name, f1.condition, f1.hitCondition]).toEqual(["renamed", "c", "h"]);
        model.removeFunctionBreakpoints("f1");
        expect(events).toHaveBeenLastCalledWith({ removed: [f1], sessionOnly: false });
        expect(model.getFunctionBreakpoints()).toEqual([f2]);

        model.addDataBreakpoint(
            {
                description: "d",
                src: { type: DataBreakpointSetType.Variable, dataId: "d" },
                canPersist: false,
                accessTypes: undefined,
                accessType: "write",
                condition: "c",
                hitCondition: "h",
            },
            "d1",
        );
        model.updateDataBreakpoint("d1", {});
        expect([model.getDataBreakpoints()[0].condition, model.getDataBreakpoints()[0].hitCondition]).toEqual([
            "c",
            "h",
        ]);
    });

    it("removing instruction breakpoints by reference respects the offset", () => {
        model.addInstructionBreakpoint({ instructionReference: "r", offset: 4, address: 1n, canPersist: false });
        model.removeInstructionBreakpoints("r", 5);
        expect(model.getInstructionBreakpoints()).toHaveLength(1);
    });

    it("exception filters seen again change nothing, removing a session's support takes them from it", () => {
        model.setExceptionBreakpointsForSession("s", [{ filter: "f", label: "F" }]);
        expect(events).toHaveBeenCalledOnce();
        model.setExceptionBreakpointsForSession("s", [{ filter: "f", label: "F" }]);
        expect(events).toHaveBeenCalledOnce();
        model.removeExceptionBreakpointsForSession("s");
        expect(model.getExceptionBreakpointsForSession("s")).toEqual([]);
        expect(model.getExceptionBreakpoints()).toHaveLength(1);
    });

    it("a lookup by line keeps breakpoints with a column; an update re-sorts and reports a change", () => {
        model.addBreakpoints(FILE, [{ lineNumber: 1, column: 5 }, { lineNumber: 3 }]);
        expect(model.getBreakpoints({ lineNumber: 1 })).toHaveLength(1);
        expect(model.getBreakpoints({ column: 5 })).toHaveLength(1);
        const [first] = model.getBreakpoints();
        model.updateBreakpoints(new Map([[first.getId(), { lineNumber: 9 }]]));
        expect(events).toHaveBeenLastCalledWith({ changed: [first], sessionOnly: false });
        expect(model.getBreakpoints().map((bp) => bp.lineNumber)).toEqual([3, 9]);
    });

    it("on one line, breakpoints sort by column; one without a column compares as after, as upstream", () => {
        model.addBreakpoints(FILE, [{ lineNumber: 2 }, { lineNumber: 2, column: 9 }, { lineNumber: 2, column: 3 }]);
        expect(model.getBreakpoints().map((bp) => bp.column)).toEqual([undefined, 3, 9]);
    });

    it("a new session without a parent goes last, after the children of the others", () => {
        const a = testSession("a");
        model.addSession(a);
        const child = testSession("child", { parentSession: a });
        model.addSession(child);
        const b = testSession("b");
        model.addSession(b);
        expect(model.getSessions()).toEqual([a, child, b]);
    });

    it("moving a watch expression keeps the others in order", () => {
        const a = model.addWatchExpression("a");
        const b = model.addWatchExpression("b");
        const c = model.addWatchExpression("c");
        model.moveWatchExpression(c.getId(), 1);
        expect(model.getWatchExpressions()).toEqual([a, c, b]);
    });

    it("removing watch expressions fires once", () => {
        model.addWatchExpression("a");
        const changed = vi.fn();
        disposables.add(model.onDidChangeWatchExpressions(changed));
        model.removeWatchExpressions();
        expect(changed).toHaveBeenCalledExactlyOnceWith(undefined);
    });

    it("reloads breakpoints and watch expressions when another workspace store opens, and fires for both", () => {
        const state = mockStateService();
        const reloaded = createMockDebugModel(disposables, state);
        const watch = vi.fn();
        const breakpoints = vi.fn();
        disposables.add(reloaded.onDidChangeWatchExpressions(watch));
        disposables.add(reloaded.onDidChangeBreakpoints(breakpoints));
        state.openWorkspace(new Map([["debug.watchexpressions", [{ name: "y", id: "w1" }]]]));
        expect(reloaded.getWatchExpressions().map((e) => e.name)).toEqual(["y"]);
        expect(watch).toHaveBeenCalledExactlyOnceWith(undefined);
        expect(breakpoints).toHaveBeenCalledExactlyOnceWith(undefined);
    });

    describe("call stack fetching", () => {
        const getSource = (raw?: DebugProtocol.Source): Source => new Source(raw, "s", NULL_LOGGER);

        function frames(count: number, rename: Record<number, string> = {}): DebugProtocol.StackFrame[] {
            return Array.from({ length: count }, (_, i) => ({
                id: i,
                name: rename[i] ?? `f${String(i)}`,
                line: i + 1,
                column: 1,
            }));
        }

        function stopped(session: IDebugSession, details: Thread["stoppedDetails"]): Thread {
            const thread = new Thread(session, "main", 1);
            thread.stopped = true;
            thread.stoppedDetails = details;
            return thread;
        }

        it("fetchCallstack keeps the levels asked for when fewer than what remains", async () => {
            const stackTrace = vi.fn((_t: number, start: number, levels: number) =>
                Promise.resolve({
                    body: { stackFrames: frames(26).slice(start, start + levels), totalFrames: 26 },
                } as DebugProtocol.StackTraceResponse),
            );
            const thread = stopped(mockSession({ stackTrace, getSource }), { reason: "step" });
            await thread.fetchCallStack();
            await model.fetchCallstack(thread, 3);
            expect(stackTrace).toHaveBeenLastCalledWith(1, 20, 3, expect.anything());
        });

        it("fetchCallstack without a stop detail fetches the levels asked for", async () => {
            const stackTrace = vi.fn(() =>
                Promise.resolve({ body: { stackFrames: frames(2) } } as DebugProtocol.StackTraceResponse),
            );
            const thread = stopped(mockSession({ stackTrace, getSource }), undefined);
            await model.fetchCallstack(thread, 2);
            expect(stackTrace).toHaveBeenCalledWith(1, 0, 2, expect.anything());
        });

        it("fetchCallstack fetches nothing when the stack is already past the total", async () => {
            const stackTrace = vi.fn(() =>
                Promise.resolve({ body: { stackFrames: frames(3) } } as DebugProtocol.StackTraceResponse),
            );
            const thread = stopped(mockSession({ stackTrace, getSource }), { reason: "step" });
            await thread.fetchCallStack(5);
            thread.reachedEndOfCallStack = false;
            thread.stoppedDetails = { reason: "step", totalFrames: 2 };
            await model.fetchCallstack(thread);
            expect(stackTrace).toHaveBeenCalledOnce();
        });

        it("fetchCallstack keeps the levels when the total is exactly reached, as upstream", async () => {
            const stackTrace = vi.fn(() =>
                Promise.resolve({ body: { stackFrames: frames(2) } } as DebugProtocol.StackTraceResponse),
            );
            const thread = stopped(mockSession({ stackTrace, getSource }), { reason: "step" });
            await thread.fetchCallStack(5);
            thread.reachedEndOfCallStack = false;
            thread.stoppedDetails = { reason: "step", totalFrames: 2 };
            await model.fetchCallstack(thread, 4);
            expect(stackTrace).toHaveBeenLastCalledWith(1, 2, 4, expect.anything());
        });

        it("two refreshes share one delayed fetch of the rest", async () => {
            vi.useFakeTimers();
            const stackTrace = vi.fn((_t: number, start: number, levels: number) =>
                Promise.resolve({
                    body: { stackFrames: frames(10).slice(start, start + levels) },
                } as DebugProtocol.StackTraceResponse),
            );
            const session = mockSession({
                stackTrace,
                getSource,
                capabilities: { supportsDelayedStackTraceLoading: true },
            });
            const thread = stopped(session, { reason: "step" });
            const first = model.refreshTopOfCallstack(thread);
            const second = model.refreshTopOfCallstack(thread);
            await vi.advanceTimersByTimeAsync(420);
            await Promise.all([first.wholeCallStack, second.wholeCallStack]);
            expect(stackTrace.mock.calls.filter(([, , levels]) => levels === 19)).toHaveLength(1);
        });

        it("a changed top frame alone does not change the bottom of the stack", async () => {
            vi.useFakeTimers();
            let answer = frames(3);
            const src = getSource({ path: "/a.cpp" });
            const session = mockSession({
                stackTrace: (_t, start, levels) =>
                    Promise.resolve({
                        body: { stackFrames: answer.slice(start, start + levels) },
                    } as DebugProtocol.StackTraceResponse),
                getSource: () => src,
                capabilities: { supportsDelayedStackTraceLoading: true },
            });
            const thread = stopped(session, { reason: "step" });
            await thread.fetchCallStack();
            thread.clearCallStack();
            answer = frames(3, { 0: "moved" });
            const changed = vi.fn();
            disposables.add(model.onDidChangeCallStack(changed));
            const { wholeCallStack } = model.refreshTopOfCallstack(thread);
            await vi.advanceTimersByTimeAsync(420);
            await wholeCallStack;
            expect(changed).toHaveBeenCalledOnce();
        });

        it("clearing one thread completes only its delayed fetch; a refresh after a clear schedules again", async () => {
            vi.useFakeTimers();
            const stackTrace = vi.fn((_t: number, start: number, levels: number) =>
                Promise.resolve({
                    body: { stackFrames: frames(10).slice(start, start + levels) },
                } as DebugProtocol.StackTraceResponse),
            );
            const session = testSession();
            Object.assign(session, {
                stackTrace,
                getSource,
                clearThreads: vi.fn(),
                capabilities: { supportsDelayedStackTraceLoading: true },
            });
            const one = stopped(session, { reason: "step" });
            const two = new Thread(session, "worker", 2);
            two.stopped = true;
            two.stoppedDetails = { reason: "step" };
            Object.assign(session, { getThread: (id: number) => [one, two].find((t) => t.threadId === id) });
            model.addSession(session);

            const first = model.refreshTopOfCallstack(one);
            const other = model.refreshTopOfCallstack(two);
            let otherDone = false;
            void other.wholeCallStack.then(() => (otherDone = true));
            await first.topCallStack;
            await other.topCallStack;
            model.clearThreads(session.getId(), false, 1);
            await first.wholeCallStack;
            await vi.advanceTimersByTimeAsync(0);
            expect(otherDone).toBe(false);

            const before = stackTrace.mock.calls.length;
            const again = model.refreshTopOfCallstack(one);
            await vi.advanceTimersByTimeAsync(420);
            await again.wholeCallStack;
            expect(otherDone).toBe(true);
            expect(
                stackTrace.mock.calls.slice(before).map(([threadId, , levels]) => [threadId, levels]),
            ).toContainEqual([1, 19]);
        });

        it("a second clear within 100 ms does not postpone the call stack event", async () => {
            vi.useFakeTimers();
            const session = testSession();
            Object.assign(session, { clearThreads: vi.fn(), getAllThreads: () => [] });
            model.addSession(session);
            const changed = vi.fn();
            disposables.add(model.onDidChangeCallStack(changed));
            model.clearThreads(session.getId(), true);
            await vi.advanceTimersByTimeAsync(50);
            model.clearThreads(session.getId(), true);
            await vi.advanceTimersByTimeAsync(50);
            expect(changed).toHaveBeenCalledOnce();
        });
    });
});
