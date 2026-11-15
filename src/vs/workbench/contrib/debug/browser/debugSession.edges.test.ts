// The edges of a session over the mock adapter: focus passing, thread bookkeeping, dependent breakpoints that keep
// a step waiting, and the requests the adapter answers with nothing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    createTestDebugSession,
    type ITestSessionServices,
    type TestDebugService,
    testDebugService,
    testSessionServices,
} from "../../../../../TestUtils/debugSessionFixture.ts";
import { createMockDebugModel } from "../../../../../TestUtils/mockDebug.ts";
import { MockDebugAdapter, NO_RESPONSE } from "../../../../../TestUtils/mockDebugAdapter.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { DisposableStore } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { DataBreakpointSetType, type IDebugger, type IDebugSessionOptions, State } from "../common/debug.ts";
import type { DebugModel, Thread } from "../common/debugModel.ts";

import type { DebugSession } from "./debugSession.ts";

const FILE = Uri.file("/src/a.c");

function debuggerOf(adapter: MockDebugAdapter): IDebugger {
    return {
        type: "mock",
        createDebugAdapter: () => Promise.resolve(adapter),
        runInTerminal: () => Promise.resolve(undefined),
        startDebugging: () => Promise.resolve(true),
        getInitialConfigurationContent: () => Promise.resolve(""),
    };
}

