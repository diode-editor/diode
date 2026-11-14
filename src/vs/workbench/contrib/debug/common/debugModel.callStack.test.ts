/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/test/browser/callStack.test.ts
// The model's part of the suite: "stack frame toString()" and "debug child sessions are added in correct order".
// The thread tests drive a `DebugSession` over a raw session (the session task), the rest is the CALL STACK view
// and the editor. Below them, what the model does on its own.

import assert from "assert";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { suite, test } from "../../../../../TestUtils/mochaCompat.ts";
import { createMockDebugModel, mockSession, testSession } from "../../../../../TestUtils/mockDebug.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../base/test/common/utils.ts";
import { NULL_LOGGER } from "../../../../platform/log/common/nullLogService.ts";

import { type IDebugSession, type IStackFrame, State } from "./debug.ts";
import { type DebugModel, ErrorScope, StackFrame, Thread, ThreadAndSessionIds } from "./debugModel.ts";
import { Source } from "./debugSource.ts";

suite("Debug - CallStack", () => {
    let model: DebugModel;
    const disposables = ensureNoDisposablesAreLeakedInTestSuite();

    beforeEach(() => {
        model = createMockDebugModel(disposables);
    });

    test("stack frame toString()", () => {
        const session = testSession();
        const thread = new Thread(session, "mockthread", 1);
        const firstSource = new Source(
            {
                name: "internalModule.js",
                path: "a/b/c/d/internalModule.js",
                sourceReference: 10,
            },
            "aDebugSessionId",
            NULL_LOGGER,
        );
        const stackFrame = new StackFrame(
            thread,
            1,
            firstSource,
            "app",
            "normal",
            { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 10 },
            1,
            true,
        );
        assert.strictEqual(stackFrame.toString(), "app (internalModule.js:1)");

        const secondSource = new Source(undefined, "aDebugSessionId", NULL_LOGGER);
        const stackFrame2 = new StackFrame(
            thread,
            2,
            secondSource,
            "module",
            "normal",
            { startLineNumber: undefined!, startColumn: undefined!, endLineNumber: undefined!, endColumn: undefined! },
            2,
            true,
        );
        assert.strictEqual(stackFrame2.toString(), "module");
    });

    test("debug child sessions are added in correct order", () => {
        const session = testSession();
        model.addSession(session);
        const secondSession = testSession("mockSession2");
        model.addSession(secondSession);
        const firstChild = testSession("firstChild", { parentSession: session });
        model.addSession(firstChild);
        const secondChild = testSession("secondChild", { parentSession: session });
        model.addSession(secondChild);
        const thirdSession = testSession("mockSession3");
        model.addSession(thirdSession);
        const anotherChild = testSession("secondChild", { parentSession: secondSession });
        model.addSession(anotherChild);

        const sessions = model.getSessions();
        assert.strictEqual(sessions[0].getId(), session.getId());
        assert.strictEqual(sessions[1].getId(), firstChild.getId());
        assert.strictEqual(sessions[2].getId(), secondChild.getId());
        assert.strictEqual(sessions[3].getId(), secondSession.getId());
        assert.strictEqual(sessions[4].getId(), anotherChild.getId());
        assert.strictEqual(sessions[5].getId(), thirdSession.getId());
    });
});

const RANGE = { startLineNumber: 4, startColumn: 2, endLineNumber: 4, endColumn: 9 };

/** `null` is a frame without a source. */
function source(raw: DebugProtocol.Source | null = { path: "/src/main.cpp" }): Source {
    return new Source(raw ?? undefined, "s", NULL_LOGGER);
}

function frame(
    thread: Thread,
    options: Partial<{ name: string; hint: string; src: Source; ip: string; index: number }> = {},
): StackFrame {
    return new StackFrame(
        thread,
        options.index ?? 0,
        options.src ?? source(),
        options.name ?? "main",
        options.hint,
        RANGE,
        options.index ?? 0,
        true,
        options.ip,
    );
}

