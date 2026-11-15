// The details of the debug service the coarser tests let through: focus and state of several sessions, the debug
// UX key, which session a request or a restart touches, and which breakpoints go out.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    createDebugServiceFixture,
    fakeLaunch,
    type IDebugServiceFixture,
} from "../../../../../TestUtils/debugServiceFixture.ts";
import { MockDebugAdapter, NO_RESPONSE } from "../../../../../TestUtils/mockDebugAdapter.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { type IConfig, type IDebugSession, State } from "../common/debug.ts";
import type { DebugModel, StackFrame, Thread } from "../common/debugModel.ts";
import type { ViewModel } from "../common/debugViewModel.ts";

import { getStackFrameThreadAndSessionToFocus } from "./debugService.ts";

const FILE = Uri.file("/src/a.c");

describe("DebugService details", () => {
    let fx: IDebugServiceFixture;
    const mocks: MockDebugAdapter[] = [];
    /** How the next mock adapter is set up. */
    let setup: (adapter: MockDebugAdapter) => void;

    beforeEach(() => {
        fx = createDebugServiceFixture();
        setup = () => undefined;
        fx.service.getAdapterManager().registerDebugger({ type: "mock" });
        fx.service.getAdapterManager().registerDebugAdapterFactory(["mock"], {
            createDebugAdapter: (session) => {
                const adapter = new MockDebugAdapter();
                adapters.set(session, adapter);
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
                setup(adapter);
                mocks.push(adapter);
                return adapter;
            },
            substituteVariables: (_folder, config) => Promise.resolve(config),
        });
    });

    afterEach(async () => {
        vi.useRealTimers();
        await fx.service.stopSession(undefined);
        mocks.splice(0).forEach((a) => {
            a.dispose();
        });
        fx.service.dispose();
        vi.useRealTimers();
    });

    const viewModel = (): ViewModel => fx.service.getViewModel() as ViewModel;
    const model = (): DebugModel => fx.service.getModel() as DebugModel;
    const key = (name: string): unknown => fx.contextKeys.getRaw(name);

    async function start(
        config: Partial<IConfig> = {},
        options?: Parameters<typeof fx.service.startDebugging>[2],
    ): Promise<IDebugSession> {
        const before = new Set(model().getSessions(true));
        await fx.service.startDebugging(undefined, { type: "mock", name: "m", request: "launch", ...config }, options);
        return model()
            .getSessions(true)
            .find((s) => !before.has(s))!;
    }

    async function stopped(session: IDebugSession, threadId = 1): Promise<void> {
        const adapter = adapterOf(session);
        adapter.sendEventBody("stopped", { reason: "pause", threadId });
        await vi.waitFor(() => {
            expect(session.getThread(threadId)?.stopped).toBe(true);
            expect((session.getThread(threadId) as Thread).getCallStack().length).toBeGreaterThan(0);
        });
    }

    const adapters = new Map<IDebugSession, MockDebugAdapter>();

    function adapterOf(session: IDebugSession): MockDebugAdapter {
        return adapters.get(session)!;
    }

    describe("state and focus", () => {
        it("focusing a running thread of the focused session makes the state running", async () => {
            const session = await start();
            await stopped(session);
            await vi.waitFor(() => {
                expect(key("debugState")).toBe("stopped");
            });

            viewModel().setFocus(undefined, session.getThread(2), session, false);

            expect(key("debugState")).toBe("running");
        });

        it("a session that is not focused changes no debug state", async () => {
            const focused = await start();
            await stopped(focused);
            const other = await start({ name: "other" });
            expect(viewModel().focusedSession).toBe(focused);

            await stopped(other);
            adapterOf(other).sendEventBody("continued", { threadId: 1 });
            await settle(10);

            expect(key("debugState")).toBe("stopped");
        });

        it("a focused session that runs keeps its frame if it stops again within 200 ms, and loses it otherwise", async () => {
            const session = await start();
            await stopped(session);
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            const focusEvents: boolean[] = [];
            viewModel().onDidFocusStackFrame((e) => focusEvents.push(e.explicit));

            adapterOf(session).sendEventBody("continued", { threadId: 1 });
            await vi.advanceTimersByTimeAsync(250);

            expect(viewModel().focusedStackFrame).toBeUndefined();
            expect(viewModel().focusedSession).toBe(session);
            expect(focusEvents).toEqual([false]);
        });

        it("an unfocused session that runs leaves the focus alone", async () => {
            const focused = await start();
            await stopped(focused);
            const other = await start({ name: "other" });
            await stopped(other);
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            const frame = viewModel().focusedStackFrame;

            adapterOf(other).sendEventBody("continued", { threadId: 1 });
            await vi.advanceTimersByTimeAsync(250);

            expect(viewModel().focusedStackFrame).toBe(frame);
        });

        it("explicit focus is reported as explicit, the default is not", async () => {
            const session = await start();
            await stopped(session);
            const explicit: boolean[] = [];
            viewModel().onDidFocusStackFrame((e) => explicit.push(e.explicit));

            await fx.service.focusStackFrame(undefined, undefined, undefined);
            await fx.service.focusStackFrame(undefined, session.getThread(2), session, { explicit: true });

            expect(explicit).toEqual([true]);
        });

        it("a second session does not take the focus; a compact child of the focused one does", async () => {
            const first = await start();
            await start({ name: "second" });
            expect(viewModel().focusedSession).toBe(first);

            const child = await start({ name: "child" }, { parentSession: first, compact: true });

            expect(viewModel().focusedSession).toBe(child);
        });

        it("a compact child of a session that is not focused does not take the focus", async () => {
            const first = await start();
            const second = await start({ name: "second" });

            await start({ name: "child" }, { parentSession: second, compact: true });

            expect(viewModel().focusedSession).toBe(first);
        });

        it("a child that is not compact does not take the focus", async () => {
            const first = await start();

            await start({ name: "child" }, { parentSession: first });

            expect(viewModel().focusedSession).toBe(first);
        });

        it("a failed launch of a session that is not focused leaves the focus where it is", async () => {
            const first = await start();
            setup = (adapter) => adapter.handlers.set("launch", () => new Error("no"));

            await start({ name: "broken" });

            expect(viewModel().focusedSession).toBe(first);
        });

        it("the end of a session that is not focused leaves the focus where it is", async () => {
            const first = await start();
            const second = await start({ name: "second" });
            const focusEvents = vi.fn();
            viewModel().onDidFocusSession(focusEvents);

            await fx.service.stopSession(second);
            await vi.waitFor(() => {
                expect(model().getSessions()).toEqual([first]);
            });

            expect(focusEvents).not.toHaveBeenCalled();
        });

        it("the focus after the end of the focused session is not explicit", async () => {
            const first = await start();
            await start({ name: "second" });
            const explicit: boolean[] = [];
            viewModel().onDidFocusStackFrame((e) => explicit.push(e.explicit));
            const session = vi.fn();
            viewModel().onDidFocusSession(session);

            await fx.service.stopSession(first);
            await vi.waitFor(() => {
                expect(session).toHaveBeenCalled();
            });

            expect(explicit.every((e) => !e)).toBe(true);
        });

        it("one session is no multi-session view; it ends with the last session", async () => {
            const first = await start();
            expect(key("multiSessionDebug")).toBe(false);
            await start({ name: "child" }, { parentSession: first });
            expect(key("multiSessionDebug")).toBe(false);
            await start({ name: "second" });
            expect(key("multiSessionDebug")).toBe(true);

            await fx.service.stopSession(undefined);
            await vi.waitFor(() => {
                expect(model().getSessions()).toEqual([]);
            });

            expect(key("multiSessionDebug")).toBe(false);
        });

        it("the end of one session leaves the others' end handled", async () => {
            const first = await start();
            const second = await start({ name: "second" });
            const ends: IDebugSession[] = [];
            fx.service.onDidEndSession((e) => ends.push(e.session));

            await fx.service.stopSession(first);
            await vi.waitFor(() => {
                expect(ends).toEqual([first]);
            });
            await fx.service.stopSession(second);

            await vi.waitFor(() => {
                expect(ends).toEqual([first, second]);
            });
        });
    });

    describe("starting", () => {
        it("keeps the first start's options while starting", async () => {
            setup = (adapter) => adapter.handlers.set("initialize", () => NO_RESPONSE);
            void start({}, { noDebug: true });
            void start({ name: "second" }, { noDebug: false });
            await vi.waitFor(() => {
                expect(mocks).toHaveLength(2);
            });

            expect(fx.service.initializingOptions).toEqual({ noDebug: true });
            expect(fx.service.state).toBe(State.Initializing);
        });

        it("the debug UX is simple while initializing and default once running", async () => {
            setup = (adapter) => adapter.handlers.set("initialize", () => NO_RESPONSE);
            void start();
            await vi.waitFor(() => {
                expect(mocks[0]?.sent("initialize")).toHaveLength(1);
            });

            expect(key("debugState")).toBe("initializing");
            expect(key("debugUx")).toBe("simple");
            mocks[0].sendResponseBody(mocks[0].sent("initialize")[0], {});
            await vi.waitFor(() => {
                expect(key("debugUx")).toBe("default");
            });
        });

        it("writes the debug UX only when it changes", async () => {
            const store = vi.spyOn(fx.state, "store");
            await start();
            const writes = store.mock.calls.filter((c) => c[0].key === "debug.uxstate").length;

            fx.service.getAdapterManager().registerDebugger({ type: "another" });

            expect(store.mock.calls.filter((c) => c[0].key === "debug.uxstate")).toHaveLength(writes);
        });

        it("an adapter that exits while initializing ends the initializing state", async () => {
            setup = (adapter) => adapter.handlers.set("initialize", () => NO_RESPONSE);
            void start();
            await vi.waitFor(() => {
                expect(mocks).toHaveLength(1);
            });

            mocks[0].fireExit(0);

            await vi.waitFor(() => {
                expect(key("debugState")).toBe("inactive");
            });
        });

        it("an automatic attach of `launch` that fails is shown", async () => {
            setup = (adapter) => adapter.handlers.set("launch", () => new Error("timeout"));

            await start({ __autoAttach: true });

            expect(fx.shown.map((m) => m.message)).toEqual(["timeout"]);
        });

        it.each([
            ["another type", { type: "mock2" }],
            ["another root", {}],
        ])("a session of %s is no second instance", async (what, config) => {
            fx.service.getAdapterManager().registerDebugger({ type: "mock2" });
            fx.service.getAdapterManager().registerDebugAdapterFactory(["mock2"], {
                createDebugAdapter: () => {
                    const adapter = new MockDebugAdapter();
                    mocks.push(adapter);
                    return adapter;
                },
                substituteVariables: (_folder, c) => Promise.resolve(c),
            });
            await start();
            const launch =
                what === "another root"
                    ? fakeLaunch({
                          workspace: { uri: Uri.file("/w"), name: "w", index: 0 },
                          getConfiguration: () => undefined,
                      })
                    : undefined;

            await fx.service.startDebugging(
                launch,
                { type: "mock", name: "m", request: "launch", ...config },
                { startedByUser: true },
            );

            expect(fx.shown.filter((m) => m.modal)).toEqual([]);
        });

        it("stopping all while another session runs lets a start in progress go on", async () => {
            await start();
            let substituted: () => void = () => undefined;
            fx.service.getAdapterManager().registerDebugger({ type: "slow" });
            fx.service.getAdapterManager().registerDebugAdapterFactory(["slow"], {
                createDebugAdapter: () => {
                    const adapter = new MockDebugAdapter();
                    mocks.push(adapter);
                    return adapter;
                },
                substituteVariables: (_folder, config) =>
                    new Promise((resolve) => {
                        substituted = () => {
                            resolve(config);
                        };
                    }),
            });
            const slow = fx.service.startDebugging(undefined, { type: "slow", name: "s", request: "launch" });
            await settle(5);

            await fx.service.stopSession(undefined);
            substituted();

            expect(await slow).toBe(true);
        });
    });

    describe("ending", () => {
        it("a session whose start failed ends when it is stopped", async () => {
            setup = (adapter) => adapter.handlers.set("initialize", () => new Error("no"));
            const session = await start();
            const ends = vi.fn();
            fx.service.onDidEndSession(ends);

            await fx.service.stopSession(session);

            expect(ends).toHaveBeenCalledWith({ session, restart: false });
        });

        it("a session that ends after a restart ends for good", async () => {
            const session = await start();
            await fx.service.restartSession(session);
            const ends: boolean[] = [];
            fx.service.onDidEndSession((e) => ends.push(e.restart));

            await fx.service.stopSession(session);

            await vi.waitFor(() => {
                expect(ends).toEqual([false]);
            });
        });
    });

    describe("restart", () => {
        it("the adapter's restart ends nothing", async () => {
            setup = (adapter) => adapter.handlers.set("initialize", () => ({ supportsRestartRequest: true }));
            const session = await start();
            const ends = vi.fn();
            fx.service.onDidEndSession(ends);

            await fx.service.restartSession(session);

            expect(ends).not.toHaveBeenCalled();
        });

        it("terminates with restart, or disconnects with restart when automatic", async () => {
            setup = (adapter) =>
                adapter.handlers.set("initialize", () => ({
                    supportsTerminateRequest: true,
                    supportTerminateDebuggee: true,
                }));
            const session = await start();

            await fx.service.restartSession(session);
            expect(mocks[0].sent("terminate")[0].arguments as unknown).toEqual({ restart: true });

            await fx.service.restartSession(session, { auto: 1 });
            expect(mocks[1].sent("disconnect")[0].arguments as unknown).toEqual({
                restart: true,
                terminateDebuggee: false,
            });
        });

        it("a restarted session that was not focused does not take the focus", async () => {
            const first = await start();
            const second = await start({ name: "second" });

            await fx.service.restartSession(second);

            expect(viewModel().focusedSession).toBe(first);
        });
    });

    describe("stop", () => {
        it("stops a session by terminating, and disconnects without suspending by default", async () => {
            setup = (adapter) =>
                adapter.handlers.set("initialize", () => ({
                    supportsTerminateRequest: true,
                    supportTerminateDebuggee: true,
                    supportSuspendDebuggee: true,
                }));
            const first = await start();
            const second = await start({ name: "second" });

            await fx.service.stopSession(first);
            await fx.service.stopSession(second, true);

            expect(mocks[0].sent("terminate")).toHaveLength(1);
            expect(mocks[1].sent("disconnect")[0].arguments as unknown).toEqual({
                restart: false,
                terminateDebuggee: false,
                suspendDebuggee: false,
            });
        });
    });

    describe("breakpoints", () => {
        function initialized(adapter: MockDebugAdapter): void {
            adapter.handlers.set("initialize", () => {
                setTimeout(() => {
                    adapter.sendEventBody("initialized");
                }, 0);
                return adapter === mocks.at(-1) ? capabilities : capabilities;
            });
            for (const command of [
                "setBreakpoints",
                "setFunctionBreakpoints",
                "setDataBreakpoints",
                "setInstructionBreakpoints",
            ]) {
                adapter.handlers.set(command, (args) => ({
                    breakpoints: ((args as { breakpoints?: unknown[] }).breakpoints ?? []).map(() => ({
                        verified: true,
                    })),
                }));
            }
        }
        let capabilities: DebugProtocol.Capabilities = {};

        async function startReady(caps: DebugProtocol.Capabilities = {}, name = "m"): Promise<IDebugSession> {
            capabilities = caps;
            setup = initialized;
            const session = await start({ name });
            await vi.waitFor(() => {
                expect(adapterOf(session).sent("threads").length).toBeGreaterThan(0);
            });
            return session;
        }

        it("the exception breakpoints of a session are stored", async () => {
            const session = await startReady({ exceptionBreakpointFilters: [{ filter: "f", label: "F" }] });
            fx.state.values.clear();

            fx.service.setExceptionBreakpointsForSession(session, [{ filter: "g", label: "G" }]);

            expect(fx.state.values.has("debug.exceptionbreakpoint")).toBe(true);
        });

        it("focusing another session stores its exception breakpoints as the fallback", async () => {
            const filters = { exceptionBreakpointFilters: [{ filter: "f", label: "F" }] };
            await startReady(filters);
            const second = await startReady(filters, "second");
            fx.state.values.clear();

            await fx.service.focusStackFrame(undefined, undefined, second);

            expect(fx.state.values.has("debug.exceptionbreakpoint")).toBe(true);
        });

        it("sends only the enabled breakpoints, not to a session that does not support them", async () => {
            const fbp = model().addFunctionBreakpoint({ name: "on" });
            const off = model().addFunctionBreakpoint({ name: "off" });
            model().setEnablement(off, false);
            model().setExceptionBreakpointsForSession("none", []);
            const session = await startReady({
                supportsFunctionBreakpoints: true,
                exceptionBreakpointFilters: [
                    { filter: "a", label: "A" },
                    { filter: "b", label: "B" },
                ],
            });
            model().setEnablement(model().getExceptionBreakpointsForSession(session.getId())[1], true);

            await fx.service.sendAllBreakpoints(session);

            expect(adapterOf(session).sent("setFunctionBreakpoints").at(-1)?.arguments as unknown).toEqual({
                breakpoints: [{ name: "on" }],
            });
            expect(adapterOf(session).sent("setExceptionBreakpoints").at(-1)?.arguments as unknown).toEqual({
                filters: ["b"],
            });
            expect(fbp.enabled).toBe(true);
        });

        it.each([
            ["data", "setDataBreakpoints", "supportsDataBreakpoints"],
            ["instruction", "setInstructionBreakpoints", "supportsInstructionBreakpoints"],
        ] as const)("disabled %s breakpoints are not sent", async (kind, command, capability) => {
            if (kind === "data") {
                model().addDataBreakpoint({
                    description: "x",
                    src: { type: 0, dataId: "x" },
                    canPersist: true,
                    accessTypes: undefined,
                    accessType: "write",
                });
                model().setEnablement(model().getDataBreakpoints()[0], false);
            } else {
                model().addInstructionBreakpoint({
                    instructionReference: "0x1",
                    offset: 0,
                    address: 1n,
                    canPersist: false,
                });
                model().setEnablement(model().getInstructionBreakpoints()[0], false);
            }

            const session = await startReady({ [capability]: true });

            expect(adapterOf(session).sent(command)[0].arguments as unknown).toEqual({ breakpoints: [] });
        });

        it("no exception filters go to an adapter that has an empty list of them and configurationDone", async () => {
            const session = await startReady({
                supportsConfigurationDoneRequest: true,
                exceptionBreakpointFilters: [],
            });

            expect(adapterOf(session).sent("setExceptionBreakpoints")).toEqual([]);
        });

        it("sends to the given session only, with the source not modified by default", async () => {
            model().addBreakpoints(FILE, [{ lineNumber: 1 }]);
            const first = await startReady();
            const second = await startReady({}, "second");
            const before = adapterOf(second).sent("setBreakpoints").length;

            await fx.service.sendAllBreakpoints(first);
            await fx.service.sendBreakpoints(FILE);

            expect(adapterOf(first).sent("setBreakpoints").at(-1)?.arguments as unknown).toMatchObject({
                sourceModified: false,
            });
            expect(adapterOf(first).sent("setBreakpoints").at(-2)?.arguments as unknown).toMatchObject({
                sourceModified: false,
            });
            expect(adapterOf(second).sent("setBreakpoints")).toHaveLength(before + 1);
        });

        it("without configurationDone the kinds go out one after another; with it all at once", async () => {
            model().addBreakpoints(FILE, [{ lineNumber: 1 }]);
            model().addFunctionBreakpoint({ name: "f" });
            const sequential = await startReady({ supportsFunctionBreakpoints: true });
            const parallel = await startReady(
                { supportsFunctionBreakpoints: true, supportsConfigurationDoneRequest: true },
                "p",
            );
            for (const session of [sequential, parallel]) {
                adapterOf(session).handlers.set("setBreakpoints", () => NO_RESPONSE);
            }
            const sent = (session: IDebugSession): number => adapterOf(session).sent("setFunctionBreakpoints").length;
            const before = [sent(sequential), sent(parallel)];

            void fx.service.sendAllBreakpoints(sequential);
            void fx.service.sendAllBreakpoints(parallel);
            await settle(10);

            expect([sent(sequential) - before[0], sent(parallel) - before[1]]).toEqual([0, 1]);
        });
    });

    describe("what to focus", () => {
        it("upstream's choice of stack frame, thread and session", async () => {
            const running = await start({ name: "running" });
            const session = await start({ name: "stopped" });
            await stopped(session);
            const thread = session.getThread(1) as Thread;
            const runningThread = session.getThread(2);

            expect(getStackFrameThreadAndSessionToFocus(model(), undefined)).toEqual({
                stackFrame: thread.getTopStackFrame(),
                thread,
                session,
            });
            expect(getStackFrameThreadAndSessionToFocus(model(), undefined, undefined, running)).toEqual({
                stackFrame: undefined,
                thread: running.getAllThreads().at(0),
                session: running,
            });
            expect(getStackFrameThreadAndSessionToFocus(model(), undefined, runningThread)).toEqual({
                stackFrame: undefined,
                thread: runningThread,
                session,
            });
            const frame = thread.getCallStack()[0] as StackFrame;
            expect(getStackFrameThreadAndSessionToFocus(model(), frame)).toEqual({
                stackFrame: frame,
                thread,
                session,
            });
        });

        it("without a stopped session: the first that is not the one going away, nor its parent", async () => {
            const parent = await start({ name: "parent" });
            const child = await start({ name: "child" }, { parentSession: parent });
            const other = await start({ name: "other" });

            expect(getStackFrameThreadAndSessionToFocus(model(), undefined, undefined, undefined, child).session).toBe(
                other,
            );
            expect(getStackFrameThreadAndSessionToFocus(model(), undefined, undefined, undefined, other).session).toBe(
                parent,
            );
            expect(getStackFrameThreadAndSessionToFocus(model(), undefined, undefined, undefined).session).toBe(parent);
        });

        it("only the session going away: still it, and nothing without sessions", async () => {
            const only = await start();

            expect(getStackFrameThreadAndSessionToFocus(model(), undefined, undefined, undefined, only).session).toBe(
                only,
            );
            await fx.service.stopSession(only);
            await vi.waitFor(() => {
                expect(model().getSessions()).toEqual([]);
            });
            expect(getStackFrameThreadAndSessionToFocus(model(), undefined)).toEqual({
                stackFrame: undefined,
                thread: undefined,
                session: undefined,
            });
        });

        it("a stopped thread over the first one", async () => {
            const session = await start();
            await stopped(session, 2);

            expect(getStackFrameThreadAndSessionToFocus(model(), undefined, undefined, session).thread).toBe(
                session.getThread(2),
            );
        });
    });

    it("after dispose the model changes no context key", () => {
        fx.service.dispose();

        model().addBreakpoints(FILE, [{ lineNumber: 1 }]);

        expect(key("breakpointsExist")).toBe(false);
    });

    it("an important message is a notification without buttons", async () => {
        const session = await start();

        adapterOf(session).sendEventBody("output", { category: "important", output: "x" });

        await vi.waitFor(() => {
            expect(fx.shown).toEqual([{ severity: "info", message: "m: x", modal: false, items: [] }]);
        });
    });
});
