// The details of a session that the coarser tests let through: what exactly goes out, which thread a stop or a
// continue touches, and what happens to the console, the breakpoints and the focus.

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
import { CancellationTokenSource } from "../../../../base/common/cancellation.ts";
import { CancellationError } from "../../../../base/common/errorSerialization.ts";
import { DisposableStore } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import {
    DataBreakpointSetType,
    type IBreakpointsChangeEvent,
    type IDebugger,
    type IDebugSessionOptions,
    State,
} from "../common/debug.ts";
import { type DebugModel, ExpressionContainer, type Thread } from "../common/debugModel.ts";
import { ReplOutputElement, ReplVariableElement } from "../common/replModel.ts";

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

describe("DebugSession details", () => {
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

    function newSession(options?: IDebugSessionOptions): DebugSession {
        const session = disposables.add(
            createTestDebugSession(model, "s", options, debugService, services, { type: "mock" }),
        );
        model.addSession(session);
        return session;
    }

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
        const session = newSession(options);
        await session.initialize(debuggerOf(adapter));
        await session.launchOrAttach(session.configuration);
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

    describe("what goes out", () => {
        it("initialize asks as upstream's client", async () => {
            const { adapter } = await launch();

            expect(adapter.sent("initialize")[0].arguments as unknown).toStrictEqual({
                clientID: "vscode",
                clientName: "Diode",
                adapterID: "mock",
                pathFormat: "path",
                linesStartAt1: true,
                columnsStartAt1: true,
                supportsVariableType: true,
                supportsVariablePaging: true,
                supportsRunInTerminalRequest: true,
                locale: "en",
                supportsProgressReporting: true,
                supportsInvalidatedEvent: true,
                supportsMemoryReferences: true,
                supportsArgsCanBeInterpretedByShell: true,
                supportsMemoryEvent: true,
                supportsStartDebuggingRequest: true,
                supportsANSIStyling: true,
            });
        });

        it("the answer of initialize changes the state once, before the launch", async () => {
            const adapter = disposables.add(new MockDebugAdapter());
            const session = newSession();
            const changes = vi.fn();
            session.onDidChangeState(changes);

            await session.initialize(debuggerOf(adapter));

            expect(changes).toHaveBeenCalledTimes(1);
        });

        it("terminate and disconnect default to no restart and no suspend", async () => {
            const { session, adapter } = await launch({
                supportsTerminateRequest: true,
                supportTerminateDebuggee: true,
                supportSuspendDebuggee: true,
            });

            await session.terminate();
            expect(adapter.sent("terminate")[0].arguments as unknown).toStrictEqual({ restart: false });

            const other = await launch({ supportTerminateDebuggee: true, supportSuspendDebuggee: true });
            await other.session.disconnect();
            expect(other.adapter.sent("disconnect")[0].arguments as unknown).toStrictEqual({
                restart: false,
                terminateDebuggee: false,
                suspendDebuggee: false,
            });
        });

        it.each([
            ["terminate", (s: DebugSession) => s.terminate()],
            ["disconnect", (s: DebugSession) => s.disconnect()],
            ["restart", (s: DebugSession) => s.restart()],
        ])("%s cancels the requests in flight", async (_what, act) => {
            const { session, adapter } = await launch({
                supportsCancelRequest: true,
                supportsRestartRequest: true,
                supportsTerminateRequest: true,
            });
            adapter.handlers.set("scopes", () => NO_RESPONSE);
            void session.scopes(1, 1).catch(() => undefined);

            await act(session);

            expect(adapter.sent("cancel").map((r) => r.arguments as unknown)).toEqual([
                { requestId: adapter.sent("scopes")[0].seq },
            ]);
        });

        it("a child its parent does not manage terminates, disconnects and restarts itself", async () => {
            const parent = newSession();
            const toParent = [
                vi.spyOn(parent, "terminate"),
                vi.spyOn(parent, "disconnect"),
                vi.spyOn(parent, "restart"),
            ];
            const { session, adapter } = await launch({ supportsRestartRequest: true }, { parentSession: parent });

            await session.restart();
            await session.terminate();

            expect(toParent.map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0]);
            expect(adapter.sent("restart")).toHaveLength(1);
            expect(adapter.sent("disconnect")).toHaveLength(1);
        });

        it("a session managed without a parent terminates itself", async () => {
            const { session, adapter } = await launch({}, { lifecycleManagedByParent: true });

            await session.terminate();

            expect(adapter.sent("disconnect")).toHaveLength(1);
        });

        it("exception info and locations ask about their thread and reference", async () => {
            const { session, adapter } = await launch({ supportsExceptionInfoRequest: true });
            adapter.handlers.set("exceptionInfo", () => ({ exceptionId: "e", breakMode: "always" }));
            adapter.handlers.set("locations", () => ({ source: { path: "/a.c" }, line: 1 }));

            await session.exceptionInfo(7);
            await session.resolveLocationReference(9);

            expect(adapter.sent("exceptionInfo")[0].arguments as unknown).toEqual({ threadId: 7 });
            expect(adapter.sent("locations")[0].arguments as unknown).toEqual({ locationReference: 9 });
        });

        it("byte data breakpoints without an adapter fail as the rest", async () => {
            const session = newSession();

            await expect(Promise.resolve().then(() => session.dataBytesBreakpointInfo("0x1", 4))).rejects.toThrow(
                "No debugger available, can not send 'data breakpoints info'",
            );
        });
    });

    describe("answers that come without anything", () => {
        it.each([
            ["setBreakpoints", (s: DebugSession) => s.sendBreakpoints(FILE, model.getBreakpoints() as never, false)],
            [
                "setFunctionBreakpoints",
                (s: DebugSession) => s.sendFunctionBreakpoints(model.getFunctionBreakpoints() as never),
            ],
            [
                "setExceptionBreakpoints",
                (s: DebugSession) => s.sendExceptionBreakpoints(model.getExceptionBreakpoints() as never),
            ],
            ["setDataBreakpoints", (s: DebugSession) => s.sendDataBreakpoints(model.getDataBreakpoints() as never)],
            [
                "setInstructionBreakpoints",
                (s: DebugSession) => s.sendInstructionBreakpoints(model.getInstructionBreakpoints() as never),
            ],
            ["dataBreakpointInfo", (s: DebugSession) => s.dataBreakpointInfo("x")],
            ["breakpointLocations", (s: DebugSession) => s.breakpointsLocations(FILE, 1)],
            ["loadedSources", (s: DebugSession) => s.getLoadedSources()],
            ["stepInTargets", (s: DebugSession) => s.stepInTargets(1)],
            ["disassemble", (s: DebugSession) => s.disassemble("0", 0, 0, 1)],
        ])("%s answered with nothing is no crash", async (command, call) => {
            const { session, adapter } = await launch({
                supportsFunctionBreakpoints: true,
                supportsDataBreakpoints: true,
                supportsInstructionBreakpoints: true,
                supportsBreakpointLocationsRequest: true,
                supportsLoadedSourcesRequest: true,
                supportsStepInTargetsRequest: true,
                supportsDisassembleRequest: true,
            });
            adapter.sendEventBody("initialized");
            await settle(5);
            model.addBreakpoints(FILE, [{ lineNumber: 1 }]);
            model.addFunctionBreakpoint({ name: "f" });
            const raw = session.raw!;
            const method = {
                setBreakpoints: "setBreakpoints",
                setFunctionBreakpoints: "setFunctionBreakpoints",
                setExceptionBreakpoints: "setExceptionBreakpoints",
                setDataBreakpoints: "setDataBreakpoints",
                setInstructionBreakpoints: "setInstructionBreakpoints",
                dataBreakpointInfo: "dataBreakpointInfo",
                breakpointLocations: "breakpointLocations",
                loadedSources: "loadedSources",
                stepInTargets: "stepInTargets",
                disassemble: "disassemble",
            }[command] as keyof typeof raw;
            vi.spyOn(raw, method as "threads").mockResolvedValue(undefined);

            await expect(call(session)).resolves.not.toThrow();
        });

        it("a location the adapter cannot resolve is an error", async () => {
            const { session } = await launch();
            vi.spyOn(session.raw!, "locations").mockResolvedValue(undefined);

            await expect(session.resolveLocationReference(1)).rejects.toThrow("can not send 'locations'");
        });

        it("threads answered without a body leave the threads alone", async () => {
            const { session, adapter } = await launch();
            adapter.handlers.set("threads", () => undefined);

            adapter.sendEventBody("initialized");
            await vi.waitFor(() => {
                expect(adapter.sent("threads")).toHaveLength(1);
            });
            await settle(5);

            expect(session.getAllThreads()).toEqual([]);
        });
    });

    describe("state", () => {
        it("follows the focused thread of the session over the others", async () => {
            const { session, adapter } = await launch();
            await stop(adapter, session, { reason: "pause", threadId: 1 });

            debugService.viewModel.setFocus(undefined, session.getThread(2), session, false);

            expect(session.state).toBe(State.Running);
        });
    });

    describe("threads", () => {
        it("a failed threads request is the caller's error; only a cancelled one (the adapter went away) is quiet", async () => {
            const { session, adapter } = await launch();
            const fetchThreads = (): Promise<void> =>
                (session as unknown as { fetchThreads(): Promise<void> }).fetchThreads();

            adapter.handlers.set("threads", () => new Error("no threads here"));
            await expect(fetchThreads()).rejects.toThrow("no threads here");

            const threads = vi.spyOn(session.raw!, "threads").mockRejectedValue(new CancellationError());
            await expect(fetchThreads()).resolves.toBeUndefined();
            // A session in shutdown answers nothing.
            threads.mockResolvedValue(undefined);
            await expect(fetchThreads()).resolves.toBeUndefined();
        });

        it("a stop of all threads keeps the others' old reason and clears every stack", async () => {
            const { session, adapter } = await launch();
            await stop(adapter, session, { reason: "pause", threadId: 2 });
            const worker = session.getThread(2)!;
            await worker.fetchCallStack();
            expect(worker.getCallStack().length).toBeGreaterThan(0);

            session.rawUpdate({
                sessionId: session.getId(),
                threads: [
                    { id: 1, name: "main" },
                    { id: 2, name: "worker" },
                ],
                stoppedDetails: { reason: "breakpoint", threadId: 1, allThreadsStopped: true },
            });

            expect(worker.stoppedDetails).toEqual({ reason: "pause" });
            expect(worker.getCallStack()).toEqual([]);
        });

        it("a stop of one thread clears its stack", async () => {
            const { session, adapter } = await launch();
            await stop(adapter, session, { reason: "pause", threadId: 1 });
            const main = session.getThread(1)!;
            await vi.waitFor(() => {
                expect(main.getCallStack()).toHaveLength(1);
            });

            session.rawUpdate({
                sessionId: "",
                threads: [{ id: 1, name: "main" }],
                stoppedDetails: { reason: "step", threadId: 1 },
            });

            expect(main.getCallStack()).toEqual([]);
        });

        it("clearing a thread clears its stack; clearing all and removing them forgets the values", async () => {
            const { session, adapter } = await launch();
            await stop(adapter, session, { reason: "pause", threadId: 1 });
            const main = session.getThread(1)!;
            await vi.waitFor(() => {
                expect(main.getCallStack()).toHaveLength(1);
            });

            session.clearThreads(false, 1);
            expect(main.getCallStack()).toEqual([]);
            ExpressionContainer.allValues.set("x", "1");
            session.clearThreads(true);

            expect(session.getAllThreads()).toEqual([]);
            expect(session.getThread(1)).toBeUndefined();
            expect(ExpressionContainer.allValues.size).toBe(0);
        });

        it("two threads that start within 100 ms are fetched 100 ms after the first", async () => {
            const { adapter } = await launch();
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

            adapter.sendEventBody("thread", { reason: "started", threadId: 3 });
            await vi.advanceTimersByTimeAsync(60);
            adapter.sendEventBody("thread", { reason: "started", threadId: 4 });
            await vi.advanceTimersByTimeAsync(45);

            expect(adapter.sent("threads")).toHaveLength(1);
        });

        it("all threads continuing while a fetch is due fetch them at once", async () => {
            const { adapter } = await launch();
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            adapter.sendEventBody("thread", { reason: "started", threadId: 3 });
            await vi.advanceTimersByTimeAsync(1);

            adapter.sendEventBody("continued", { threadId: 1 });
            await vi.advanceTimersByTimeAsync(5);

            expect(adapter.sent("threads")).toHaveLength(1);
        });

        it("a continue of a known thread fetches nothing", async () => {
            const { session, adapter } = await launch();
            await stop(adapter, session, { reason: "pause", threadId: 1 });
            const fetched = adapter.sent("threads").length;

            adapter.sendEventBody("continued", { threadId: 1, allThreadsContinued: false });
            await settle(10);

            expect(adapter.sent("threads")).toHaveLength(fetched);
        });

        it("a continue of a thread it did not know clears that thread's stop", async () => {
            const { session, adapter } = await launch();
            adapter.handlers.set("threads", () => ({ threads: [{ id: 1, name: "main" }] }));
            await stop(adapter, session, { reason: "pause", threadId: 5 });
            expect(session.getStoppedDetails()?.threadId).toBe(5);

            adapter.sendEventBody("continued", { threadId: 5, allThreadsContinued: false });
            await vi.waitFor(() => {
                expect(session.getStoppedDetails()).toBeUndefined();
            });
        });

        it("a thread event cancels the pending focus of that thread's stop", async () => {
            const { session, adapter } = await launch();
            let release: () => void = () => undefined;
            adapter.handlers.set("stackTrace", () => {
                const request = adapter.sent("stackTrace").at(-1)!;
                release = () => {
                    adapter.sendResponseBody(request, {
                        stackFrames: [{ id: 20, name: "w", source: { path: FILE.fsPath }, line: 1, column: 1 }],
                    });
                };
                return NO_RESPONSE;
            });
            adapter.sendEventBody("stopped", { reason: "pause", threadId: 2 });
            await vi.waitFor(() => {
                expect(adapter.sent("stackTrace")).toHaveLength(1);
            });

            adapter.sendEventBody("thread", { reason: "started", threadId: 2 });
            await settle(5);
            release();
            await settle(10);

            expect(debugService.viewModel.focusedThread?.threadId).not.toBe(2);
            expect(session.getThread(2)).toBeDefined();
        });

        it("a continue of one thread cancels the pending focus of that thread's stop", async () => {
            const { session, adapter } = await launch();
            let release: () => void = () => undefined;
            adapter.handlers.set("stackTrace", () => {
                const request = adapter.sent("stackTrace").at(-1)!;
                release = () => {
                    adapter.sendResponseBody(request, {
                        stackFrames: [{ id: 20, name: "w", source: { path: FILE.fsPath }, line: 1, column: 1 }],
                    });
                };
                return NO_RESPONSE;
            });
            adapter.sendEventBody("stopped", { reason: "pause", threadId: 2 });
            await vi.waitFor(() => {
                expect(adapter.sent("stackTrace")).toHaveLength(1);
            });

            adapter.sendEventBody("continued", { threadId: 2, allThreadsContinued: false });
            await settle(5);
            release();
            await settle(10);

            expect(debugService.viewModel.focusedThread).toBeUndefined();
            expect(session.getThread(2)?.stopped).toBe(false);
        });

        it("a thread that exits cancels the focus a continue scheduled", async () => {
            const { session, adapter } = await launch();
            const other = newSession();
            vi.spyOn(other, "state", "get").mockReturnValue(State.Stopped);
            await stop(adapter, session, { reason: "pause", allThreadsStopped: true });
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            const unfocused = debugService.viewModel.focusedThread?.threadId === 1 ? 2 : 1;
            adapter.sendEventBody("continued", { threadId: 1 });
            await vi.advanceTimersByTimeAsync(10);
            const calls = vi.mocked(debugService.focusStackFrame).mock.calls.length;

            adapter.sendEventBody("thread", { reason: "exited", threadId: unfocused });
            await vi.advanceTimersByTimeAsync(900);

            expect(vi.mocked(debugService.focusStackFrame).mock.calls.slice(calls)).toEqual([]);
        });

        it("a quick stop cancels the focus a continue scheduled", async () => {
            const { session, adapter } = await launch();
            const other = newSession();
            vi.spyOn(other, "state", "get").mockReturnValue(State.Stopped);
            await stop(adapter, session, { reason: "pause", allThreadsStopped: true });
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            adapter.sendEventBody("continued", { threadId: 1 });
            await vi.advanceTimersByTimeAsync(10);

            adapter.sendEventBody("stopped", { reason: "step", threadId: 1, preserveFocusHint: true });
            await vi.advanceTimersByTimeAsync(900);

            expect(vi.mocked(debugService.focusStackFrame).mock.calls.at(-1)).not.toEqual([undefined]);
        });

        it("with nothing stopped anywhere a continue passes no focus", async () => {
            const { session, adapter } = await launch();
            await stop(adapter, session, { reason: "pause", allThreadsStopped: true });
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            const calls = vi.mocked(debugService.focusStackFrame).mock.calls.length;

            adapter.sendEventBody("continued", { threadId: 1 });
            await vi.advanceTimersByTimeAsync(900);

            expect(vi.mocked(debugService.focusStackFrame).mock.calls.length).toBe(calls);
        });

        it("a continued focused thread with a stopped neighbour passes the focus to the stopped thread", async () => {
            const { session, adapter } = await launch();
            await stop(adapter, session, { reason: "pause", threadId: 1 });
            await stop(adapter, session, { reason: "pause", threadId: 2, preserveFocusHint: true });
            await vi.waitFor(() => {
                expect(debugService.viewModel.focusedThread?.threadId).toBe(1);
            });
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            const calls = vi.mocked(debugService.focusStackFrame).mock.calls.length;

            adapter.sendEventBody("continued", { threadId: 1, allThreadsContinued: false });
            await vi.advanceTimersByTimeAsync(900);

            expect(vi.mocked(debugService.focusStackFrame).mock.calls.slice(calls)).toEqual([
                [undefined, session.getThread(2)],
            ]);
        });
    });

    describe("the console", () => {
        it("several logged variables are variables, each on its own", async () => {
            const { session, adapter } = await launch();
            adapter.handlers.set("variables", () => ({
                variables: [
                    { name: "a", value: "1", variablesReference: 0 },
                    { name: "b", value: "2", variablesReference: 0 },
                ],
            }));

            adapter.sendEventBody("output", { output: "ignored", variablesReference: 2 });
            await vi.waitFor(() => {
                expect(session.getReplElements()).toHaveLength(2);
            });

            expect(session.getReplElements().every((e) => e instanceof ReplVariableElement)).toBe(true);
        });

        it("output inside a group stays in it until the group ends", async () => {
            const { session, adapter } = await launch();

            adapter.sendEventBody("output", { output: "group", group: "start" });
            adapter.sendEventBody("output", { output: "x\n" });
            adapter.sendEventBody("output", { output: "y\n" });
            await vi.waitFor(() => {
                expect(session.getReplElements()).toHaveLength(1);
                expect(
                    (session.getReplElements()[0] as unknown as { getChildren(): unknown[] }).getChildren(),
                ).toHaveLength(2);
            });
        });

        it("a child with a merged console that is cloned keeps reporting its changes", async () => {
            const { session: parent, adapter } = await launch();
            const { session: child } = await launch({}, { parentSession: parent, repl: "mergeWithParent" });
            adapter.fireExit(0);
            await vi.waitFor(() => {
                expect(child.parentSession).toBeUndefined();
            });
            const changes = vi.fn();
            child.onDidChangeReplElements(changes);

            child.appendToRepl({ output: "after\n", sev: "info" });

            expect(changes).toHaveBeenCalledWith(expect.any(ReplOutputElement));
        });
    });

    describe("breakpoint events", () => {
        it("reach the breakpoint of the adapter's id, not another", async () => {
            const { session, adapter } = await launch();
            const [first, second] = model.addBreakpoints(FILE, [{ lineNumber: 1 }, { lineNumber: 2 }]);
            const fbp1 = model.addFunctionBreakpoint({ name: "a" });
            const fbp2 = model.addFunctionBreakpoint({ name: "b" });
            for (const description of ["x", "y"]) {
                model.addDataBreakpoint({
                    description,
                    src: { type: DataBreakpointSetType.Variable, dataId: description },
                    canPersist: true,
                    accessTypes: undefined,
                    accessType: "write",
                });
            }
            const [dbp1, dbp2] = model.getDataBreakpoints();
            model.setExceptionBreakpointsForSession(session.getId(), [
                { filter: "a", label: "A" },
                { filter: "b", label: "B" },
            ]);
            const [ebp1, ebp2] = model.getExceptionBreakpoints();
            model.setBreakpointSessionData(
                session.getId(),
                {},
                new Map<string, DebugProtocol.Breakpoint>([
                    [first.getId(), { id: 1, verified: false }],
                    [second.getId(), { id: 2, verified: false }],
                    [fbp1.getId(), { id: 3, verified: false }],
                    [fbp2.getId(), { id: 4, verified: false }],
                    [dbp1.getId(), { id: 5, verified: false }],
                    [dbp2.getId(), { id: 6, verified: false }],
                    [ebp1.getId(), { id: 7, verified: false }],
                    [ebp2.getId(), { id: 8, verified: false }],
                ]),
            );

            for (const id of [2, 4, 6, 8]) {
                adapter.sendEventBody("breakpoint", { reason: "changed", breakpoint: { id, verified: true, line: 2 } });
            }
            await vi.waitFor(() => {
                expect(ebp2.verified).toBe(true);
            });

            expect([first, second, fbp1, fbp2, dbp1, dbp2, ebp1, ebp2].map((bp) => bp.verified)).toEqual([
                false,
                true,
                false,
                true,
                false,
                true,
                false,
                true,
            ]);
        });

        it("a new one is enabled, at its column, without a model change of the user's breakpoints", async () => {
            const { adapter } = await launch();
            const events: (IBreakpointsChangeEvent | undefined)[] = [];
            model.onDidChangeBreakpoints((e) => events.push(e));

            adapter.sendEventBody("breakpoint", {
                reason: "new",
                breakpoint: { id: 5, verified: true, source: { path: FILE.fsPath }, line: 9, column: 4 },
            });
            await vi.waitFor(() => {
                expect(model.getBreakpoints()).toHaveLength(1);
            });

            expect(model.getBreakpoints()[0]).toMatchObject({ enabled: true, lineNumber: 9, column: 4 });
            expect(events.some((e) => e?.added !== undefined)).toBe(false);
        });

        it("a changed one with a column keeps the adapter's column", async () => {
            const { session, adapter } = await launch();
            const [bp] = model.addBreakpoints(FILE, [{ lineNumber: 1, column: 3 }]);
            model.setBreakpointSessionData(session.getId(), {}, new Map([[bp.getId(), { id: 1, verified: false }]]));

            adapter.sendEventBody("breakpoint", {
                reason: "changed",
                breakpoint: { id: 1, verified: true, line: 1, column: 5 },
            });
            await vi.waitFor(() => {
                expect(bp.verified).toBe(true);
            });

            expect(bp.column).toBe(5);
        });

        it("other reasons change nothing", async () => {
            const { session, adapter } = await launch();
            const [bp] = model.addBreakpoints(FILE, [{ lineNumber: 1 }]);
            model.setBreakpointSessionData(session.getId(), {}, new Map([[bp.getId(), { id: 1, verified: false }]]));

            adapter.sendEventBody("breakpoint", { reason: "verified", breakpoint: { id: 1, verified: true } });
            await settle(10);

            expect([model.getBreakpoints().length, bp.verified]).toEqual([1, false]);
        });
    });

    describe("invalidated", () => {
        it("cancels the requests in flight and clears the threads before refetching", async () => {
            const { session, adapter } = await launch({ supportsCancelRequest: true });
            await stop(adapter, session, { reason: "pause", threadId: 1 });
            adapter.handlers.set("scopes", () => NO_RESPONSE);
            void session.scopes(1, 1).catch(() => undefined);
            const before = session.getThread(1);

            adapter.sendEventBody("invalidated", { areas: ["stacks"] });
            await vi.waitFor(() => {
                expect(adapter.sent("cancel")).toHaveLength(1);
            });
            await vi.waitFor(() => {
                expect(session.getThread(1)).toBeDefined();
            });

            expect(session.getThread(1)).not.toBe(before);
        });
    });

    describe("stops", () => {
        it("a stop of every thread of many fetches only the top of each stack", async () => {
            const { session, adapter } = await launch({ supportsDelayedStackTraceLoading: true });
            adapter.handlers.set("threads", () => ({
                threads: Array.from({ length: 11 }, (_, i) => ({ id: i + 1, name: `t${String(i + 1)}` })),
            }));

            await stop(adapter, session, { reason: "pause", allThreadsStopped: true });
            await vi.waitFor(() => {
                expect(adapter.sent("stackTrace")).toHaveLength(11);
            });
            await settle(20);

            expect(adapter.sent("stackTrace").every((r) => (r.arguments as { levels: number }).levels === 1)).toBe(
                true,
            );
        });

        it("a stop of every thread of a few fetches whole stacks", async () => {
            const { session, adapter } = await launch({ supportsDelayedStackTraceLoading: true });
            adapter.handlers.set("stackTrace", () => ({
                stackFrames: [{ id: 10, name: "f", source: { path: FILE.fsPath }, line: 5, column: 1 }],
                totalFrames: 2,
            }));

            await stop(adapter, session, { reason: "pause", allThreadsStopped: true });
            await vi.waitFor(() => {
                expect(adapter.sent("stackTrace").some((r) => (r.arguments as { levels: number }).levels === 19)).toBe(
                    true,
                );
            });
        });

        it("a stop of another session's focused frame keeps the focus there", async () => {
            const { session: other, adapter: otherAdapter } = await launch();
            await stop(otherAdapter, other, { reason: "pause", threadId: 1 });
            await vi.waitFor(() => {
                expect(debugService.viewModel.focusedSession).toBe(other);
            });
            const { session, adapter } = await launch();

            await stop(adapter, session, { reason: "pause", threadId: 1 });
            await settle(10);

            expect(debugService.viewModel.focusedSession).toBe(other);
        });

        it("a stop whose top frame is de-emphasized tries the focus again once the stack is in", async () => {
            const { session, adapter } = await launch({ supportsDelayedStackTraceLoading: true });
            adapter.handlers.set("stackTrace", (args) =>
                (args as DebugProtocol.StackTraceArguments).startFrame === 0
                    ? {
                          stackFrames: [{ id: 1, name: "subtle", line: 0, column: 0, presentationHint: "subtle" }],
                          totalFrames: 2,
                      }
                    : {
                          stackFrames: [{ id: 2, name: "real", source: { path: FILE.fsPath }, line: 3, column: 1 }],
                          totalFrames: 2,
                      },
            );

            await stop(adapter, session, { reason: "pause", threadId: 1 });

            await vi.waitFor(() => {
                expect(
                    vi.mocked(debugService.focusStackFrame).mock.calls.filter((c) => c[1] === session.getThread(1)),
                ).toHaveLength(2);
            });
        });

        it("a stop with a well-placed focus does not focus again", async () => {
            const { session, adapter } = await launch({ supportsDelayedStackTraceLoading: true });

            await stop(adapter, session, { reason: "pause", threadId: 1 });
            await settle(20);

            expect(
                vi.mocked(debugService.focusStackFrame).mock.calls.filter((c) => c[1] === session.getThread(1)),
            ).toHaveLength(1);
        });

        it("only dependents of a hit breakpoint are triggered, by the adapter's ids", async () => {
            const { session, adapter } = await launch();
            const [hit, other] = model.addBreakpoints(FILE, [{ lineNumber: 5 }, { lineNumber: 6 }]);
            const [dependent] = model.addBreakpoints(Uri.file("/src/b.c"), [
                { lineNumber: 1, triggeredBy: hit.getId() },
            ]);
            const [notDependent] = model.addBreakpoints(Uri.file("/src/c.c"), [
                { lineNumber: 1, triggeredBy: other.getId() },
            ]);
            model.addBreakpoints(Uri.file("/src/d.c"), [{ lineNumber: 1, triggeredBy: hit.getId(), enabled: false }]);
            model.setBreakpointSessionData(
                session.getId(),
                {},
                new Map([
                    [hit.getId(), { id: 41, verified: true }],
                    [other.getId(), { id: 42, verified: true }],
                ]),
            );

            await stop(adapter, session, { reason: "breakpoint", threadId: 1, hitBreakpointIds: [41] });
            await settle(10);

            expect(dependent.getSessionDidTrigger(session.getId())).toBe(true);
            expect(notDependent.getSessionDidTrigger(session.getId())).toBe(false);
            expect(vi.mocked(debugService.sendBreakpoints).mock.calls.map((c) => c[0].toString())).toEqual([
                Uri.file("/src/b.c").toString(),
            ]);
        });

        it("a breakpoint of another source on the stopped line triggers nothing", async () => {
            const { session, adapter } = await launch();
            const [elsewhere] = model.addBreakpoints(Uri.file("/src/other.c"), [{ lineNumber: 5 }]);
            model.addBreakpoints(Uri.file("/src/b.c"), [{ lineNumber: 1, triggeredBy: elsewhere.getId() }]);

            await stop(adapter, session, { reason: "breakpoint", threadId: 1 });
            await settle(10);

            expect(debugService.sendBreakpoints).not.toHaveBeenCalled();
        });

        it("a breakpoint within the frame's columns triggers", async () => {
            const { session, adapter } = await launch();
            adapter.handlers.set("stackTrace", () => ({
                stackFrames: [{ id: 1, name: "f", source: { path: FILE.fsPath }, line: 5, column: 3, endColumn: 9 }],
            }));
            const [inside] = model.addBreakpoints(FILE, [{ lineNumber: 5, column: 9 }]);
            model.addBreakpoints(Uri.file("/src/b.c"), [{ lineNumber: 1, triggeredBy: inside.getId() }]);

            await stop(adapter, session, { reason: "breakpoint", threadId: 1 });
            await vi.waitFor(() => {
                expect(debugService.sendBreakpoints).toHaveBeenCalledTimes(1);
            });
        });
    });

    describe("shutdown", () => {
        it("forgets the sources and threads, and the scheduled focus", async () => {
            const { session, adapter } = await launch();
            const other = newSession();
            vi.spyOn(other, "state", "get").mockReturnValue(State.Stopped);
            await stop(adapter, session, { reason: "pause", allThreadsStopped: true });
            const source = session.getSource({ path: "/x.c" });
            adapter.sendEventBody("continued", { threadId: 1 });
            await settle(5);
            const calls = vi.mocked(debugService.focusStackFrame).mock.calls.length;

            adapter.fireExit(0);
            await vi.waitFor(() => {
                expect(session.state).toBe(State.Inactive);
            });
            await settle(900);

            expect(session.getSourceForUri(source.uri)).toBeUndefined();
            expect(session.getAllThreads()).toEqual([]);
            expect(session.getStoppedDetails()).toBeUndefined();
            expect(vi.mocked(debugService.focusStackFrame).mock.calls.length).toBe(calls);
        });

        it("cancels the requests in flight on dispose", async () => {
            const { session, adapter } = await launch({ supportsCancelRequest: true });
            adapter.handlers.set("scopes", () => NO_RESPONSE);
            const token = new CancellationTokenSource();
            void session.stackTrace(1, 0, 1, token.token).catch(() => undefined);

            session.dispose();

            expect(adapter.sent("cancel")).toHaveLength(1);
        });
    });
});