describe("StackFrame", () => {
    it("names itself by thread, index and source; prints the file path and line", () => {
        const thread = new Thread(testSession(), "main", 3);
        const f = frame(thread, { index: 2 });
        expect(f.getId()).toBe(`stackframe:${thread.getId()}:2:main.cpp`);
        expect(f.toString()).toBe("main (/src/main.cpp:4)");
    });

    it("builds scopes with stable ids from name and position, ranges only when complete", async () => {
        const scopes = vi.fn(() =>
            Promise.resolve({
                body: {
                    scopes: [
                        {
                            name: "Locals",
                            variablesReference: 1,
                            expensive: false,
                            line: 2,
                            column: 1,
                            endLine: 9,
                            endColumn: 1,
                        },
                        {
                            name: "Locals",
                            variablesReference: 2,
                            expensive: false,
                            line: 2,
                            column: 1,
                            endLine: 9,
                            endColumn: 1,
                        },
                        {
                            name: "Registers",
                            variablesReference: 3,
                            expensive: true,
                            namedVariables: 4,
                            indexedVariables: 5,
                        },
                        { name: "Partial", variablesReference: 4, expensive: false, line: 2, column: 1, endLine: 9 },
                    ],
                },
            } as DebugProtocol.ScopesResponse),
        );
        const thread = new Thread(mockSession({ scopes }), "main", 1);
        const f = frame(thread);
        const [locals, shadow, registers, partial] = await f.getScopes();
        expect(scopes).toHaveBeenCalledExactlyOnceWith(0, 1);
        expect(locals.getId()).not.toBe(shadow.getId());
        expect(locals.range).toEqual({ startLineNumber: 2, startColumn: 1, endLineNumber: 9, endColumn: 1 });
        expect(registers.range).toBeUndefined();
        expect(partial.range).toBeUndefined();
        expect([registers.expensive, registers.reference]).toEqual([true, 3]);

        const again = await frame(new Thread(mockSession({ scopes }), "main", 1)).getScopes();
        expect(again.map((s) => s.getId())).toEqual([locals, shadow, registers, partial].map((s) => s.getId()));
    });

    it("caches scopes until forgotten, and a failure is one error scope", async () => {
        const scopes = vi.fn(() => Promise.reject(new Error("not stopped")));
        const thread = new Thread(mockSession({ scopes }), "main", 1);
        const f = frame(thread);
        const [error] = await f.getScopes();
        expect(error).toBeInstanceOf(ErrorScope);
        expect([error.name, error.expensive, error.hasChildren]).toEqual(["not stopped", false, false]);
        await f.getScopes();
        expect(scopes).toHaveBeenCalledOnce();
        f.forgetScopes();
        await f.getScopes();
        expect(scopes).toHaveBeenCalledTimes(2);

        const empty = frame(new Thread(mockSession({ scopes: () => Promise.resolve(undefined) }), "m", 1));
        expect(await empty.getScopes()).toEqual([]);
    });

    it("the most specific scopes are the cheap ones containing the range, innermost first", async () => {
        const raw = (name: string, line: number, endLine: number, expensive = false): DebugProtocol.Scope => ({
            name,
            variablesReference: 1,
            expensive,
            line,
            column: 1,
            endLine,
            endColumn: 99,
        });
        const with_ = (list: DebugProtocol.Scope[]): StackFrame =>
            frame(
                new Thread(
                    mockSession({
                        scopes: () => Promise.resolve({ body: { scopes: list } } as DebugProtocol.ScopesResponse),
                    }),
                    "m",
                    1,
                ),
            );

        const nested = with_([
            raw("Function", 1, 20),
            raw("Block", 3, 6),
            raw("Globals", 1, 100, true),
            raw("Other", 10, 12),
        ]);
        expect((await nested.getMostSpecificScopes(RANGE)).map((s) => s.name)).toEqual(["Block", "Function"]);

        const noneContains = with_([raw("Other", 10, 12), raw("Late", 30, 40)]);
        expect((await noneContains.getMostSpecificScopes(RANGE)).map((s) => s.name)).toEqual(["Other", "Late"]);

        const noRanges = with_([
            { name: "Locals", variablesReference: 1, expensive: false },
            { name: "Registers", variablesReference: 2, expensive: true },
        ]);
        expect((await noRanges.getMostSpecificScopes(RANGE)).map((s) => s.name)).toEqual(["Locals"]);
    });

    it("restart asks the session to restart this frame", async () => {
        const restartFrame = vi.fn(() => Promise.resolve());
        const thread = new Thread(mockSession({ restartFrame }), "main", 5);
        await frame(thread, { index: 3 }).restart();
        expect(restartFrame).toHaveBeenCalledWith(3, 5);
    });

    it("equals compares name, thread, id, source object and range", () => {
        const thread = new Thread(testSession(), "main", 1);
        const src = source();
        const base = frame(thread, { src });
        expect(base.equals(frame(thread, { src }))).toBe(true);
        expect(base.equals(frame(thread, { src, name: "other" }))).toBe(false);
        expect(base.equals(frame(new Thread(testSession(), "main", 1), { src }))).toBe(false);
        expect(base.equals(frame(thread, { src, index: 1 }))).toBe(false);
        expect(base.equals(frame(thread))).toBe(false);
        const moved = new StackFrame(thread, 0, src, "main", undefined, { ...RANGE, endColumn: 10 }, 0, true);
        expect(base.equals(moved)).toBe(false);
    });
});