describe("DebugSession edges", () => {
    const disposables = new DisposableStore();
    let model: DebugModel;
    let debugService: TestDebugService;
    let services: ITestSessionServices;

    beforeEach(() => {
        model = createMockDebugModel(disposables);
        debugService = testDebugService(model);
        services = testSessionServices();
    });

    afterEach(() => {
        disposables.clear();
        debugService.viewModel.dispose();
        vi.useRealTimers();
    });

    /** A launched session whose adapter knows `threads` (by default threads 1 and 2) and a one-frame stack. */
    async function launch(
        capabilities: DebugProtocol.Capabilities = {},
        options?: IDebugSessionOptions,
    ): Promise<{ session: DebugSession; adapter: MockDebugAdapter }> {
        const adapter = disposables.add(new MockDebugAdapter());
        adapter.handlers.set("initialize", () => capabilities);
        adapter.handlers.set("threads", () => ({
            threads: [
                { id: 1, name: "main" },
                { id: 2, name: "worker" },
            ],
        }));
        adapter.handlers.set("stackTrace", () => ({
            stackFrames: [{ id: 10, name: "f", source: { path: FILE.fsPath }, line: 5, column: 1 }],
            totalFrames: 1,
        }));
        const session = disposables.add(
            createTestDebugSession(model, "s", options, debugService, services, { type: "mock" }),
        );
        model.addSession(session);
        await session.initialize(debuggerOf(adapter));
        await session.launchOrAttach(session.configuration);
        await debugService.focusStackFrame(undefined, undefined, session);
        return { session, adapter };
    }

    async function stop(
        adapter: MockDebugAdapter,
        session: DebugSession,
        body: DebugProtocol.StoppedEvent["body"],
    ): Promise<void> {
        const changes = vi.fn();
        const listener = session.onDidChangeState(changes);
        adapter.sendEventBody("stopped", body);
        await vi.waitFor(() => {
            expect(changes).toHaveBeenCalled();
        });
        listener.dispose();
    }

    describe("threads", () => {
        it("a renamed thread takes the new name, an unnamed update keeps the old one, a missing thread goes", () => {
            const session = disposables.add(createTestDebugSession(model));

            session.rawUpdate({
                sessionId: "",
                threads: [
                    { id: 1, name: "a" },
                    { id: 2, name: "b" },
                ],
            });
            session.rawUpdate({ sessionId: "", threads: [{ id: 1, name: "" }] });
            expect(session.getAllThreads().map((t) => t.name)).toEqual(["a"]);
            session.rawUpdate({ sessionId: "", threads: [{ id: 1, name: "renamed" }] });

            expect(session.getThread(1)?.name).toBe("renamed");
            expect(session.getThread(2)).toBeUndefined();
        });

        it("a stop of one unknown thread, or without a thread and not of all, stops nothing", () => {
            const session = disposables.add(createTestDebugSession(model));
            const threads = [{ id: 1, name: "a" }];

            session.rawUpdate({ sessionId: "", threads, stoppedDetails: { reason: "pause", threadId: 9 } });
            session.rawUpdate({ sessionId: "", threads, stoppedDetails: { reason: "pause" } });

            expect(session.getThread(1)?.stopped).toBe(false);
        });

        it("clears one thread: its stop, and the thread itself when asked to; an unknown one is nothing", () => {
            const session = disposables.add(createTestDebugSession(model));
            session.rawUpdate({
                sessionId: "",
                threads: [
                    { id: 1, name: "a" },
                    { id: 2, name: "b" },
                ],
                stoppedDetails: { reason: "pause", allThreadsStopped: true },
            });

            session.clearThreads(false, 1);
            expect([session.getThread(1)?.stopped, session.getThread(1)?.stoppedDetails]).toEqual([false, undefined]);
            session.clearThreads(true, 2);
            session.clearThreads(true, 9);

            expect(session.getAllThreads().map((t) => t.threadId)).toEqual([1]);
        });

        it("clears every stop and keeps the threads unless asked to remove them", () => {
            const session = disposables.add(createTestDebugSession(model));
            session.rawUpdate({
                sessionId: "",
                threads: [{ id: 1, name: "a" }],
                stoppedDetails: { reason: "pause", allThreadsStopped: true },
            });

            session.clearThreads(false);

            expect(session.getThread(1)?.stopped).toBe(false);
        });

        it("a thread event of another reason changes nothing", async () => {
            const { session, adapter } = await launch();
            adapter.sendEventBody("initialized");
            await vi.waitFor(() => {
                expect(session.getAllThreads()).toHaveLength(2);
            });

            adapter.sendEventBody("thread", { reason: "changed", threadId: 2 });
            await settle(10);

            expect(session.getAllThreads()).toHaveLength(2);
        });

        it("all threads continuing while a fetch is due fetch them at once", async () => {
            const { session, adapter } = await launch();
            adapter.sendEventBody("initialized");
            await vi.waitFor(() => {
                expect(adapter.sent("threads")).toHaveLength(1);
            });

            adapter.sendEventBody("thread", { reason: "started", threadId: 3 });
            adapter.sendEventBody("continued", { threadId: 1 });
            await vi.waitFor(() => {
                expect(adapter.sent("threads")).toHaveLength(2);
            });
            await settle(150);

            expect(adapter.sent("threads")).toHaveLength(2);
            expect(session.getAllThreads()).toHaveLength(2);
        });

        it("a stop of a thread the adapter no longer lists changes state but fetches no stack", async () => {
            const { session, adapter } = await launch();

            await stop(adapter, session, { reason: "pause", threadId: 7 });

            expect(adapter.sent("stackTrace")).toEqual([]);
        });

        it("a focused thread that is gone after a stop loses the focus", async () => {
            const { session, adapter } = await launch();
            await stop(adapter, session, { reason: "pause", threadId: 2 });
            expect(debugService.viewModel.focusedThread?.threadId).toBe(2);
            adapter.handlers.set("threads", () => ({ threads: [{ id: 1, name: "main" }] }));

            await stop(adapter, session, { reason: "pause", threadId: 1 });

            expect(debugService.focusStackFrame).toHaveBeenCalledWith(undefined, undefined);
            await vi.waitFor(() => {
                expect(debugService.viewModel.focusedThread?.threadId).toBe(1);
            });
        });

        it("a newer stop of the thread cancels the older one's focus", async () => {
            const { session, adapter } = await launch({ supportsDelayedStackTraceLoading: true });
            let release: () => void = () => undefined;
            adapter.handlers.set("stackTrace", () => {
                const held = new Promise<void>((resolve) => {
                    release = resolve;
                });
                void held.then(() => {
                    adapter.sendResponseBody(adapter.sent("stackTrace")[0], {
                        stackFrames: [{ id: 10, name: "first", source: { path: FILE.fsPath }, line: 5, column: 1 }],
                    });
                });
                return NO_RESPONSE;
            });
            adapter.sendEventBody("stopped", { reason: "pause", threadId: 1 });
            await vi.waitFor(() => {
                expect(adapter.sent("stackTrace")).toHaveLength(1);
            });
            adapter.handlers.set("stackTrace", () => ({
                stackFrames: [{ id: 11, name: "second", source: { path: FILE.fsPath }, line: 6, column: 1 }],
            }));

            await stop(adapter, session, { reason: "step", threadId: 1 });
            release();
            await settle(10);

            expect(debugService.viewModel.focusedStackFrame?.name).not.toBe("first");
        });
    });

    describe("focus passing after a continue", () => {
        it("a continued thread that is not the focused one keeps the focus where it is", async () => {
            const { session, adapter } = await launch();
            await stop(adapter, session, { reason: "pause", allThreadsStopped: true });
            await vi.waitFor(() => {
                expect(debugService.viewModel.focusedThread).toBeDefined();
            });
            const unfocused = debugService.viewModel.focusedThread?.threadId === 1 ? 2 : 1;
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            const calls = vi.mocked(debugService.focusStackFrame).mock.calls.length;

            adapter.sendEventBody("continued", { threadId: unfocused, allThreadsContinued: false });
            await vi.advanceTimersByTimeAsync(900);

            expect(vi.mocked(debugService.focusStackFrame).mock.calls.length).toBe(calls);
        });

        it("a continued thread that stopped again in the meantime keeps the focus", async () => {
            const { session, adapter } = await launch();
            await stop(adapter, session, { reason: "pause", allThreadsStopped: true });
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            const calls = vi.mocked(debugService.focusStackFrame).mock.calls.length;

            adapter.sendEventBody("continued", { threadId: 1, allThreadsContinued: false });
            await vi.advanceTimersByTimeAsync(10);
            session.getThread(1)!.stopped = true;
            await vi.advanceTimersByTimeAsync(900);

            expect(vi.mocked(debugService.focusStackFrame).mock.calls.length).toBe(calls);
        });

        it("all threads continued: the focus moves off only from this session while it is not stopped", async () => {
            const { session, adapter } = await launch();
            const other = disposables.add(createTestDebugSession(model, "other"));
            model.addSession(other);
            vi.spyOn(other, "state", "get").mockReturnValue(State.Stopped);
            await stop(adapter, session, { reason: "pause", allThreadsStopped: true });
            debugService.viewModel.setFocus(undefined, undefined, other, false);
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            const calls = vi.mocked(debugService.focusStackFrame).mock.calls.length;

            adapter.sendEventBody("continued", { threadId: 1 });
            await vi.advanceTimersByTimeAsync(900);

            expect(vi.mocked(debugService.focusStackFrame).mock.calls.length).toBe(calls);
        });

        it("all threads continued and this session stopped again: the focus stays", async () => {
            const { session, adapter } = await launch();
            const other = disposables.add(createTestDebugSession(model, "other"));
            model.addSession(other);
            vi.spyOn(other, "state", "get").mockReturnValue(State.Stopped);
            await stop(adapter, session, { reason: "pause", allThreadsStopped: true });
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            const calls = vi.mocked(debugService.focusStackFrame).mock.calls.length;

            adapter.sendEventBody("continued", { threadId: 1 });
            await vi.advanceTimersByTimeAsync(10);
            vi.spyOn(session, "state", "get").mockReturnValue(State.Stopped);
            await vi.advanceTimersByTimeAsync(900);

            expect(vi.mocked(debugService.focusStackFrame).mock.calls.length).toBe(calls);
        });
    });

    describe("dependent breakpoints keep a step waiting", () => {
        it("for at most a second and a half", async () => {
            const { session, adapter } = await launch();
            const [trigger] = model.addBreakpoints(FILE, [{ lineNumber: 5 }]);
            model.addBreakpoints(FILE, [{ lineNumber: 9, triggeredBy: trigger.getId() }]);
            model.setBreakpointSessionData(
                session.getId(),
                {},
                new Map([[trigger.getId(), { id: 41, verified: true }]]),
            );
            vi.mocked(debugService.sendBreakpoints).mockReturnValue(new Promise(() => undefined));
            await stop(adapter, session, { reason: "breakpoint", threadId: 1, hitBreakpointIds: [41, 99] });
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

            const stepped = session.next(1);
            await vi.advanceTimersByTimeAsync(1499);
            expect(adapter.sent("next")).toEqual([]);
            await vi.advanceTimersByTimeAsync(10);
            vi.useRealTimers();
            await stepped;

            expect(adapter.sent("next")).toHaveLength(1);
        });

        it("not at all once they are sent", async () => {
            const { session, adapter } = await launch();
            await stop(adapter, session, { reason: "breakpoint", threadId: 1, hitBreakpointIds: [] });

            await session.continue(1);

            expect(adapter.sent("continue")).toHaveLength(1);
        });

        it("a stop without a top frame triggers nothing", async () => {
            const { session, adapter } = await launch();
            adapter.handlers.set("stackTrace", () => ({ stackFrames: [] }));
            model.addBreakpoints(FILE, [{ lineNumber: 9, triggeredBy: "x" }]);

            await stop(adapter, session, { reason: "breakpoint", threadId: 1 });

            expect(debugService.sendBreakpoints).not.toHaveBeenCalled();
        });

        it("a breakpoint on another line of the frame's source triggers nothing", async () => {
            const { session, adapter } = await launch();
            const [above, below] = model.addBreakpoints(FILE, [{ lineNumber: 4 }, { lineNumber: 6 }]);
            model.addBreakpoints(FILE, [
                { lineNumber: 9, triggeredBy: above.getId() },
                { lineNumber: 10, triggeredBy: below.getId() },
            ]);

            await stop(adapter, session, { reason: "breakpoint", threadId: 1 });

            expect(debugService.sendBreakpoints).not.toHaveBeenCalled();
        });
    });

    describe("steps", () => {
        it("step back and reverse continue go out", async () => {
            const { session, adapter } = await launch({ supportsStepBack: true });

            await session.stepBack(1, "instruction");
            await session.reverseContinue(1);

            expect(adapter.sent("stepBack")[0].arguments as unknown).toEqual({
                threadId: 1,
                granularity: "instruction",
            });
            expect(adapter.sent("reverseContinue")[0].arguments as unknown).toEqual({ threadId: 1 });
        });

        it("a step of an unknown thread goes out without remembering the granularity", async () => {
            const { session, adapter } = await launch();

            await session.next(99, "line");

            expect(adapter.sent("next")[0].arguments as unknown).toEqual({ threadId: 99, granularity: "line" });
        });
    });

    describe("answers without a body", () => {
        it("exception info is nothing", async () => {
            const { session } = await launch({ supportsExceptionInfoRequest: true });
            vi.spyOn(session.raw!, "exceptionInfo").mockResolvedValue(undefined);

            expect(await session.exceptionInfo(1)).toBeUndefined();
        });

        it("data breakpoints keep no adapter data", async () => {
            const { session, adapter } = await launch({ supportsDataBreakpoints: true });
            adapter.sendEventBody("initialized");
            await settle(10);
            model.addDataBreakpoint({
                description: "x",
                src: { type: DataBreakpointSetType.Variable, dataId: "x" },
                canPersist: true,
                accessTypes: undefined,
                accessType: "write",
            });
            const [dbp] = model.getDataBreakpoints();
            adapter.handlers.set("setDataBreakpoints", () => undefined);

            await session.sendDataBreakpoints([dbp]);

            expect(session.getDebugProtocolBreakpoint(dbp.getId())).toBeUndefined();
        });
    });

    describe("configurationDone that fails", () => {
        it("is an error and disconnects", async () => {
            const adapter = disposables.add(new MockDebugAdapter());
            adapter.handlers.set("initialize", () => ({ supportsConfigurationDoneRequest: true }));
            adapter.handlers.set("configurationDone", () => new Error("bad config"));
            const session = disposables.add(
                createTestDebugSession(model, "s", undefined, debugService, services, { type: "mock" }),
            );
            model.addSession(session);
            await session.initialize(debuggerOf(adapter));

            adapter.sendEventBody("initialized");
            await vi.waitFor(() => {
                expect(session.state).toBe(State.Inactive);
            });
            await settle(10);

            expect(services.errors).toEqual(["bad config"]);
            expect(adapter.sent("disconnect")).toHaveLength(1);
        });

        it("is not sent, and no threads are fetched, when the session ended while the breakpoints went out", async () => {
            const adapter = disposables.add(new MockDebugAdapter());
            adapter.handlers.set("initialize", () => ({ supportsConfigurationDoneRequest: true }));
            let release: () => void = () => undefined;
            vi.mocked(debugService.sendAllBreakpoints).mockReturnValue(
                new Promise<void>((resolve) => {
                    release = resolve;
                }),
            );
            const session = disposables.add(
                createTestDebugSession(model, "s", undefined, debugService, services, { type: "mock" }),
            );
            model.addSession(session);
            await session.initialize(debuggerOf(adapter));
            adapter.sendEventBody("initialized");
            await vi.waitFor(() => {
                expect(debugService.sendAllBreakpoints).toHaveBeenCalled();
            });

            adapter.fireExit(0);
            await vi.waitFor(() => {
                expect(session.state).toBe(State.Inactive);
            });
            release();
            await settle(10);

            expect(adapter.sent("configurationDone")).toEqual([]);
            expect(adapter.sent("threads")).toEqual([]);
        });
    });

    describe("invalidated", () => {
        it("while a thread fetch is due does not schedule another", async () => {
            const { adapter } = await launch();
            adapter.sendEventBody("initialized");
            await vi.waitFor(() => {
                expect(adapter.sent("threads")).toHaveLength(1);
            });

            adapter.sendEventBody("thread", { reason: "started", threadId: 3 });
            adapter.sendEventBody("invalidated", { areas: ["threads"] });
            await settle(200);

            expect(adapter.sent("threads")).toHaveLength(2);
        });

        it("of a session that is not focused updates no view", async () => {
            const { adapter } = await launch();
            debugService.viewModel.setFocus(undefined, undefined, undefined, false);
            const updates = vi.fn();
            debugService.viewModel.onWillUpdateViews(updates);

            adapter.sendEventBody("invalidated", { areas: ["variables"] });
            await settle(10);

            expect(updates).not.toHaveBeenCalled();
        });
    });

    describe("the console of a child session", () => {
        it("a child with its own console keeps it when the parent ends", async () => {
            const { session: parent, adapter } = await launch();
            const { session: child } = await launch({}, { parentSession: parent, repl: "separate" });
            child.appendToRepl({ output: "child\n", sev: "info" });

            adapter.fireExit(0);
            await vi.waitFor(() => {
                expect(parent.state).toBe(State.Inactive);
            });

            expect(child.parentSession).toBe(parent);
            expect(child.getReplElements().map((e) => e.toString())).toEqual(["child\n"]);
        });

        it("a merged child that already ended keeps its parent", async () => {
            const { session: parent, adapter } = await launch();
            const child = disposables.add(
                createTestDebugSession(model, "child", { parentSession: parent, repl: "mergeWithParent" }),
            );

            adapter.fireExit(0);
            await vi.waitFor(() => {
                expect(parent.state).toBe(State.Inactive);
            });

            expect(child.parentSession).toBe(parent);
        });
    });
});
