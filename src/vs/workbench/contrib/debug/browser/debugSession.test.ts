// A session over the synthetic adapter (the spike's C++ program) and over the mock adapter for the events the
// program does not send.

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
import {
    NO_DELAY_TIMING,
    SYNTHETIC_PROGRAM_ROOT,
    SyntheticDebugAdapter,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { CancellationTokenSource } from "../../../../base/common/cancellation.ts";
import { isCancellationError } from "../../../../base/common/errorSerialization.ts";
import { DisposableStore } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { Position } from "../../../../editor/common/core/position.ts";
import type { AbstractDebugAdapter } from "../common/abstractDebugAdapter.ts";
import { DataBreakpointSetType, type IDebugger, type IDebugSessionOptions, State } from "../common/debug.ts";
import type { Breakpoint, DebugModel, Thread } from "../common/debugModel.ts";
import type { ReplOutputElement } from "../common/replModel.ts";

import type { DebugSession } from "./debugSession.ts";

const MAIN_CPP = Uri.file(`${SYNTHETIC_PROGRAM_ROOT}/src/main.cpp`);

function debuggerOf(adapter: AbstractDebugAdapter, overrides: Partial<IDebugger> = {}): IDebugger {
    return {
        type: "synthetic",
        createDebugAdapter: () => Promise.resolve(adapter),
        runInTerminal: () => Promise.resolve(undefined),
        startDebugging: () => Promise.resolve(true),
        getInitialConfigurationContent: () => Promise.resolve(""),
        ...overrides,
    };
}

describe("DebugSession", () => {
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

    function newSession(
        options?: IDebugSessionOptions,
        configuration: Partial<Parameters<typeof createTestDebugSession>[5]> = {},
    ): DebugSession {
        const session = disposables.add(
            createTestDebugSession(model, "Launch hello (lldb)", options, debugService, services, {
                type: "synthetic",
                ...configuration,
            }),
        );
        model.addSession(session);
        return session;
    }

    async function launch(
        adapter: AbstractDebugAdapter,
        options?: IDebugSessionOptions,
        configuration?: Partial<Parameters<typeof createTestDebugSession>[5]>,
    ): Promise<DebugSession> {
        disposables.add(adapter);
        const session = newSession(options, configuration);
        await session.initialize(debuggerOf(adapter));
        await session.launchOrAttach(session.configuration);
        await debugService.focusStackFrame(undefined, undefined, session);
        return session;
    }

    async function launchSynthetic(): Promise<{ session: DebugSession; adapter: SyntheticDebugAdapter }> {
        const adapter = new SyntheticDebugAdapter(NO_DELAY_TIMING);
        const session = await launch(adapter);
        await vi.waitFor(() => {
            expect(session.state).toBe(State.Stopped);
        });
        return { session, adapter };
    }

    function commands(adapter: SyntheticDebugAdapter | MockDebugAdapter): string[] {
        return adapter.requests.map((r) => r.command);
    }

    describe("on the synthetic program", () => {
        it("is initializing until the adapter answered, then running until it stops", async () => {
            const adapter = disposables.add(new SyntheticDebugAdapter(NO_DELAY_TIMING));
            const session = newSession();
            const states: State[] = [];
            session.onDidChangeState(() => states.push(session.state));
            expect(session.state).toBe(State.Initializing);

            await session.initialize(debuggerOf(adapter));
            expect(session.state).toBe(State.Running);
            await session.launchOrAttach(session.configuration);
            await vi.waitFor(() => {
                expect(states.at(-1)).toBe(State.Stopped);
            });

            expect(states.at(0)).toBe(State.Running);
        });

        it("asks the adapter as a DAP client with lines and columns from 1", async () => {
            const { adapter, session } = await launchSynthetic();

            expect(adapter.requests[0].arguments).toMatchObject({
                clientID: "vscode",
                clientName: "Diode",
                adapterID: "synthetic",
                pathFormat: "path",
                linesStartAt1: true,
                columnsStartAt1: true,
                supportsVariableType: true,
                supportsVariablePaging: true,
                supportsRunInTerminalRequest: true,
                supportsProgressReporting: true,
                supportsInvalidatedEvent: true,
                supportsMemoryReferences: true,
                supportsStartDebuggingRequest: true,
            });
            expect(adapter.requests[1].arguments).toMatchObject({ __sessionId: session.getId() });
            expect(session.rememberedCapabilities?.supportsConfigurationDoneRequest).toBe(true);
            expect(debugService.setExceptionBreakpointsForSession).toHaveBeenCalledWith(
                session,
                session.capabilities.exceptionBreakpointFilters,
            );
        });

        it("on `initialized` sends the breakpoints, then configurationDone, then asks for the threads", async () => {
            const { adapter, session } = await launchSynthetic();

            expect(debugService.sendAllBreakpoints).toHaveBeenCalledWith(session);
            const done = commands(adapter).indexOf("configurationDone");
            expect(commands(adapter).slice(0, done + 2)).toEqual([
                "initialize",
                "launch",
                "configurationDone",
                "threads",
            ]);
        });

        it("stops with three threads, the main one on the breakpoint at main.cpp:27, all of them stopped", async () => {
            const { session } = await launchSynthetic();

            expect(session.getAllThreads().map((t) => [t.threadId, t.name, t.stopped])).toEqual([
                [1, "hello", true],
                [2, "worker-1", true],
                [3, "worker-2", true],
            ]);
            const main = session.getThread(1)!;
            expect(main.stoppedDetails).toMatchObject({ reason: "breakpoint", threadId: 1, allThreadsStopped: true });
            expect(session.getThread(2)?.stoppedDetails).toEqual({ reason: undefined });
            expect(session.getStoppedDetails()).toMatchObject({ reason: "breakpoint" });
            await vi.waitFor(() => {
                expect(debugService.viewModel.focusedStackFrame?.name).toBe("accumulate(std::vector<int> const&)");
            });
            expect(debugService.viewModel.focusedStackFrame?.range.startLineNumber).toBe(27);
            expect(debugService.viewModel.focusedStackFrame?.source.uri.toString()).toBe(MAIN_CPP.toString());
        });

        it("loads the main stack in pages of 20 out of 26", async () => {
            const { adapter, session } = await launchSynthetic();
            const main = session.getThread(1)!;
            await vi.waitFor(() => {
                expect(main.getCallStack()).toHaveLength(20);
            });

            expect(
                adapter.requests
                    .filter((r) => r.command === "stackTrace" && (r.arguments as { threadId: number }).threadId === 1)
                    .map((r) => r.arguments as unknown),
            ).toEqual([
                { threadId: 1, startFrame: 0, levels: 1 },
                { threadId: 1, startFrame: 1, levels: 19 },
            ]);
            expect(main.reachedEndOfCallStack).toBe(false);
            await model.fetchCallstack(main, 20);
            expect(main.getCallStack()).toHaveLength(26);
            expect(main.getCallStack().at(-1)?.name).toBe("_start");
        });

        it("has the scopes and variables of the spike, `nums` in chunks of 100", async () => {
            const { session } = await launchSynthetic();
            const frame = session.getThread(1)!.getTopStackFrame();
            const scopes = (await frame?.getScopes()) ?? [];

            expect(scopes.map((s) => s.name)).toEqual(["Locals", "Static", "Global", "Registers"]);
            const locals = await scopes[0].getChildren();
            expect(locals.map((v) => v.name)).toEqual([
                "nums",
                "i",
                "sum",
                "total",
                "count",
                "name",
                "ok",
                "p",
                "head",
                "flags",
                "cfg",
                "bad",
            ]);
            const chunks = await locals[0].getChildren();
            expect(chunks).toHaveLength(10);
            expect(chunks[0].name).toBe("[0..99]");
            const firstChunk = await chunks[0].getChildren();
            expect(firstChunk[5]).toMatchObject({ name: "[5]", value: "67" });
        });

        it("steps: three steps over, the third one throws `std::out_of_range`", async () => {
            const { session } = await launchSynthetic();
            const main = session.getThread(1)!;

            for (const reason of ["step", "step"]) {
                await main.next();
                await vi.waitFor(() => {
                    expect(main.stoppedDetails?.reason).toBe(reason);
                    expect(session.state).toBe(State.Stopped);
                });
            }
            await main.next();
            await vi.waitFor(() => {
                expect(main.stoppedDetails?.reason).toBe("exception");
            });

            expect(main.stoppedDetails).toMatchObject({
                text: "std::out_of_range",
                description: "Exception has occurred.",
            });
            expect(await main.exceptionInfo).toEqual({
                id: "std::out_of_range",
                description: "vector::_M_range_check: __n (which is 1000) >= this->size() (which is 1000)",
                breakMode: "always",
                details: {
                    typeName: "std::out_of_range",
                    stackTrace: expect.stringContaining("at accumulate(std::vector<int> const&)") as unknown,
                },
            });
            expect(main.lastSteppingGranularity).toBeUndefined();
        });

        it("continue runs, writes the logpoint and stops on the breakpoint again", async () => {
            const { session } = await launchSynthetic();
            const main = session.getThread(1)!;
            const states: State[] = [];
            session.onDidChangeState(() => states.push(session.state));

            await main.continue();
            await vi.waitFor(() => {
                expect(main.stoppedDetails?.reason).toBe("breakpoint");
                expect(session.state).toBe(State.Stopped);
            });

            expect(states).toContain(State.Running);
            const output = session.getReplElements() as ReplOutputElement[];
            const logpoint = output.find((e) => e.value.startsWith("sum="));
            expect(logpoint?.sourceData).toMatchObject({ lineNumber: 35, column: 1 });
            expect(logpoint?.severity).toBe("warning");
        });

        it("writes the program's output into the console with its severity", async () => {
            const { session } = await launchSynthetic();

            const output = (session.getReplElements() as ReplOutputElement[]).map((e) => [
                e.value.trimEnd(),
                e.severity,
            ]);
            expect(output.slice(0, 4)).toEqual([
                ["Launching: /home/user/hello/build/hello --verbose input.txt", "warning"],
                ["Launched process 48213 from '/home/user/hello/build/hello'", "warning"],
                ["Hello from hello 1.2.0!", "info"],
                ["Reading input.txt: 1000 numbers", "info"],
            ]);
        });

        it("step into and step out stop again; restart frame too", async () => {
            const { session } = await launchSynthetic();
            const main = session.getThread(1)!;

            await main.stepIn("line");
            expect(main.lastSteppingGranularity).toBe("line");
            await vi.waitFor(() => {
                expect(main.getTopStackFrame()?.range.startLineNumber).toBe(28);
            });
            await main.stepOut();
            await vi.waitFor(() => {
                expect(main.getTopStackFrame()?.range.startLineNumber).toBe(27);
            });
            await session.restartFrame(1000, 1);
            await vi.waitFor(() => {
                expect(main.stoppedDetails?.reason).toBe("restart");
            });
        });

        it("pause stops a running program", async () => {
            const adapter = new SyntheticDebugAdapter({ ...NO_DELAY_TIMING, continueMs: 60_000 });
            const session = await launch(adapter);
            await vi.waitFor(() => {
                expect(session.state).toBe(State.Stopped);
            });
            const main = session.getThread(1)!;
            await main.continue();
            await vi.waitFor(() => {
                expect(main.stopped).toBe(false);
            });

            await main.pause();

            await vi.waitFor(() => {
                expect(main.stoppedDetails?.reason).toBe("pause");
            });
        });

        it("evaluates, sets a variable and lists the loaded sources", async () => {
            const { session } = await launchSynthetic();

            expect((await session.evaluate("sum", 1000, "watch"))?.body.result).toBe("0");
            await expect(session.evaluate("total / count", 1000, "watch")).rejects.toThrow("error: division by zero");
            const scope = (await session.getThread(1)!.getTopStackFrame()?.getScopes())?.[0];
            await session.setVariable(scope?.reference ?? 0, "count", "4");
            expect((await session.evaluate("total / count", 1000, "watch"))?.body.result).toBe("0");
            expect((await session.getLoadedSources()).map((s) => s.name)).toEqual([
                "main.cpp",
                "list.cpp",
                "queue.cpp",
            ]);
        });

        it("terminate ends the program and the adapter", async () => {
            const { adapter, session } = await launchSynthetic();
            const ended = vi.fn();
            session.onDidEndAdapter(ended);

            await session.terminate();
            await vi.waitFor(() => {
                expect(ended).toHaveBeenCalledTimes(1);
            });

            expect(commands(adapter)).toContain("terminate");
            expect(commands(adapter).at(-1)).toBe("disconnect");
            expect(session.state).toBe(State.Inactive);
            expect(session.getAllThreads()).toEqual([]);
            expect((session.getReplElements().at(-1) as ReplOutputElement).value).toBe("Process exited with code 0.\n");
        });

        it("terminating a thread removes it", async () => {
            const { session } = await launchSynthetic();

            await session.getThread(3)?.terminate();
            await vi.waitFor(() => {
                expect(session.getThread(3)).toBeUndefined();
            });
        });
    });

    describe("terminate and disconnect", () => {
        it("an attach session is disconnected with its debuggee terminated", async () => {
            const adapter = new MockDebugAdapter();
            adapter.handlers.set("initialize", () => ({
                supportsTerminateRequest: true,
                supportTerminateDebuggee: true,
            }));
            const session = await launch(adapter, undefined, { request: "attach" });

            await session.terminate(true);

            expect(adapter.sent("terminate")).toEqual([]);
            expect(adapter.sent("disconnect")[0].arguments).toEqual({ restart: true, terminateDebuggee: true });
        });

        it("disconnect leaves the debuggee running, or suspends it", async () => {
            const adapter = new MockDebugAdapter();
            adapter.handlers.set("initialize", () => ({
                supportTerminateDebuggee: true,
                supportSuspendDebuggee: true,
            }));
            const session = await launch(adapter);

            await session.disconnect(false, true);

            expect(adapter.sent("disconnect")[0].arguments).toEqual({
                restart: false,
                terminateDebuggee: false,
                suspendDebuggee: true,
            });
        });

        it("a session managed by its parent passes terminate, disconnect and restart up", async () => {
            const parent = newSession();
            const terminate = vi.spyOn(parent, "terminate").mockResolvedValue();
            const disconnect = vi.spyOn(parent, "disconnect").mockResolvedValue();
            const restart = vi.spyOn(parent, "restart").mockResolvedValue();
            const child = await launch(new MockDebugAdapter(), {
                parentSession: parent,
                lifecycleManagedByParent: true,
            });

            await child.terminate(true);
            await child.disconnect(true, true);
            await child.restart();

            expect(terminate).toHaveBeenCalledWith(true);
            expect(disconnect).toHaveBeenCalledWith(true, true);
            expect(restart).toHaveBeenCalledTimes(1);
            expect(child.lifecycleManagedByParent).toBe(true);
        });

        it("restart asks the adapter with the configuration", async () => {
            const adapter = new MockDebugAdapter();
            adapter.handlers.set("initialize", () => ({ supportsRestartRequest: true }));
            const session = await launch(adapter);

            await session.restart();

            expect(adapter.sent("restart")[0].arguments).toEqual({ arguments: session.configuration });
        });

        it("without an adapter a terminate or disconnect ends the session as if `terminated` came", async () => {
            const session = newSession();
            const ended: unknown[] = [];
            session.onDidEndAdapter((e) => ended.push(e));

            await session.terminate();
            await session.disconnect();

            expect(ended).toEqual([undefined, undefined]);
            expect(session.state).toBe(State.Inactive);
        });

        it("`terminated` with restart data asks the service to restart, without disconnects", async () => {
            const adapter = new MockDebugAdapter();
            const session = await launch(adapter);

            adapter.sendEventBody("terminated", { restart: { port: 1 } });
            await vi.waitFor(() => {
                expect(debugService.restartSession).toHaveBeenCalledWith(session, { port: 1 });
            });
            expect(adapter.sent("disconnect")).toEqual([]);
        });

        it("`terminated` without restart data disconnects without terminating the debuggee", async () => {
            const adapter = new MockDebugAdapter();
            adapter.handlers.set("initialize", () => ({ supportTerminateDebuggee: true }));
            await launch(adapter);

            adapter.sendEventBody("terminated");
            await vi.waitFor(() => {
                expect(adapter.sent("disconnect")[0]?.arguments).toEqual({ restart: false, terminateDebuggee: false });
            });
        });
    });

    describe("start failures", () => {
        it("an adapter that fails to initialize leaves the session inactive and rejects", async () => {
            const adapter = disposables.add(new MockDebugAdapter());
            adapter.handlers.set("initialize", () => new Error("no lldb"));
            const session = newSession();
            const states: State[] = [];
            session.onDidChangeState(() => states.push(session.state));

            await expect(session.initialize(debuggerOf(adapter))).rejects.toThrow("no lldb");

            expect(session.state).toBe(State.Inactive);
            expect(states).toContain(State.Inactive);
        });

        it("a failed launch shuts the adapter down and rejects", async () => {
            const adapter = disposables.add(new MockDebugAdapter());
            adapter.handlers.set("launch", () => new Error("no program"));
            const session = newSession();
            await session.initialize(debuggerOf(adapter));

            await expect(session.launchOrAttach(session.configuration)).rejects.toThrow("no program");

            expect(session.state).toBe(State.Inactive);
            expect(adapter.sent("disconnect")).toHaveLength(1);
        });

        it("a child of an ended parent does not launch", async () => {
            const parent = newSession();
            await parent.terminate();
            const adapter = disposables.add(new MockDebugAdapter());
            const child = newSession({ parentSession: parent });
            await child.initialize(debuggerOf(adapter));

            const error = await child.launchOrAttach(child.configuration).catch((e: unknown) => e);

            expect(isCancellationError(error)).toBe(true);
            expect(adapter.sent("launch")).toEqual([]);
        });

        it("initializing again shuts the previous adapter down", async () => {
            const first = new MockDebugAdapter();
            const session = await launch(first);
            const second = disposables.add(new MockDebugAdapter());

            await session.initialize(debuggerOf(second));

            expect(first.sent("disconnect")).toHaveLength(1);
            expect(second.sent("initialize")).toHaveLength(1);
        });
    });

    describe("without an adapter", () => {
        const calls: [string, (s: DebugSession) => unknown][] = [
            ["launch or attach", (s) => s.launchOrAttach(s.configuration)],
            ["restart", (s) => s.restart()],
            ["breakpoints", (s) => s.sendBreakpoints(MAIN_CPP, [], false)],
            ["function breakpoints", (s) => s.sendFunctionBreakpoints([])],
            ["exception breakpoints", (s) => s.sendExceptionBreakpoints([])],
            ["data breakpoints", (s) => s.sendDataBreakpoints([])],
            ["instruction breakpoints", (s) => s.sendInstructionBreakpoints([])],
            ["data breakpoints info", (s) => s.dataBreakpointInfo("a")],
            ["breakpoints locations", (s) => s.breakpointsLocations(MAIN_CPP, 1)],
            ["myRequest", (s) => s.customRequest("myRequest", {})],
            ["stackTrace", (s) => s.stackTrace(1, 0, 1, new CancellationTokenSource().token)],
            ["exceptionInfo", (s) => s.exceptionInfo(1)],
            ["scopes", (s) => s.scopes(1, 1)],
            ["variables", (s) => s.variables(1, 1, undefined, undefined, undefined)],
            ["evaluate", (s) => s.evaluate("a", 1)],
            ["restartFrame", (s) => s.restartFrame(1, 1)],
            ["next", (s) => s.next(1)],
            ["stepIn", (s) => s.stepIn(1)],
            ["stepOut", (s) => s.stepOut(1)],
            ["stepBack", (s) => s.stepBack(1)],
            ["continue", (s) => s.continue(1)],
            ["reverse continue", (s) => s.reverseContinue(1)],
            ["pause", (s) => s.pause(1)],
            ["terminateThreads", (s) => s.terminateThreads([1])],
            ["setVariable", (s) => s.setVariable(1, "a", "1")],
            ["setExpression", (s) => s.setExpression(1, "a", "1")],
            ["gotoTargets", (s) => s.gotoTargets({}, 1)],
            ["goto", (s) => s.goto(1, 1)],
            ["loadSource", (s) => s.loadSource(MAIN_CPP)],
            ["getLoadedSources", (s) => s.getLoadedSources()],
            ["completions", (s) => s.completions(1, 1, "a", new Position(1, 1), new CancellationTokenSource().token)],
            ["stepInTargets", (s) => s.stepInTargets(1)],
            ["cancel", (s) => s.cancel("p")],
            ["disassemble", (s) => s.disassemble("0", 0, 0, 1)],
            ["readMemory", (s) => s.readMemory("0", 0, 1)],
            ["writeMemory", (s) => s.writeMemory("0", 0, "")],
            ["locations", (s) => s.resolveLocationReference(1)],
        ];

        it.each(calls)("'%s' fails", async (what, call) => {
            const session = newSession();

            await expect(Promise.resolve().then(() => call(session))).rejects.toThrow(
                `No debugger available, can not send '${what}'`,
            );
        });
    });

    describe("requests", () => {
        it("a missing location is an error, a found one comes with its source", async () => {
            const adapter = new MockDebugAdapter();
            const session = await launch(adapter);
            adapter.handlers.set("locations", () => undefined);
            await expect(session.resolveLocationReference(1)).rejects.toThrow("can not send 'locations'");

            adapter.handlers.set("locations", () => ({ source: { path: "/a.c" }, line: 3 }));
            const location = await session.resolveLocationReference(2);

            expect(location).toMatchObject({ line: 3, column: 1 });
            expect(location.source.uri.toString()).toBe(Uri.file("/a.c").toString());
        });

        it("breakpoint locations are distinct positions, column 1 by default", async () => {
            const adapter = new MockDebugAdapter();
            adapter.handlers.set("initialize", () => ({ supportsBreakpointLocationsRequest: true }));
            const session = await launch(adapter);
            adapter.handlers.set("breakpointLocations", () => ({
                breakpoints: [{ line: 3 }, { line: 3, column: 1 }, { line: 3, column: 5 }],
            }));

            expect(await session.breakpointsLocations(MAIN_CPP, 3)).toEqual([
                { lineNumber: 3, column: 1 },
                { lineNumber: 3, column: 5 },
            ]);
            expect(adapter.sent("breakpointLocations")[0].arguments).toEqual({
                source: { name: "main.cpp", path: MAIN_CPP.fsPath },
                line: 3,
            });

            adapter.handlers.set("breakpointLocations", () => undefined);
            expect(await session.breakpointsLocations(MAIN_CPP, 3)).toEqual([]);
        });

        it("loads a source by the session's source, or by the uri", async () => {
            const adapter = new MockDebugAdapter();
            const session = await launch(adapter);
            const known = session.getSource({ name: "gen.c", sourceReference: 7 });

            await session.loadSource(known.uri);
            await session.loadSource(MAIN_CPP);

            expect(adapter.sent("source").map((r) => r.arguments as unknown)).toEqual([
                { sourceReference: 7, source: { name: "gen.c", sourceReference: 7 } },
                { sourceReference: 0, source: { path: MAIN_CPP.fsPath, sourceReference: undefined } },
            ]);
        });

        it("no loaded sources when the adapter says nothing", async () => {
            const adapter = new MockDebugAdapter();
            adapter.handlers.set("initialize", () => ({ supportsLoadedSourcesRequest: true }));
            const session = await launch(adapter);
            adapter.handlers.set("loadedSources", () => undefined);

            expect(await session.getLoadedSources()).toEqual([]);
        });

        it("passes completions, step-in targets, goto, memory and cancel through", async () => {
            const adapter = new MockDebugAdapter();
            adapter.handlers.set("initialize", () => ({
                supportsCompletionsRequest: true,
                supportsStepInTargetsRequest: true,
                supportsGotoTargetsRequest: true,
                supportsDisassembleRequest: true,
                supportsReadMemoryRequest: true,
                supportsWriteMemoryRequest: true,
                supportsSetExpression: true,
                supportsTerminateThreadsRequest: true,
            }));
            const session = await launch(adapter);
            adapter.handlers.set("stepInTargets", () => ({ targets: [{ id: 1, label: "f" }] }));
            adapter.handlers.set("disassemble", () => ({ instructions: [{ address: "0x1", instruction: "nop" }] }));

            await session.completions(1, 2, "pr", new Position(3, 4), new CancellationTokenSource().token);
            expect(await session.stepInTargets(5)).toEqual([{ id: 1, label: "f" }]);
            await session.gotoTargets({ path: "/a.c" }, 6, 7);
            await session.goto(1, 8);
            expect(await session.disassemble("0x0", 1, 2, 3)).toEqual([{ address: "0x1", instruction: "nop" }]);
            await session.readMemory("0x0", 1, 2);
            await session.writeMemory("0x0", 1, "AA", true);
            await session.setExpression(1, "a", "2");
            await session.cancel("p1");
            await session.customRequest("myRequest", { a: 1 });
            await session.terminateThreads([1, 2]);

            expect(adapter.sent("completions")[0].arguments).toEqual({ frameId: 1, text: "pr", column: 4, line: 3 });
            expect(adapter.sent("stepInTargets")[0].arguments).toEqual({ frameId: 5 });
            expect(adapter.sent("gotoTargets")[0].arguments).toEqual({ source: { path: "/a.c" }, line: 6, column: 7 });
            expect(adapter.sent("goto")[0].arguments).toEqual({ threadId: 1, targetId: 8 });
            expect(adapter.sent("disassemble")[0].arguments).toEqual({
                memoryReference: "0x0",
                offset: 1,
                instructionOffset: 2,
                instructionCount: 3,
                resolveSymbols: true,
            });
            expect(adapter.sent("readMemory")[0].arguments).toEqual({ count: 2, memoryReference: "0x0", offset: 1 });
            expect(adapter.sent("writeMemory")[0].arguments).toEqual({
                memoryReference: "0x0",
                offset: 1,
                allowPartial: true,
                data: "AA",
            });
            expect(adapter.sent("setExpression")[0].arguments).toEqual({ expression: "a", value: "2", frameId: 1 });
            expect(adapter.sent("cancel")[0].arguments).toEqual({ progressId: "p1" });
            expect(adapter.sent("myRequest")[0].arguments).toEqual({ a: 1 });
            expect(adapter.sent("terminateThreads")[0].arguments).toEqual({ threadIds: [1, 2] });
        });

        it("evaluates with the location", async () => {
            const adapter = new MockDebugAdapter();
            const session = await launch(adapter);

            await session.evaluate("x", 3, "hover", { line: 4, column: 5, source: { path: "/a.c" } });

            expect(adapter.sent("evaluate")[0].arguments).toEqual({
                expression: "x",
                frameId: 3,
                context: "hover",
                line: 4,
                column: 5,
                source: { path: "/a.c" },
            });
        });

        it("asks the data breakpoint info, by name or by address", async () => {
            const adapter = new MockDebugAdapter();
            adapter.handlers.set("initialize", () => ({ supportsDataBreakpoints: true }));
            const session = await launch(adapter);
            adapter.handlers.set("dataBreakpointInfo", () => ({ dataId: "d", description: "x" }));
            await expect(session.dataBreakpointInfo("x", 2, 3)).rejects.toThrow("Session is not ready for breakpoints");
            adapter.sendEventBody("initialized");
            await settle(0);

            expect(await session.dataBreakpointInfo("x", 2, 3)).toEqual({ dataId: "d", description: "x" });
            await session.dataBytesBreakpointInfo("0x10", 4);

            expect(adapter.sent("dataBreakpointInfo").map((r) => r.arguments as unknown)).toEqual([
                { name: "x", variablesReference: 2, frameId: 3 },
                { name: "0x10", bytes: 4, asAddress: true },
            ]);
        });

        it("refuses byte data breakpoints the adapter says it cannot do", async () => {
            const adapter = new MockDebugAdapter();
            adapter.handlers.set("initialize", () => ({ supportsDataBreakpointBytes: false }));
            const session = await launch(adapter);

            expect(() => session.dataBytesBreakpointInfo("0x10", 4)).toThrow(
                "Session does not support breakpoints with bytes",
            );
        });

        it("cancels the requests of a thread when it continues", async () => {
            const adapter = new MockDebugAdapter();
            adapter.handlers.set("initialize", () => ({ supportsCancelRequest: true }));
            const session = await launch(adapter);
            adapter.handlers.set("scopes", () => NO_RESPONSE);
            adapter.handlers.set("threads", () => ({ threads: [{ id: 1, name: "t" }] }));
            adapter.sendEventBody("stopped", { reason: "pause", threadId: 1 });
            await vi.waitFor(() => {
                expect(session.getThread(1)?.stopped).toBe(true);
            });
            void session.scopes(9, 1);

            adapter.sendEventBody("continued", { threadId: 1, allThreadsContinued: false });

            await vi.waitFor(() => {
                expect(adapter.sent("cancel").map((r) => r.arguments as unknown)).toEqual([
                    { requestId: adapter.sent("scopes")[0].seq },
                ]);
            });
        });
    });

    describe("events", () => {
        async function launchMock(capabilities: DebugProtocol.Capabilities = {}): Promise<{
            session: DebugSession;
            adapter: MockDebugAdapter;
        }> {
            const adapter = new MockDebugAdapter();
            adapter.handlers.set("initialize", () => capabilities);
            adapter.handlers.set("threads", () => ({
                threads: [
                    { id: 1, name: "main" },
                    { id: 2, name: "worker" },
                ],
            }));
            adapter.handlers.set("stackTrace", () => ({
                stackFrames: [{ id: 10, name: "f", source: { path: MAIN_CPP.fsPath }, line: 5, column: 1 }],
                totalFrames: 1,
            }));
            const session = await launch(adapter);
            return { session, adapter };
        }

        it("a thread that started is fetched a moment later", async () => {
            const { session, adapter } = await launchMock();
            await vi.waitFor(() => {
                expect(adapter.sent("threads")).toHaveLength(0);
            });
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

            adapter.sendEventBody("thread", { reason: "started", threadId: 2 });
            adapter.sendEventBody("thread", { reason: "started", threadId: 2 });
            await vi.advanceTimersByTimeAsync(99);
            expect(adapter.sent("threads")).toEqual([]);
            await vi.advanceTimersByTimeAsync(10);

            expect(adapter.sent("threads")).toHaveLength(1);
            expect(session.getAllThreads().map((t) => t.name)).toEqual(["main", "worker"]);
        });

        it("a thread that exited is gone and loses the focus", async () => {
            const { session, adapter } = await launchMock();
            adapter.sendEventBody("stopped", { reason: "pause", threadId: 2 });
            await vi.waitFor(() => {
                expect(debugService.viewModel.focusedThread?.threadId).toBe(2);
            });

            adapter.sendEventBody("thread", { reason: "exited", threadId: 2 });
            await vi.waitFor(() => {
                expect(session.getThread(2)).toBeUndefined();
            });

            expect(debugService.focusStackFrame).toHaveBeenLastCalledWith(undefined, undefined, session, {
                explicit: false,
            });
        });

        it("a thread that exited unfocused leaves the focus alone", async () => {
            const { session, adapter } = await launchMock();
            adapter.sendEventBody("stopped", { reason: "pause", threadId: 1 });
            await vi.waitFor(() => {
                expect(debugService.viewModel.focusedThread?.threadId).toBe(1);
            });
            const focusCalls = vi.mocked(debugService.focusStackFrame).mock.calls.length;

            adapter.sendEventBody("thread", { reason: "exited", threadId: 2 });
            await vi.waitFor(() => {
                expect(session.getThread(2)).toBeUndefined();
            });

            expect(vi.mocked(debugService.focusStackFrame).mock.calls.length).toBe(focusCalls);
        });

        it("a stop of one thread stops only it and focuses its top frame", async () => {
            const { session, adapter } = await launchMock();
            adapter.handlers.set("threads", () => ({
                threads: [
                    { id: 1, name: "main" },
                    { id: 2, name: "worker" },
                ],
            }));

            adapter.sendEventBody("stopped", { reason: "breakpoint", threadId: 2 });
            await vi.waitFor(() => {
                expect(debugService.viewModel.focusedStackFrame?.name).toBe("f");
            });

            expect(session.getAllThreads().map((t) => t.stopped)).toEqual([false, true]);
            expect(debugService.viewModel.focusedThread?.threadId).toBe(2);
            expect(session.state).toBe(State.Stopped);
        });

        it("a stop that asks to keep the focus does not take it", async () => {
            const { session, adapter } = await launchMock();

            adapter.sendEventBody("stopped", { reason: "breakpoint", threadId: 1, preserveFocusHint: true });
            await vi.waitFor(() => {
                expect(session.getThread(1)!.getCallStack()).toHaveLength(1);
            });
            await settle(0);

            expect(debugService.viewModel.focusedThread).toBeUndefined();
        });

        it("a stop without a thread stops every thread", async () => {
            const { session, adapter } = await launchMock();

            adapter.sendEventBody("stopped", { reason: "pause", allThreadsStopped: true });
            await vi.waitFor(() => {
                expect(session.getAllThreads().map((t) => t.stopped)).toEqual([true, true]);
            });
        });

        it("continue of one thread clears only its stop", async () => {
            const { session, adapter } = await launchMock();
            adapter.sendEventBody("stopped", { reason: "pause", allThreadsStopped: true });
            await vi.waitFor(() => {
                expect(session.getAllThreads().map((t) => t.stopped)).toEqual([true, true]);
            });

            adapter.sendEventBody("continued", { threadId: 2, allThreadsContinued: false });
            await vi.waitFor(() => {
                expect(session.getAllThreads().map((t) => t.stopped)).toEqual([true, false]);
            });
        });

        it("continue of all threads clears every stop and passes the focus on", async () => {
            const { session, adapter } = await launchMock();
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            const other = newSession();
            vi.spyOn(other, "state", "get").mockReturnValue(State.Stopped);
            adapter.sendEventBody("stopped", { reason: "pause", allThreadsStopped: true });
            await vi.advanceTimersByTimeAsync(10);
            expect(debugService.viewModel.focusedSession).toBe(session);

            adapter.sendEventBody("continued", { threadId: 1 });
            await vi.advanceTimersByTimeAsync(10);
            expect(session.getAllThreads().map((t) => t.stopped)).toEqual([false, false]);
            const calls = vi.mocked(debugService.focusStackFrame).mock.calls.length;
            await vi.advanceTimersByTimeAsync(800);

            expect(vi.mocked(debugService.focusStackFrame).mock.calls.slice(calls)).toEqual([[undefined]]);
        });

        it("continue of the focused thread passes the focus to the stopped one", async () => {
            const { session, adapter } = await launchMock();
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            adapter.sendEventBody("stopped", { reason: "pause", threadId: 1 });
            await vi.advanceTimersByTimeAsync(10);
            adapter.sendEventBody("stopped", { reason: "pause", threadId: 2, preserveFocusHint: true });
            await vi.advanceTimersByTimeAsync(10);
            expect(debugService.viewModel.focusedThread?.threadId).toBe(1);

            adapter.sendEventBody("continued", { threadId: 1, allThreadsContinued: false });
            await vi.advanceTimersByTimeAsync(810);

            expect(debugService.viewModel.focusedThread?.threadId).toBe(2);
            expect(session.getStoppedDetails()?.threadId).toBe(2);
        });

        it("continue of a thread it did not know yet fetches the threads first", async () => {
            const { session, adapter } = await launchMock();
            adapter.handlers.set("threads", () => ({ threads: [{ id: 5, name: "late" }] }));

            adapter.sendEventBody("continued", { threadId: 5, allThreadsContinued: false });
            await vi.waitFor(() => {
                expect(session.getThread(5)?.name).toBe("late");
            });
        });

        it("output goes to the console: stderr as error, console as warning, the rest as info", async () => {
            const { session, adapter } = await launchMock();

            adapter.sendEventBody("output", { category: "stderr", output: "e\n" });
            adapter.sendEventBody("output", { category: "console", output: "c\n" });
            adapter.sendEventBody("output", { category: "stdout", output: "o\n" });
            adapter.sendEventBody("output", { output: "n\n", source: { path: MAIN_CPP.fsPath }, line: 4, column: 2 });
            adapter.sendEventBody("output", { category: "telemetry", output: "t\n" });
            await vi.waitFor(() => {
                expect(session.getReplElements()).toHaveLength(4);
            });

            const output = session.getReplElements() as ReplOutputElement[];
            expect(output.map((e) => [e.value, e.severity])).toEqual([
                ["e\n", "error"],
                ["c\n", "warning"],
                ["o\n", "info"],
                ["n\n", "info"],
            ]);
            expect(output[3].sourceData).toMatchObject({ lineNumber: 4, column: 2 });
            expect(output[0].sourceData).toBeUndefined();
        });

        it("output with a line but no source, or a source but no line, has no location", async () => {
            const { session, adapter } = await launchMock();

            adapter.sendEventBody("output", { output: "a\n", line: 4 });
            adapter.sendEventBody("output", { output: "b\n", source: { path: MAIN_CPP.fsPath } });
            adapter.sendEventBody("output", { output: "c\n", source: { path: MAIN_CPP.fsPath }, line: 4 });
            await vi.waitFor(() => {
                expect(session.getReplElements()).toHaveLength(3);
            });

            const output = session.getReplElements() as ReplOutputElement[];
            expect(output.map((e) => e.sourceData?.column)).toEqual([undefined, undefined, 1]);
        });

        it("important output is also a notification", async () => {
            const { session, adapter } = await launchMock();

            adapter.sendEventBody("output", { category: "important", output: "Read this" });
            await vi.waitFor(() => {
                expect(services.notifications).toEqual([
                    { message: "Read this", severity: "info", source: "Launch hello (lldb)" },
                ]);
            });
            expect(session.getReplElements()).toHaveLength(1);
        });

        it("groups: start, start collapsed, end with and without output", async () => {
            const { session, adapter } = await launchMock();

            adapter.sendEventBody("output", { output: "outer", group: "start" });
            adapter.sendEventBody("output", { output: "inner", group: "startCollapsed" });
            adapter.sendEventBody("output", { output: "", group: "end" });
            adapter.sendEventBody("output", { output: "last\n", group: "end" });
            await vi.waitFor(() => {
                expect(session.getReplElements().map((e) => e.toString())).toEqual(["outer", "last\n"]);
            });

            const outer = session.getReplElements()[0] as unknown as {
                autoExpand: boolean;
                hasEnded: boolean;
                getChildren(): unknown[];
            };
            expect(outer).toMatchObject({ autoExpand: true, hasEnded: true });
            expect(outer.getChildren()).toEqual([
                expect.objectContaining({ name: "inner", autoExpand: false, hasEnded: true }),
            ]);
        });

        it("output with variables shows them: one with the text, several each on its own", async () => {
            const { session, adapter } = await launchMock();
            adapter.handlers.set("variables", (args) =>
                (args as DebugProtocol.VariablesArguments).variablesReference === 1
                    ? { variables: [{ name: "a", value: "1", variablesReference: 0 }] }
                    : {
                          variables: [
                              { name: "a", value: "1", variablesReference: 0 },
                              { name: "b", value: "2", variablesReference: 0 },
                          ],
                      },
            );

            adapter.sendEventBody("output", { output: "a is 1", variablesReference: 1, category: "important" });
            adapter.sendEventBody("output", { output: "ignored", variablesReference: 2, category: "stderr" });
            await vi.waitFor(() => {
                expect(session.getReplElements()).toHaveLength(3);
            });

            const [one, first, second] = session.getReplElements() as unknown as {
                value?: string;
                severity: string;
                expression: { name: string | null; value: string };
            }[];
            expect(one.value).toBe("a is 1");
            expect(one.expression.value).toBe("1");
            expect(first.expression).toMatchObject({ name: null, value: "1" });
            expect(second.expression).toMatchObject({ name: null, value: "2" });
            expect(first.severity).toBe("error");
            expect(services.notifications.map((n) => n.message)).toEqual(["a is 1", "", ""].slice(0, 1));
        });

        it("breakpoint events: a new one is added and verified, changed updates it, removed removes it", async () => {
            const { session, adapter } = await launchMock();

            adapter.sendEventBody("breakpoint", {
                reason: "new",
                breakpoint: { id: 5, verified: true, source: { path: MAIN_CPP.fsPath }, line: 9 },
            });
            await vi.waitFor(() => {
                expect(model.getBreakpoints()).toHaveLength(1);
            });
            const bp = model.getBreakpoints()[0];
            expect([bp.lineNumber, bp.verified, bp.getIdFromAdapter(session.getId())]).toEqual([9, true, 5]);

            adapter.sendEventBody("breakpoint", {
                reason: "changed",
                breakpoint: { id: 5, verified: true, line: 11, column: 3 },
            });
            await vi.waitFor(() => {
                expect(bp.lineNumber).toBe(11);
            });
            expect(bp.column).toBeUndefined();

            adapter.sendEventBody("breakpoint", { reason: "removed", breakpoint: { id: 5, verified: true } });
            await vi.waitFor(() => {
                expect(model.getBreakpoints()).toEqual([]);
            });
        });

        it("a new breakpoint without a source or line is not added", async () => {
            const { adapter } = await launchMock();

            adapter.sendEventBody("breakpoint", { reason: "new", breakpoint: { id: 6, verified: true, line: 9 } });
            adapter.sendEventBody("breakpoint", {
                reason: "new",
                breakpoint: { id: 7, verified: true, source: { path: "/a.c" } },
            });
            await settle(0);
            await settle(0);

            expect(model.getBreakpoints()).toEqual([]);
        });

        it("breakpoint events reach the function, data and exception breakpoints of the adapter's ids", async () => {
            const { session, adapter } = await launchMock();
            const fbp = model.addFunctionBreakpoint({ name: "main" });
            model.addDataBreakpoint({
                description: "x",
                src: { type: DataBreakpointSetType.Variable, dataId: "x" },
                canPersist: true,
                accessTypes: undefined,
                accessType: "write",
            });
            const dbp = model.getDataBreakpoints()[0];
            model.setExceptionBreakpointsForSession(session.getId(), [{ filter: "f", label: "F" }]);
            const ebp = model.getExceptionBreakpoints()[0];
            model.setBreakpointSessionData(
                session.getId(),
                {},
                new Map<string, DebugProtocol.Breakpoint>([
                    [fbp.getId(), { id: 1, verified: false }],
                    [dbp.getId(), { id: 2, verified: false }],
                    [ebp.getId(), { id: 3, verified: false }],
                ]),
            );

            for (const id of [1, 2, 3]) {
                adapter.sendEventBody("breakpoint", { reason: "changed", breakpoint: { id, verified: true } });
            }
            await vi.waitFor(() => {
                expect([fbp.verified, dbp.verified, ebp.verified]).toEqual([true, true, true]);
            });

            adapter.sendEventBody("breakpoint", { reason: "removed", breakpoint: { id: 1, verified: true } });
            adapter.sendEventBody("breakpoint", { reason: "removed", breakpoint: { id: 2, verified: true } });
            await vi.waitFor(() => {
                expect([model.getFunctionBreakpoints().length, model.getDataBreakpoints().length]).toEqual([0, 0]);
            });
        });

        it("passes loaded sources, custom, progress and memory events on", async () => {
            const { session, adapter } = await launchMock();
            const seen: string[] = [];
            session.onDidLoadedSource((e) => seen.push(`${e.reason}:${e.source.name}`));
            session.onDidCustomEvent((e) => seen.push(e.event));
            session.onDidProgressStart((e) => seen.push(e.event));
            session.onDidProgressUpdate((e) => seen.push(e.event));
            session.onDidProgressEnd((e) => seen.push(e.event));
            session.onDidInvalidateMemory((e) => seen.push(e.event));

            adapter.sendEventBody("loadedSource", { reason: "new", source: { path: "/x/y.c" } });
            adapter.sendEventBody("myEvent", {});
            adapter.sendEventBody("progressStart", { progressId: "p", title: "t" });
            adapter.sendEventBody("progressUpdate", { progressId: "p" });
            adapter.sendEventBody("progressEnd", { progressId: "p" });
            adapter.sendEventBody("memory", { memoryReference: "m", offset: 0, count: 1 });
            await vi.waitFor(() => {
                expect(seen).toEqual([
                    "new:y.c",
                    "myEvent",
                    "progressStart",
                    "progressUpdate",
                    "progressEnd",
                    "memory",
                ]);
            });
        });

        it("invalidated stacks refetch the stops; invalidated variables only update the views", async () => {
            const { session, adapter } = await launchMock();
            adapter.sendEventBody("stopped", { reason: "pause", threadId: 1 });
            await vi.waitFor(() => {
                expect(debugService.viewModel.focusedSession).toBe(session);
                expect(session.getThread(1)?.stopped).toBe(true);
            });
            const updates = vi.fn();
            debugService.viewModel.onWillUpdateViews(updates);
            const stackTraces = adapter.sent("stackTrace").length;

            adapter.sendEventBody("invalidated", { areas: ["variables"] });
            await vi.waitFor(() => {
                expect(updates).toHaveBeenCalledTimes(1);
            });
            expect(adapter.sent("stackTrace")).toHaveLength(stackTraces);

            adapter.sendEventBody("invalidated", {});
            await vi.waitFor(() => {
                expect(adapter.sent("stackTrace").length).toBeGreaterThan(stackTraces);
                expect(session.getThread(1)?.stopped).toBe(true);
            });
            expect(updates).toHaveBeenCalledTimes(2);
        });

        it.each([["threads"], ["stacks"], ["all"]])(
            "invalidated '%s' with no stop refetches the threads",
            async (area) => {
                const { adapter } = await launchMock();
                vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
                const threads = adapter.sent("threads").length;

                adapter.sendEventBody("invalidated", { areas: [area] });
                await vi.advanceTimersByTimeAsync(110);

                expect(adapter.sent("threads").length).toBe(threads + 1);
            },
        );

        it("the adapter's end ends the session: its breakpoint data and threads are dropped", async () => {
            const { session, adapter } = await launchMock();
            model.addBreakpoints(MAIN_CPP, [{ lineNumber: 1 }]);
            model.setBreakpointSessionData(
                session.getId(),
                {},
                new Map([[model.getBreakpoints()[0].getId(), { id: 1, verified: true }]]),
            );
            const ended = vi.fn();
            session.onDidEndAdapter(ended);

            adapter.fireExit(1);
            await vi.waitFor(() => {
                // The adapter stopped cleanly after all, so no error goes with the end; it did go away by itself.
                expect(ended).toHaveBeenCalledWith({
                    emittedStopped: false,
                    sessionLengthInSeconds: 0,
                    failure: new Error("exit code: 1"),
                });
            });

            expect(model.getBreakpoints()[0].getIdFromAdapter(session.getId())).toBeUndefined();
            expect(session.state).toBe(State.Inactive);
        });
    });

    describe("breakpoints", () => {
        it("are not sent before `initialized`", async () => {
            const adapter = disposables.add(new MockDebugAdapter());
            const session = newSession();
            await session.initialize(debuggerOf(adapter));

            await session.sendBreakpoints(MAIN_CPP, [], false);
            await session.sendFunctionBreakpoints([]);
            await session.sendExceptionBreakpoints([]);
            await session.sendDataBreakpoints([]);
            await session.sendInstructionBreakpoints([]);

            expect(adapter.requests.map((r) => r.command)).toEqual(["initialize"]);
        });

        async function ready(capabilities: DebugProtocol.Capabilities = {}): Promise<{
            session: DebugSession;
            adapter: MockDebugAdapter;
        }> {
            const adapter = new MockDebugAdapter();
            adapter.handlers.set("initialize", () => capabilities);
            const session = await launch(adapter);
            adapter.sendEventBody("initialized");
            await settle(0);
            return { session, adapter };
        }

        it("sends the source's breakpoints and keeps the adapter's answer", async () => {
            const { session, adapter } = await ready();
            const bps = model.addBreakpoints(MAIN_CPP, [{ lineNumber: 3, condition: "i > 1" }, { lineNumber: 7 }]);
            adapter.handlers.set("setBreakpoints", () => ({
                breakpoints: [
                    { id: 1, verified: true, line: 3 },
                    { id: 2, verified: false, line: 7, message: "no code" },
                ],
            }));

            await session.sendBreakpoints(MAIN_CPP, bps, true);

            expect(adapter.sent("setBreakpoints")[0].arguments).toEqual({
                source: { name: "main.cpp", path: MAIN_CPP.fsPath },
                lines: [3, 7],
                breakpoints: [{ line: 3, condition: "i > 1" }, { line: 7 }],
                sourceModified: true,
            });
            expect(bps.map((bp) => [bp.verified, bp.message])).toEqual([
                [true, undefined],
                [false, "no code"],
            ]);
            expect(session.getDebugProtocolBreakpoint(bps[0].getId())).toMatchObject({ id: 1 });
        });

        it("sends a source known to the session with the first breakpoint's adapter data", async () => {
            const { session, adapter } = await ready();
            const source = session.getSource({ name: "gen.c", sourceReference: 4 });
            const bps = model.addBreakpoints(source.uri, [{ lineNumber: 1 }]);
            (bps[0] as Breakpoint).setSessionData(session.getId(), {
                verified: true,
                source: { adapterData: "ad" },
            } as never);
            adapter.handlers.set("setBreakpoints", () => ({ breakpoints: [{ verified: true }] }));

            await session.sendBreakpoints(source.uri, bps, false);

            expect(adapter.sent("setBreakpoints")[0].arguments).toMatchObject({
                source: { name: "gen.c", sourceReference: 4, adapterData: "ad" },
            });
        });

        it("sends exception filters, with conditions when the adapter takes filter options", async () => {
            const { session, adapter } = await ready({ supportsExceptionFilterOptions: true });
            model.setExceptionBreakpointsForSession(session.getId(), [
                { filter: "a", label: "A" },
                { filter: "b", label: "B", supportsCondition: true },
            ]);
            const [a, b] = model.getExceptionBreakpoints();
            model.setExceptionBreakpointCondition(b, "x > 1");
            adapter.handlers.set("setExceptionBreakpoints", () => ({
                breakpoints: [{ verified: true }, { verified: false }],
            }));

            await session.sendExceptionBreakpoints([a, b]);

            expect(adapter.sent("setExceptionBreakpoints")[0].arguments).toEqual({
                filters: [],
                filterOptions: [{ filterId: "a" }, { filterId: "b", condition: "x > 1" }],
            });
            expect([a.verified, b.verified]).toEqual([true, false]);
        });

        it("sends exception filters by name to an adapter without filter options", async () => {
            const { session, adapter } = await ready();
            model.setExceptionBreakpointsForSession(session.getId(), [{ filter: "a", label: "A" }]);
            adapter.handlers.set("setExceptionBreakpoints", () => undefined);

            await session.sendExceptionBreakpoints(model.getExceptionBreakpoints());

            expect(adapter.sent("setExceptionBreakpoints")[0].arguments).toEqual({ filters: ["a"] });
        });

        it("sends function and instruction breakpoints and keeps the answers", async () => {
            const { session, adapter } = await ready({
                supportsFunctionBreakpoints: true,
                supportsInstructionBreakpoints: true,
            });
            const fbp = model.addFunctionBreakpoint({ name: "main" });
            model.addInstructionBreakpoint({ instructionReference: "0x1", offset: 0, address: 1n, canPersist: false });
            const ibp = model.getInstructionBreakpoints()[0];
            adapter.handlers.set("setFunctionBreakpoints", () => ({ breakpoints: [{ verified: true }] }));
            adapter.handlers.set("setInstructionBreakpoints", () => ({ breakpoints: [{ verified: true }] }));

            await session.sendFunctionBreakpoints([fbp]);
            await session.sendInstructionBreakpoints([ibp]);

            expect(adapter.sent("setFunctionBreakpoints")[0].arguments).toEqual({ breakpoints: [{ name: "main" }] });
            expect(adapter.sent("setInstructionBreakpoints")[0].arguments).toMatchObject({
                breakpoints: [{ instructionReference: "0x1", offset: 0 }],
            });
            expect([fbp.verified, ibp.verified]).toEqual([true, true]);
        });

        it("sends the data breakpoints it could convert; the others carry their error", async () => {
            const { session, adapter } = await ready({ supportsDataBreakpoints: true });
            model.addDataBreakpoint({
                description: "x",
                src: { type: DataBreakpointSetType.Variable, dataId: "x" },
                canPersist: true,
                accessTypes: undefined,
                accessType: "write",
            });
            model.addDataBreakpoint({
                description: "y",
                src: { type: DataBreakpointSetType.Variable, dataId: "y" },
                canPersist: true,
                accessTypes: undefined,
                accessType: "write",
            });
            const [ok, broken] = model.getDataBreakpoints();
            vi.spyOn(broken, "toDAP").mockRejectedValue(new Error("gone"));
            adapter.handlers.set("setDataBreakpoints", () => ({ breakpoints: [{ verified: true }] }));

            await session.sendDataBreakpoints([ok, broken]);

            expect(adapter.sent("setDataBreakpoints")[0].arguments).toEqual({
                breakpoints: [{ dataId: "x", accessType: "write" }],
            });
            expect([ok.verified, broken.verified, broken.message]).toEqual([true, false, "gone"]);
        });

        it("ignores the answers beyond what was sent", async () => {
            const { session, adapter } = await ready({ supportsDataBreakpoints: true });
            model.addDataBreakpoint({
                description: "x",
                src: { type: DataBreakpointSetType.Variable, dataId: "x" },
                canPersist: true,
                accessTypes: undefined,
                accessType: "write",
            });
            const [dbp] = model.getDataBreakpoints();
            adapter.handlers.set("setDataBreakpoints", () => ({ breakpoints: [] }));

            await session.sendDataBreakpoints([dbp]);

            expect(session.getDebugProtocolBreakpoint(dbp.getId())).toBeUndefined();
        });

        it("a stop on a breakpoint enables the breakpoints it triggers", async () => {
            const { session, adapter } = await ready();
            const [trigger] = model.addBreakpoints(MAIN_CPP, [{ lineNumber: 5 }]);
            const [dependent] = model.addBreakpoints(MAIN_CPP, [{ lineNumber: 9, triggeredBy: trigger.getId() }]);
            model.setBreakpointSessionData(
                session.getId(),
                {},
                new Map([[trigger.getId(), { id: 41, verified: true }]]),
            );
            adapter.handlers.set("threads", () => ({ threads: [{ id: 1, name: "main" }] }));
            adapter.handlers.set("stackTrace", () => ({
                stackFrames: [{ id: 1, name: "f", source: { path: MAIN_CPP.fsPath }, line: 5, column: 1 }],
            }));

            adapter.sendEventBody("stopped", { reason: "breakpoint", threadId: 1, hitBreakpointIds: [41] });
            await vi.waitFor(() => {
                expect(debugService.sendBreakpoints).toHaveBeenCalledWith(dependent.uri, undefined, session);
            });
            expect(dependent.getSessionDidTrigger(session.getId())).toBe(true);
        });

        it("a stop on a line with a breakpoint enables what it triggers, other stops do not", async () => {
            const { session, adapter } = await ready();
            const [trigger, elsewhere] = model.addBreakpoints(MAIN_CPP, [
                { lineNumber: 5, column: 3 },
                { lineNumber: 6 },
            ]);
            const [dependent] = model.addBreakpoints(MAIN_CPP, [{ lineNumber: 9, triggeredBy: trigger.getId() }]);
            model.addBreakpoints(MAIN_CPP, [{ lineNumber: 10, triggeredBy: elsewhere.getId() }]);
            adapter.handlers.set("threads", () => ({ threads: [{ id: 1, name: "main" }] }));
            adapter.handlers.set("stackTrace", () => ({
                stackFrames: [{ id: 1, name: "f", source: { path: MAIN_CPP.fsPath }, line: 5, column: 3 }],
            }));

            adapter.sendEventBody("stopped", { reason: "step", threadId: 1 });
            await vi.waitFor(() => {
                expect(debugService.viewModel.focusedThread?.threadId).toBe(1);
            });
            expect(debugService.sendBreakpoints).not.toHaveBeenCalled();

            adapter.sendEventBody("stopped", { reason: "breakpoint", threadId: 1 });
            await vi.waitFor(() => {
                expect(debugService.sendBreakpoints).toHaveBeenCalledTimes(1);
            });
            expect(dependent.getSessionDidTrigger(session.getId())).toBe(true);
        });

        it("a breakpoint outside the stopped frame's columns triggers nothing", async () => {
            const { adapter } = await ready();
            const [trigger] = model.addBreakpoints(MAIN_CPP, [{ lineNumber: 5, column: 9 }]);
            model.addBreakpoints(MAIN_CPP, [{ lineNumber: 9, triggeredBy: trigger.getId() }]);
            adapter.handlers.set("threads", () => ({ threads: [{ id: 1, name: "main" }] }));
            adapter.handlers.set("stackTrace", () => ({
                stackFrames: [
                    { id: 1, name: "f", source: { path: MAIN_CPP.fsPath }, line: 5, column: 3, endColumn: 6 },
                ],
            }));

            adapter.sendEventBody("stopped", { reason: "breakpoint", threadId: 1 });
            await vi.waitFor(() => {
                expect(debugService.viewModel.focusedThread?.threadId).toBe(1);
            });
            await settle(0);

            expect(debugService.sendBreakpoints).not.toHaveBeenCalled();
        });
    });

    describe("sources", () => {
        it("keeps one source per uri and takes the adapter's latest attributes", () => {
            const session = newSession();

            const first = session.getSource({ path: "/a.c", presentationHint: "emphasize" });
            const again = session.getSource({ path: "/a.c", name: "a.c" });

            expect(again).toBe(first);
            expect(again.raw).toEqual({ path: "/a.c", name: "a.c", presentationHint: undefined });
            expect(session.getSourceForUri(Uri.file("/a.c"))).toBe(first);
        });

        it("a source without data is the unknown source", () => {
            const session = newSession();
            expect(session.getSource(undefined).available).toBe(false);
            expect(session.getSource(undefined)).toBe(session.getSource(undefined));
        });
    });

    describe("its own state", () => {
        it("takes its name from the configuration until it is named", () => {
            const session = newSession();
            const names: string[] = [];
            session.onDidChangeName((n) => names.push(n));

            expect([session.name, session.getLabel()]).toEqual(["Launch hello (lldb)", "Launch hello (lldb)"]);
            session.setName("renamed");

            expect([session.name, session.getLabel(), names]).toEqual(["renamed", "renamed", ["renamed"]]);
        });

        it("answers its options", () => {
            const parent = newSession();
            const plain = newSession();
            const child = newSession({
                parentSession: parent,
                compact: true,
                suppressDebugStatusbar: true,
                suppressDebugToolbar: true,
                suppressDebugView: true,
            });

            expect([
                plain.compact,
                plain.saveBeforeRestart,
                plain.suppressDebugStatusbar,
                plain.suppressDebugToolbar,
                plain.suppressDebugView,
            ]).toEqual([false, true, false, false, false]);
            expect([
                child.compact,
                child.saveBeforeRestart,
                child.suppressDebugStatusbar,
                child.suppressDebugToolbar,
                child.suppressDebugView,
            ]).toEqual([true, false, true, true, true]);
            expect(newSession({ parentSession: parent, saveBeforeRestart: true }).saveBeforeRestart).toBe(true);
            expect(plain.autoExpandLazyVariables).toBe(false);
            expect(plain.lifecycleManagedByParent).toBe(false);
        });

        it("keeps the sub id, the configuration and no capabilities without an adapter", () => {
            const session = newSession();
            session.setSubId("sub");
            const resolved = { type: "x", name: "n", request: "attach" };
            session.setConfiguration({ resolved, unresolved: undefined });

            expect(session.subId).toBe("sub");
            expect(session.configuration).toBe(resolved);
            expect(session.unresolvedConfiguration).toBeUndefined();
            expect(session.capabilities).toEqual({});
        });

        it("a child merging its console with an ended parent gets a console of its own", async () => {
            const parentAdapter = new MockDebugAdapter();
            const parent = await launch(parentAdapter);
            parent.appendToRepl({ output: "from parent\n", sev: "info" });
            const child = await launch(new MockDebugAdapter(), { parentSession: parent, repl: "mergeWithParent" });

            parentAdapter.fireExit(0);
            await vi.waitFor(() => {
                expect(child.parentSession).toBeUndefined();
            });
            child.appendToRepl({ output: "from child\n", sev: "info" });

            expect(child.getReplElements().map((e) => e.toString())).toEqual(["from parent\n", "from child\n"]);
            expect(parent.getReplElements().map((e) => e.toString())).toEqual(["from parent\n"]);
        });

        it("a REPL expression updates the views", async () => {
            const session = await launch(new MockDebugAdapter());
            const updates = vi.fn();
            debugService.viewModel.onWillUpdateViews(updates);

            await session.addReplExpression(undefined, "x");

            expect(updates).toHaveBeenCalledTimes(1);
            session.removeReplExpressions();
            expect(session.getReplElements()).toEqual([]);
        });
    });
});