describe("Thread", () => {
    const disposables = ensureNoDisposablesAreLeakedInTestSuite();

    function stackTraceOf(frames: DebugProtocol.StackFrame[], totalFrames?: number): IDebugSession["stackTrace"] {
        return vi.fn((_threadId: number, startFrame: number, levels: number) =>
            Promise.resolve({
                body: { stackFrames: frames.slice(startFrame, startFrame + levels), totalFrames },
            } as DebugProtocol.StackTraceResponse),
        );
    }

    function rawFrames(count: number): DebugProtocol.StackFrame[] {
        return Array.from({ length: count }, (_, i) => ({
            id: 100 + i,
            name: `f${String(i)}`,
            line: i + 1,
            column: 2,
            source: { path: `/src/f${String(i)}.cpp` },
        }));
    }

    function stoppedThread(session: IDebugSession, details: Thread["stoppedDetails"] = { reason: "step" }): Thread {
        const thread = new Thread(session, "main", 1);
        thread.stopped = true;
        thread.stoppedDetails = details;
        return thread;
    }

    const getSource = (raw?: DebugProtocol.Source): Source => source(raw ?? null);

    it("a running thread fetches nothing", async () => {
        const stackTrace = stackTraceOf(rawFrames(3));
        const thread = new Thread(mockSession({ stackTrace, getSource }), "main", 1);
        await thread.fetchCallStack();
        expect(stackTrace).not.toHaveBeenCalled();
        expect(thread.getCallStack()).toEqual([]);
        expect(thread.stateLabel).toBe("Running");
    });

    it("fetches the stack in portions and builds frames from the adapter's", async () => {
        const raw = rawFrames(26);
        raw[0] = {
            ...raw[0],
            endLine: 3,
            endColumn: 8,
            canRestart: false,
            presentationHint: "label",
            instructionPointerReference: "0x1",
        };
        const stackTrace = stackTraceOf(raw, 26);
        const thread = stoppedThread(mockSession({ stackTrace, getSource }));

        await thread.fetchCallStack();
        expect(stackTrace).toHaveBeenLastCalledWith(1, 0, 20, expect.anything());
        expect(thread.getCallStack()).toHaveLength(20);
        expect(thread.reachedEndOfCallStack).toBe(false);
        expect(thread.stoppedDetails?.totalFrames).toBe(26);

        const [top, second] = thread.getCallStack() as StackFrame[];
        expect([top.frameId, top.name, top.presentationHint, top.canRestart, top.instructionPointerReference]).toEqual([
            100,
            "f0",
            "label",
            false,
            "0x1",
        ]);
        expect(top.range).toEqual({ startLineNumber: 1, startColumn: 2, endLineNumber: 3, endColumn: 8 });
        expect(second.range).toEqual({ startLineNumber: 2, startColumn: 2, endLineNumber: 2, endColumn: 2 });
        expect(second.canRestart).toBe(true);
        expect(second.getId()).toBe(`stackframe:${thread.getId()}:1:f1.cpp`);

        await thread.fetchCallStack(6);
        expect(stackTrace).toHaveBeenLastCalledWith(1, 20, 6, expect.anything());
        expect(thread.getCallStack()).toHaveLength(26);
        expect(thread.reachedEndOfCallStack).toBe(true);
        expect((thread.getCallStack()[25] as StackFrame).getId()).toBe(`stackframe:${thread.getId()}:25:f25.cpp`);
    });

    it("reaches the end when the adapter returns fewer frames than asked", async () => {
        const thread = stoppedThread(mockSession({ stackTrace: stackTraceOf(rawFrames(3)), getSource }));
        await thread.fetchCallStack(5);
        expect(thread.getCallStack()).toHaveLength(3);
        expect(thread.reachedEndOfCallStack).toBe(true);
    });

    it("a concurrent fetch of the same portion replaces it instead of duplicating it (#30660)", async () => {
        const thread = stoppedThread(mockSession({ stackTrace: stackTraceOf(rawFrames(5)), getSource }));
        await Promise.all([thread.fetchCallStack(2), thread.fetchCallStack(2)]);
        expect(thread.getCallStack().map((f) => f.name)).toEqual(["f0", "f1"]);
    });

    it("clearing the call stack keeps it as stale and cancels the pending request", async () => {
        let resolve!: (r: DebugProtocol.StackTraceResponse) => void;
        const stackTrace = vi.fn(
            () =>
                new Promise<DebugProtocol.StackTraceResponse>((r) => {
                    resolve = r;
                }),
        );
        const thread = stoppedThread(mockSession({ stackTrace, getSource }));
        const pending = thread.fetchCallStack();
        thread.clearCallStack();
        resolve({ body: { stackFrames: rawFrames(2) } } as DebugProtocol.StackTraceResponse);
        await pending;
        expect(thread.getCallStack()).toEqual([]);

        thread.stopped = true;
        const loaded = stoppedThread(mockSession({ stackTrace: stackTraceOf(rawFrames(2)), getSource }));
        await loaded.fetchCallStack();
        const before = loaded.getCallStack();
        loaded.clearCallStack();
        expect(loaded.getStaleCallStack()).toBe(before);
        loaded.clearCallStack();
        expect(loaded.getStaleCallStack()).toBe(before);
    });

    it("a failed stack trace is no frames and keeps the error for the view", async () => {
        const failing = stoppedThread(
            mockSession({ stackTrace: () => Promise.reject(new Error("bad frame")), getSource }),
        );
        await failing.fetchCallStack();
        expect(failing.getCallStack()).toEqual([]);
        expect(failing.stoppedDetails?.framesErrorMessage).toBe("bad frame");

        const noDetails = stoppedThread(
            mockSession({ stackTrace: () => Promise.reject(new Error("x")), getSource }),
            undefined,
        );
        await noDetails.fetchCallStack();
        expect(noDetails.getCallStack()).toEqual([]);

        const empty = stoppedThread(
            mockSession({ stackTrace: () => Promise.resolve(undefined), getSource }),
            undefined,
        );
        await empty.fetchCallStack();
        expect(empty.getCallStack()).toEqual([]);
    });

    it("the top frame skips deemphasized and unavailable frames, unless stopped by a breakpoint or a step", async () => {
        const session = mockSession();
        const thread = stoppedThread(session, { reason: "exception" });
        const lib = frame(thread, { name: "lib", hint: "deemphasize" });
        const subtle = frame(thread, { name: "subtle", src: source({ path: "/x", presentationHint: "deemphasize" }) });
        const missing = frame(thread, { name: "missing", src: source(null) });
        const user = frame(thread, { name: "user" });
        (thread as unknown as { callStack: IStackFrame[] }).callStack = [lib, subtle, missing, user];
        expect(thread.getTopStackFrame()).toBe(user);

        for (const reason of ["breakpoint", "step", "function breakpoint"]) {
            thread.stoppedDetails = { reason };
            expect(thread.getTopStackFrame(), reason).toBe(lib);
        }
        thread.stoppedDetails = undefined;
        expect(thread.getTopStackFrame()).toBe(user);
    });

    it("an instruction stop puts a frame with an instruction pointer on top even without a source", () => {
        const thread = stoppedThread(mockSession(), { reason: "instruction breakpoint" });
        const asm = frame(thread, { name: "asm", src: source(null), ip: "0x10" });
        const user = frame(thread, { name: "user" });
        (thread as unknown as { callStack: IStackFrame[] }).callStack = [asm, user];
        expect(thread.getTopStackFrame()).toBe(asm);

        thread.stoppedDetails = { reason: "step" };
        thread.lastSteppingGranularity = "instruction";
        expect(thread.getTopStackFrame()).toBe(asm);
        thread.lastSteppingGranularity = "statement";
        expect(thread.getTopStackFrame()).toBe(user);
        thread.stoppedDetails = { reason: "exception" };
        thread.lastSteppingGranularity = "instruction";
        expect(thread.getTopStackFrame()).toBe(user);
    });

    it("labels its state by the stop description, then the reason", () => {
        const thread = stoppedThread(mockSession(), { reason: "breakpoint", description: "Paused on breakpoint 1" });
        expect(thread.stateLabel).toBe("Paused on breakpoint 1");
        thread.stoppedDetails = { reason: "exception" };
        expect(thread.stateLabel).toBe("Paused on exception");
        thread.stoppedDetails = {};
        expect(thread.stateLabel).toBe("Paused");
    });

    it("exception info comes from the adapter when supported, else from the stop text", async () => {
        const info = { id: "std::out_of_range", breakMode: "always" };
        const exceptionInfo = vi.fn(() => Promise.resolve(info));
        const capable = stoppedThread(
            mockSession({ exceptionInfo, capabilities: { supportsExceptionInfoRequest: true } }),
            { reason: "exception", text: "vector::_M_range_check" },
        );
        expect(await capable.exceptionInfo).toBe(info);
        expect(exceptionInfo).toHaveBeenCalledWith(1);

        const plain = stoppedThread(mockSession(), { reason: "exception", text: "vector::_M_range_check" });
        expect(await plain.exceptionInfo).toEqual({ description: "vector::_M_range_check", breakMode: null });
        expect(await stoppedThread(mockSession(), { reason: "step" }).exceptionInfo).toBeUndefined();
        expect(await new Thread(mockSession(), "t", 1).exceptionInfo).toBeUndefined();
    });

    it("steps, continues, pauses and terminates through the session with its id", async () => {
        const calls: unknown[][] = [];
        const record =
            (name: string) =>
            (...args: unknown[]): Promise<void> => {
                calls.push([name, ...args]);
                return Promise.resolve();
            };
        const session = mockSession({
            next: record("next"),
            stepIn: record("stepIn"),
            stepOut: record("stepOut"),
            stepBack: record("stepBack"),
            continue: record("continue"),
            pause: record("pause"),
            terminateThreads: record("terminateThreads"),
            reverseContinue: record("reverseContinue"),
        });
        const thread = new Thread(session, "main", 4);
        await thread.next("line");
        await thread.stepIn("instruction");
        await thread.stepOut();
        await thread.stepBack("statement");
        await thread.continue();
        await thread.pause();
        await thread.terminate();
        await thread.reverseContinue();
        expect(calls).toEqual([
            ["next", 4, "line"],
            ["stepIn", 4, undefined, "instruction"],
            ["stepOut", 4, undefined],
            ["stepBack", 4, "statement"],
            ["continue", 4],
            ["pause", 4],
            ["terminateThreads", [4]],
            ["reverseContinue", 4],
        ]);
    });

    it("is named by session and thread id", () => {
        const session = testSession();
        expect(new Thread(session, "main", 9).getId()).toBe(`thread:${session.getId()}:9`);
        expect(new ThreadAndSessionIds("s", 9).getId()).toBe("s:9");
    });

    describe("in the model", () => {
        let model: DebugModel;

        beforeEach(() => {
            model = createMockDebugModel(disposables);
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it("fetchCallstack fetches what remains of totalFrames and fires once fetched", async () => {
            const stackTrace = stackTraceOf(rawFrames(26), 26);
            const thread = stoppedThread(mockSession({ stackTrace, getSource }), { reason: "step", totalFrames: 26 });
            await thread.fetchCallStack();
            const changed = vi.fn();
            disposables.add(model.onDidChangeCallStack(changed));

            await model.fetchCallstack(thread, 50);
            expect(stackTrace).toHaveBeenLastCalledWith(1, 20, 6, expect.anything());
            expect(changed).toHaveBeenCalledOnce();

            await model.fetchCallstack(thread, 50);
            expect(stackTrace).toHaveBeenCalledTimes(2);
        });

        it("fetchCallstack without levels fetches the rest, and nothing without a total", async () => {
            const stackTrace = stackTraceOf(rawFrames(30));
            const thread = stoppedThread(mockSession({ stackTrace, getSource }), { reason: "step", totalFrames: 30 });
            await model.fetchCallstack(thread);
            expect(stackTrace).toHaveBeenLastCalledWith(1, 0, 30, expect.anything());

            const unknown = stoppedThread(mockSession({ stackTrace, getSource }), { reason: "step" });
            await model.fetchCallstack(unknown);
            expect(stackTrace).toHaveBeenCalledOnce();
            await model.fetchCallstack(unknown, 3);
            expect(stackTrace).toHaveBeenLastCalledWith(1, 0, 3, expect.anything());
        });

        it("refreshTopOfCallstack without delayed loading fetches the whole stack at once", async () => {
            const stackTrace = stackTraceOf(rawFrames(3));
            const thread = stoppedThread(mockSession({ stackTrace, getSource }));
            const { topCallStack, wholeCallStack } = model.refreshTopOfCallstack(thread);
            expect(topCallStack).toBe(wholeCallStack);
            await wholeCallStack;
            expect(thread.getCallStack()).toHaveLength(3);
        });

        it("refreshTopOfCallstack with delayed loading fetches the top frame, the rest 420 ms later", async () => {
            vi.useFakeTimers();
            const stackTrace = stackTraceOf(rawFrames(10));
            const session = mockSession({
                stackTrace,
                getSource,
                capabilities: { supportsDelayedStackTraceLoading: true },
            });
            const thread = stoppedThread(session);
            const changed = vi.fn();
            disposables.add(model.onDidChangeCallStack(changed));

            const { topCallStack, wholeCallStack } = model.refreshTopOfCallstack(thread);
            await topCallStack;
            expect(thread.getCallStack()).toHaveLength(1);
            expect(changed).toHaveBeenCalledTimes(1);

            await vi.advanceTimersByTimeAsync(419);
            expect(stackTrace).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(1);
            await wholeCallStack;
            expect(stackTrace).toHaveBeenLastCalledWith(1, 1, 19, expect.anything());
            expect(thread.getCallStack()).toHaveLength(10);
            // The stale stack was empty: the bottom changed.
            expect(changed).toHaveBeenCalledTimes(2);
        });

        it("a bottom of the stack equal to the stale one is not a change", async () => {
            vi.useFakeTimers();
            const raw = rawFrames(3);
            const src = source();
            const session = mockSession({
                stackTrace: stackTraceOf(raw),
                getSource: () => src,
                capabilities: { supportsDelayedStackTraceLoading: true },
            });
            const thread = stoppedThread(session);
            await thread.fetchCallStack();
            thread.clearCallStack();
            const changed = vi.fn();
            disposables.add(model.onDidChangeCallStack(changed));

            const { wholeCallStack } = model.refreshTopOfCallstack(thread);
            await vi.advanceTimersByTimeAsync(420);
            await wholeCallStack;
            expect(changed).toHaveBeenCalledTimes(1);

            const other = stoppedThread(session);
            await other.fetchCallStack();
            other.clearCallStack();
            (session as { stackTrace: IDebugSession["stackTrace"] }).stackTrace = stackTraceOf([
                raw[0],
                { ...raw[1], name: "moved" },
                raw[2],
            ]);
            const second = model.refreshTopOfCallstack(other);
            await vi.advanceTimersByTimeAsync(420);
            await second.wholeCallStack;
            expect(changed).toHaveBeenCalledTimes(3);
        });

        it("refreshTopOfCallstack without the full stack resolves after the top frame", async () => {
            const stackTrace = stackTraceOf(rawFrames(10));
            const session = mockSession({
                stackTrace,
                getSource,
                capabilities: { supportsDelayedStackTraceLoading: true },
            });
            const thread = stoppedThread(session);
            const changed = vi.fn();
            disposables.add(model.onDidChangeCallStack(changed));
            const { wholeCallStack } = model.refreshTopOfCallstack(thread, false);
            await wholeCallStack;
            expect(stackTrace).toHaveBeenCalledOnce();
            expect(changed).toHaveBeenCalledOnce();
        });

        it("clearThreads completes the pending delayed fetch of the cleared threads and fires 100 ms later", async () => {
            vi.useFakeTimers();
            const stackTrace = stackTraceOf(rawFrames(10));
            const clearThreads = vi.fn();
            const session = testSession();
            Object.assign(session, {
                stackTrace,
                getSource,
                clearThreads,
                capabilities: { supportsDelayedStackTraceLoading: true },
            });
            const thread = stoppedThread(session);
            const other = stoppedThread(session);
            Object.assign(session, {
                getAllThreads: () => [thread],
                getThread: (id: number) => (id === 1 ? thread : undefined),
            });
            model.addSession(session);
            const changed = vi.fn();
            disposables.add(model.onDidChangeCallStack(changed));

            const { topCallStack, wholeCallStack } = model.refreshTopOfCallstack(thread);
            await topCallStack;
            changed.mockClear();
            model.clearThreads(session.getId(), true);
            await wholeCallStack;
            expect(clearThreads).toHaveBeenCalledWith(true, undefined);
            await vi.advanceTimersByTimeAsync(420);
            expect(stackTrace).toHaveBeenCalledOnce();

            expect(changed).toHaveBeenCalledOnce();
            model.clearThreads(session.getId(), false, 1);
            model.clearThreads(session.getId(), false, 2);
            expect(clearThreads).toHaveBeenLastCalledWith(false, 2);
            await vi.advanceTimersByTimeAsync(99);
            expect(changed).toHaveBeenCalledOnce();
            await vi.advanceTimersByTimeAsync(1);
            expect(changed).toHaveBeenCalledTimes(2);

            model.clearThreads("unknown", true);
            await vi.advanceTimersByTimeAsync(100);
            expect(changed).toHaveBeenCalledTimes(2);
            expect(other.getCallStack()).toEqual([]);
        });
    });
});

describe("DebugModel: sessions", () => {
    const disposables = ensureNoDisposablesAreLeakedInTestSuite();
    let model: DebugModel;

    beforeEach(() => {
        model = createMockDebugModel(disposables);
    });

    it("finds sessions by id, the inactive ones only on request", () => {
        const active = testSession("a");
        const inactive = testSession("b", { state: State.Inactive });
        model.addSession(active);
        model.addSession(inactive);
        expect(model.getSessions()).toEqual([active]);
        expect(model.getSessions(true)).toEqual([active, inactive]);
        expect(model.getSession(active.getId())).toBe(active);
        expect(model.getSession(inactive.getId())).toBeUndefined();
        expect(model.getSession(inactive.getId(), true)).toBe(inactive);
        expect(model.getSession(undefined, true)).toBeUndefined();
        expect(model.getId()).toBe("root");
    });

    it("re-adding a session replaces it, a new session drops the inactive ones of its configuration", () => {
        const first = testSession("app", { state: State.Inactive });
        const keep = testSession("other", { state: State.Inactive });
        model.addSession(first);
        model.addSession(keep);
        model.addSession(keep);
        expect(model.getSessions(true)).toEqual([first, keep]);

        const changed = vi.fn();
        disposables.add(model.onDidChangeCallStack(changed));
        const second = testSession("app");
        model.addSession(second);
        expect(first.disposed).toBe(true);
        expect(keep.disposed).toBe(false);
        expect(model.getSessions(true)).toEqual([keep, second]);
        expect(changed).toHaveBeenCalledOnce();
    });

    it("numbers the label of a session that repeats a running one", () => {
        model.addSession(testSession("app"));
        const second = testSession("app");
        model.addSession(second);
        expect(second.getLabel()).toBe("app 2");
        const third = testSession("app");
        model.addSession(third);
        expect(third.getLabel()).toBe("app 3");
    });

    it("rawUpdate passes the update to its session and fires, an unknown session is ignored", () => {
        const rawUpdate = vi.fn();
        const session = testSession();
        Object.assign(session, { rawUpdate });
        model.addSession(session);
        const changed = vi.fn();
        disposables.add(model.onDidChangeCallStack(changed));
        const data = { sessionId: session.getId(), threads: [{ id: 1, name: "main" }] };
        model.rawUpdate(data);
        expect(rawUpdate).toHaveBeenCalledWith(data);
        expect(changed).toHaveBeenCalledOnce();
        model.rawUpdate({ sessionId: "unknown", threads: [] });
        expect(changed).toHaveBeenCalledOnce();
    });

    it("sourceIsNotAvailable greys out the source in every session and fires", () => {
        const src = source();
        const holder = testSession("a");
        const empty = testSession("b");
        Object.assign(holder, {
            getSourceForUri: (uri: Uri) => (uri.toString() === src.uri.toString() ? src : undefined),
        });
        Object.assign(empty, { getSourceForUri: () => undefined });
        model.addSession(holder);
        model.addSession(empty);
        const changed = vi.fn();
        disposables.add(model.onDidChangeCallStack(changed));
        model.sourceIsNotAvailable(Uri.file("/src/main.cpp"));
        expect(src.available).toBe(false);
        expect(changed).toHaveBeenCalledOnce();
    });
});
