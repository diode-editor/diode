// The debug service over the synthetic adapter: the start sequence, the context keys, errors, restart and stop.

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import {
    createDebugServiceFixture,
    fakeLaunch,
    type IDebugServiceFixture,
} from "../../../../../TestUtils/debugServiceFixture.ts";
import { MockDebugAdapter, NO_RESPONSE } from "../../../../../TestUtils/mockDebugAdapter.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_DEBUG_TYPE,
    SYNTHETIC_LAUNCH_CONFIG,
    SyntheticDebugAdapter,
    type SyntheticDebugAdapterFactory,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { makeTask } from "../../../../../TestUtils/taskFixtures.ts";
import { setUnexpectedErrorHandler } from "../../../../base/common/errors.ts";
import { CancellationError } from "../../../../base/common/errorSerialization.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { DataBreakpointSetType, type IConfig, type IDebugSession, State } from "../common/debug.ts";
import type { Thread } from "../common/debugModel.ts";
import type { ViewModel } from "../common/debugViewModel.ts";

import { DebugRequestError } from "./rawDebugSession.ts";

const FOLDER = { uri: Uri.file("/work"), name: "work", index: 0 };

describe("DebugService", () => {
    let fx: IDebugServiceFixture;
    let factory: SyntheticDebugAdapterFactory;

    beforeEach(() => {
        fx = createDebugServiceFixture();
        factory = registerSyntheticDebugger(fx.service.getAdapterManager(), NO_DELAY_TIMING).factory;
    });

    afterEach(async () => {
        await fx.service.stopSession(undefined);
        for (const adapter of factory.adapters) adapter.dispose();
        fx.service.dispose();
        vi.useRealTimers();
    });

    function key(name: string): unknown {
        return fx.contextKeys.getRaw(name);
    }

    function errors(): string[] {
        return fx.shown.filter((m) => m.severity === "error").map((m) => m.message);
    }

    async function startStopped(config: IConfig = SYNTHETIC_LAUNCH_CONFIG): Promise<IDebugSession> {
        expect(await fx.service.startDebugging(undefined, { ...config })).toBe(true);
        await vi.waitFor(() => {
            expect(fx.service.state).toBe(State.Stopped);
        });
        return fx.service.getModel().getSessions().at(-1)!;
    }

    it("a debuggee in the terminal: the adapter asks the launcher and launches after its answer", async () => {
        const inTerminal = { ...SYNTHETIC_LAUNCH_CONFIG, terminal: "integrated", program: "/bin/prog" };
        await startStopped(inTerminal);

        const [adapter] = factory.adapters;
        expect(adapter.responses).toMatchObject([{ command: "runInTerminal", success: true, body: {} }]);
        expect(adapter.requests.map((r) => r.command)).toContain("launch");
    });

    /** Registers a debug type whose adapter is the given mock. */
    function registerMock(type: string, adapter: MockDebugAdapter): void {
        fx.service.getAdapterManager().registerDebugger({ type });
        fx.service.getAdapterManager().registerDebugAdapterFactory([type], {
            createDebugAdapter: () => adapter,
            substituteVariables: (_folder, config) => Promise.resolve(config),
        });
    }

    describe("context keys", () => {
        it("start inactive", () => {
            const fresh = createDebugServiceFixture();

            expect(fresh.contextKeys.getRaw("debugState")).toBe("inactive");
            expect(fresh.contextKeys.getRaw("inDebugMode")).toBe(false);
            expect(fresh.contextKeys.getRaw("hasDebugged")).toBe(false);
            expect(fresh.contextKeys.getRaw("debugUx")).toBe("default");
            expect(fresh.contextKeys.getRaw("breakpointsExist")).toBe(false);
            expect(fresh.contextKeys.getRaw("debuggersAvailable")).toBe(false);
            expect(fresh.service.state).toBe(State.Inactive);
            fresh.service.dispose();
        });

        it("a registered debugger makes debuggers available; inactive, the debug UX is simple", () => {
            expect(key("debuggersAvailable")).toBe(true);
            expect(key("debugExtensionAvailable")).toBe(true);
            expect(key("debugUx")).toBe("simple");
        });

        it("debugState goes inactive → initializing → running → stopped, and back to inactive at the end", async () => {
            const states: unknown[] = [];
            fx.service.onDidChangeState(() => states.push(key("debugState")));

            await startStopped();
            expect([key("inDebugMode"), key("hasDebugged"), key("debugType"), key("debugUx")]).toEqual([
                true,
                true,
                SYNTHETIC_DEBUG_TYPE,
                "default",
            ]);
            await fx.service.stopSession(undefined);
            await vi.waitFor(() => {
                expect(key("debugState")).toBe("inactive");
            });

            expect(states).toEqual(["initializing", "running", "stopped", "inactive"]);
            expect(key("inDebugMode")).toBe(false);
            expect(key("debugUx")).toBe("simple");
        });

        it("debugState follows the focused session even when the focused frame stays the same", async () => {
            const session = await startStopped();
            const viewModel = fx.service.getViewModel() as ViewModel;
            viewModel.setFocus(undefined, undefined, session, false);
            expect(key("debugState")).toBe("stopped");

            viewModel.setFocus(undefined, undefined, undefined, false);

            expect(key("debugState")).toBe("inactive");
        });

        it("capability keys follow the focused session", async () => {
            await startStopped();

            expect([key("restartFrameSupported"), key("terminateThreadsSupported"), key("stepBackSupported")]).toEqual([
                true,
                true,
                false,
            ]);
            expect(key("focusedSessionIsAttach")).toBe(false);
        });

        it("breakpointsExist follows the breakpoints of every kind", () => {
            const model = fx.service.getModel() as unknown as {
                addBreakpoints(uri: Uri, data: { lineNumber: number }[]): unknown[];
                addFunctionBreakpoint(opts: { name: string }): { getId(): string };
                removeBreakpoints(bps: unknown[]): void;
                removeFunctionBreakpoints(id?: string): void;
                addDataBreakpoint(opts: unknown): void;
            };

            const bps = model.addBreakpoints(Uri.file("/a.c"), [{ lineNumber: 1 }]);
            expect(key("breakpointsExist")).toBe(true);
            model.removeBreakpoints(bps);
            expect(key("breakpointsExist")).toBe(false);
            model.addFunctionBreakpoint({ name: "main" });
            expect(key("breakpointsExist")).toBe(true);
            model.removeFunctionBreakpoints();
            model.addDataBreakpoint({
                description: "x",
                src: { type: DataBreakpointSetType.Variable, dataId: "x" },
                canPersist: true,
                accessTypes: undefined,
                accessType: "write",
            });
            expect(key("breakpointsExist")).toBe(true);
        });

        it("the debug UX state is stored", async () => {
            await startStopped();
            expect(fx.state.values.get("debug.uxstate")).toBe("default");
        });
    });

    describe("start", () => {
        it("follows upstream's sequence: activation, resolution by the providers, the trackers' activation before the adapter, then the session; announced before and after the launch", async () => {
            const events: string[] = [];
            fx.service.onWillNewSession(() => events.push(`will:${String(fx.activated.length)}`));
            fx.service.onDidNewSession((s) => events.push(`did:${s.configuration.name}`));

            await startStopped();

            expect(fx.activated).toEqual([
                "onDebug",
                "<registered>",
                "onDebugResolve",
                "onDebug",
                "onDebugResolve:synthetic",
                "onDebugAdapterProtocolTracker",
                "onDebug",
                "onDebugAdapterProtocolTracker:synthetic",
            ]);
            expect(events).toEqual(["will:5", "did:Launch hello (lldb)"]);
        });

        it("talks to the adapter in DAP order", async () => {
            await startStopped();

            const commands = factory.adapters[0].requests.map((r) => r.command);
            expect(commands.slice(0, 2)).toEqual(["initialize", "launch"]);
            // The breakpoints of every kind the adapter supports, in parallel with `configurationDone` support.
            expect(new Set(commands.slice(2, 6))).toEqual(
                new Set([
                    "setFunctionBreakpoints",
                    "setDataBreakpoints",
                    "setInstructionBreakpoints",
                    "setExceptionBreakpoints",
                ]),
            );
            expect(commands.slice(6, 8)).toEqual(["configurationDone", "threads"]);
            const exceptions = factory.adapters[0].requests.find((r) => r.command === "setExceptionBreakpoints");
            expect(exceptions?.arguments).toEqual({ filters: [], filterOptions: [] });
        });

        it("sends the breakpoints of the model, then configurationDone", async () => {
            const model = fx.service.getModel() as unknown as {
                addBreakpoints(uri: Uri, data: { lineNumber: number }[]): unknown[];
            };
            model.addBreakpoints(Uri.file("/home/user/hello/src/main.cpp"), [{ lineNumber: 27 }]);

            await startStopped();

            const commands = factory.adapters[0].requests.map((r) => r.command);
            expect(commands.indexOf("setBreakpoints")).toBeLessThan(commands.indexOf("configurationDone"));
            expect(fx.service.getModel().getBreakpoints()[0].verified).toBe(true);
        });

        it("focuses the stopped thread's top frame", async () => {
            const session = await startStopped();

            await vi.waitFor(() => {
                expect(fx.service.getViewModel().focusedStackFrame?.name).toBe("accumulate(std::vector<int> const&)");
            });
            expect(fx.service.getViewModel().focusedSession).toBe(session);
            expect(fx.service.getViewModel().focusedThread?.threadId).toBe(1);
        });

        it("starts a configuration of the launch by its name, in the launch's folder", async () => {
            const launch = fakeLaunch({
                workspace: FOLDER,
                getConfiguration: (name: string) => (name === "hello" ? { ...SYNTHETIC_LAUNCH_CONFIG } : undefined),
            });

            expect(await fx.service.startDebugging(launch, "hello")).toBe(true);

            expect(fx.service.getModel().getSessions()[0].root).toBe(FOLDER);
        });

        it("a missing configuration of a launch is an error", async () => {
            const launch = fakeLaunch({ workspace: FOLDER, getConfiguration: () => undefined });

            await expect(fx.service.startDebugging(launch, "nope")).rejects.toThrow(
                "Configuration 'nope' is missing in 'launch.json'.",
            );

            expect(errors()).toEqual(["Configuration 'nope' is missing in 'launch.json'."]);
            expect(key("debugState")).toBe("inactive");
        });

        it("a name without a launch is an error", async () => {
            await expect(fx.service.startDebugging(undefined, "hello")).rejects.toThrow(
                "'launch.json' does not exist for passed workspace folder.",
            );
        });

        it("a configuration without a type starts nothing", async () => {
            expect(await fx.service.startDebugging(undefined, undefined)).toBe(false);
            expect(await fx.service.startDebugging(undefined, { name: "n", request: "launch" } as IConfig)).toBe(false);

            expect(errors()).toEqual([]);
            expect(key("debugState")).toBe("inactive");
            expect(key("hasDebugged")).toBe(true);
        });

        it.each([
            [{ type: "nope", request: "launch" }, "Configured debug type 'nope' is not supported."],
            [{ type: "nope", request: "attach" }, "Configured debug type 'nope' is not supported."],
            [
                { type: SYNTHETIC_DEBUG_TYPE, request: "run" },
                "Attribute 'request' has an unsupported value 'run' in the chosen debug configuration.",
            ],
            [{ type: SYNTHETIC_DEBUG_TYPE }, "Attribute 'request' is missing from the chosen debug configuration."],
        ])("%j is refused with a modal error", async (config, message) => {
            expect(await fx.service.startDebugging(undefined, { name: "n", ...config } as IConfig)).toBe(false);

            expect(fx.shown).toEqual([{ severity: "error", message, modal: true, items: [] }]);
            expect(fx.service.getModel().getSessions()).toEqual([]);
        });

        it("a debugger whose `when` does not hold is refused", async () => {
            fx.service.getAdapterManager().registerDebugger({ type: "gated", when: "false" });

            expect(await fx.service.startDebugging(undefined, { type: "gated", name: "n", request: "launch" })).toBe(
                false,
            );

            expect(errors()).toEqual([
                "Configured debug type 'gated' is installed but not supported in this environment.",
            ]);
        });

        it("noDebug comes from the options, or from the parent", async () => {
            await fx.service.startDebugging(undefined, { ...SYNTHETIC_LAUNCH_CONFIG }, { noDebug: true });
            const parent = fx.service.getModel().getSessions()[0];
            expect(parent.configuration.noDebug).toBe(true);
            expect(key("focusedSessionIsNoDebug")).toBe(true);

            await fx.service.startDebugging(
                undefined,
                { ...SYNTHETIC_LAUNCH_CONFIG, name: "child" },
                { parentSession: parent },
            );
            const child = fx.service
                .getModel()
                .getSessions()
                .find((s) => s.name === "child");
            expect(child?.configuration.noDebug).toBe(true);
            expect(child?.unresolvedConfiguration?.noDebug).toBe(true);

            await fx.service.startDebugging(
                undefined,
                { ...SYNTHETIC_LAUNCH_CONFIG, name: "explicit" },
                { parentSession: parent, noDebug: false },
            );
            expect(
                fx.service
                    .getModel()
                    .getSessions()
                    .find((s) => s.name === "explicit")?.configuration.noDebug,
            ).toBeUndefined();
        });

        describe("variable substitution", () => {
            type Substitute = (folder: unknown, config: IConfig) => Promise<IConfig>;
            function substituting(substitute: Substitute): Mock<Substitute> {
                const spy = vi.fn<Substitute>(substitute);
                fx.service.getAdapterManager().registerDebugger({ type: "subst" });
                fx.service.getAdapterManager().registerDebugAdapterFactory(["subst"], {
                    createDebugAdapter: () => factory.createDebugAdapter(),
                    substituteVariables: spy,
                });
                return spy;
            }

            it("goes to the debugger with the launch's folder, else the only folder of the workspace", async () => {
                const spy = substituting((_f, c) => Promise.resolve(c));
                fx.folders = [FOLDER];
                const config = { type: "subst", name: "n", request: "launch" };

                await fx.service.startDebugging(undefined, { ...config });
                const other = { uri: Uri.file("/other"), name: "other", index: 0 };
                await fx.service.startDebugging(fakeLaunch({ workspace: other, getConfiguration: () => undefined }), {
                    ...config,
                    name: "m",
                });
                fx.folders = [FOLDER, other];
                await fx.service.startDebugging(undefined, { ...config, name: "k" });

                expect(spy.mock.calls.map((c) => c[0])).toEqual([FOLDER, other, undefined]);
            });

            it("a failed substitution is an error, a cancelled one is not", async () => {
                const spy = substituting(() => Promise.reject(new Error("no such variable")));
                const config = { type: "subst", name: "n", request: "launch" };

                expect(await fx.service.startDebugging(undefined, { ...config })).toBe(false);
                spy.mockImplementation(() => Promise.reject(new CancellationError()));
                expect(await fx.service.startDebugging(undefined, { ...config })).toBe(false);

                expect(errors()).toEqual(["no such variable"]);
            });

            it("starts the substituted configuration", async () => {
                substituting((_f, c) => Promise.resolve({ ...c, name: "substituted" }));

                await fx.service.startDebugging(undefined, { type: "subst", name: "n", request: "launch" });

                const session = fx.service.getModel().getSessions()[0];
                expect(session.configuration.name).toBe("substituted");
                expect(session.unresolvedConfiguration?.name).toBe("n");
            });
        });

        describe("a second session of the same configuration", () => {
            it("asks first and starts on yes", async () => {
                await startStopped();
                fx.answer = 0;

                expect(
                    await fx.service.startDebugging(undefined, { ...SYNTHETIC_LAUNCH_CONFIG }, { startedByUser: true }),
                ).toBe(true);

                expect(fx.shown.filter((m) => m.modal)).toEqual([
                    {
                        severity: "info",
                        message: "'Launch hello (lldb)' is already running. Do you want to start another instance?",
                        modal: true,
                        items: ["Yes"],
                    },
                ]);
                expect(fx.service.getModel().getSessions()).toHaveLength(2);
                expect(key("multiSessionDebug")).toBe(true);
            });

            it("does not start when the question is closed", async () => {
                await startStopped();

                expect(
                    await fx.service.startDebugging(undefined, { ...SYNTHETIC_LAUNCH_CONFIG }, { startedByUser: true }),
                ).toBe(false);

                expect(fx.service.getModel().getSessions()).toHaveLength(1);
            });

            it.each([
                ["not started by the user", {}, {}],
                [
                    "of a configuration that suppresses the warning",
                    { startedByUser: true },
                    { suppressMultipleSessionWarning: true },
                ],
                ["of another name", { startedByUser: true }, { name: "other" }],
                ["of another request", { startedByUser: true }, { request: "attach" }],
            ])("starts without asking when %s", async (_what, options, config) => {
                await startStopped();

                expect(
                    await fx.service.startDebugging(undefined, { ...SYNTHETIC_LAUNCH_CONFIG, ...config }, options),
                ).toBe(true);

                expect(fx.shown.filter((m) => m.modal)).toEqual([]);
            });

            it("asks again when the same session appeared while the first question was open", async () => {
                const first = fx.service.startDebugging(
                    undefined,
                    { ...SYNTHETIC_LAUNCH_CONFIG },
                    { startedByUser: true },
                );
                const second = fx.service.startDebugging(
                    undefined,
                    { ...SYNTHETIC_LAUNCH_CONFIG },
                    { startedByUser: true },
                );
                await Promise.all([first, second]);

                expect(fx.shown.filter((m) => m.modal).length).toBeGreaterThanOrEqual(1);
                expect(fx.service.getModel().getSessions()).toHaveLength(1);
            });
        });

        describe("a launch that fails", () => {
            it("is shown and leaves no running state", async () => {
                const adapter = new MockDebugAdapter();
                adapter.handlers.set("launch", () => new Error("program not found"));
                registerMock("mock", adapter);

                expect(await fx.service.startDebugging(undefined, { type: "mock", name: "m", request: "launch" })).toBe(
                    false,
                );

                expect(errors()).toEqual(["program not found"]);
                expect(key("debugState")).toBe("inactive");
                adapter.dispose();
            });

            it("is not shown when the adapter says so", async () => {
                const adapter = new MockDebugAdapter();
                adapter.handlers.set("launch", () => NO_RESPONSE);
                registerMock("mock", adapter);
                const started = fx.service.startDebugging(undefined, { type: "mock", name: "m", request: "launch" });
                await vi.waitFor(() => {
                    expect(adapter.sent("launch")).toHaveLength(1);
                });
                adapter.sendErrorResponse(adapter.sent("launch")[0], "", {
                    error: { id: 1, format: "quiet", showUser: false },
                });

                expect(await started).toBe(false);
                expect(errors()).toEqual([]);
                adapter.dispose();
            });

            it("is silent when cancelled, or when it was an automatic attach", async () => {
                const adapter = new MockDebugAdapter();
                registerMock("mock", adapter);
                adapter.handlers.set("launch", () => NO_RESPONSE);
                const started = fx.service.startDebugging(undefined, { type: "mock", name: "m", request: "launch" });
                await vi.waitFor(() => {
                    expect(adapter.sent("launch")).toHaveLength(1);
                });
                adapter.sendErrorResponse({ ...adapter.sent("launch")[0], command: "canceled" }, "canceled");
                expect(await started).toBe(false);

                adapter.handlers.set("attach", () => new Error("timeout"));
                expect(
                    await fx.service.startDebugging(undefined, {
                        type: "mock",
                        name: "a",
                        request: "attach",
                        __autoAttach: true,
                    }),
                ).toBe(false);

                expect(errors()).toEqual([]);
                adapter.dispose();
            });

            it("an adapter that cannot be created is an error", async () => {
                fx.service.getAdapterManager().registerDebugger({ type: "noadapter" });

                expect(
                    await fx.service.startDebugging(undefined, { type: "noadapter", name: "n", request: "launch" }),
                ).toBe(false);

                expect(errors()).toEqual(["Cannot find debug adapter for type 'noadapter'."]);
            });
        });
    });

    describe("the end of a session", () => {
        it("a session that ends before it was ever focused still drops the data breakpoints that cannot persist", async () => {
            const adapter = new MockDebugAdapter();
            adapter.handlers.set("initialize", () => NO_RESPONSE);
            registerMock("mock", adapter);
            const model = fx.service.getModel() as unknown as { addDataBreakpoint(opts: unknown): void };
            model.addDataBreakpoint({
                description: "x",
                src: { type: DataBreakpointSetType.Variable, dataId: "x" },
                canPersist: false,
                accessTypes: undefined,
                accessType: "write",
            });
            void fx.service.startDebugging(undefined, { type: "mock", name: "m", request: "launch" });
            await vi.waitFor(() => {
                expect(fx.service.getModel().getSessions()).toHaveLength(1);
            });
            expect(fx.service.getViewModel().focusedSession).toBeUndefined();

            adapter.fireExit(0);

            await vi.waitFor(() => {
                expect(fx.service.getModel().getDataBreakpoints()).toEqual([]);
            });
            adapter.dispose();
        });

        it("reports the end, drops its exception breakpoints and the data breakpoints that cannot persist", async () => {
            const session = await startStopped();
            const model = fx.service.getModel() as unknown as {
                addDataBreakpoint(opts: unknown): void;
                getExceptionBreakpointsForSession(id: string): unknown[];
            };
            for (const canPersist of [true, false]) {
                model.addDataBreakpoint({
                    description: String(canPersist),
                    src: { type: DataBreakpointSetType.Variable, dataId: "x" },
                    canPersist,
                    accessTypes: undefined,
                    accessType: "write",
                });
            }
            expect(model.getExceptionBreakpointsForSession(session.getId())).toHaveLength(2);
            const ends: { session: IDebugSession; restart: boolean }[] = [];
            fx.service.onDidEndSession((e) => ends.push(e));

            await fx.service.stopSession(session);
            await vi.waitFor(() => {
                expect(ends).toEqual([{ session, restart: false }]);
            });

            expect(
                fx.service
                    .getModel()
                    .getDataBreakpoints()
                    .map((d) => d.description),
            ).toEqual(["true"]);
            expect(model.getExceptionBreakpointsForSession(session.getId())).toEqual([]);
            expect(fx.service.getViewModel().focusedSession).toBeUndefined();
        });

        it("a crashed adapter is reported", async () => {
            const adapter = new MockDebugAdapter();
            registerMock("mock", adapter);
            await fx.service.startDebugging(undefined, { type: "mock", name: "m", request: "launch" });
            // The adapter is gone: it cannot even be stopped (that failure goes to the unexpected errors).
            const unexpected: unknown[] = [];
            setUnexpectedErrorHandler((e) => unexpected.push(e));
            adapter.stopSession = () => Promise.reject(new Error("gone"));

            adapter.handlers.set("disconnect", () => NO_RESPONSE);
            adapter.fireError(new Error("segfault"));
            await vi.waitFor(() => {
                expect(errors()).toContain("Debug adapter process has terminated unexpectedly (segfault)");
            });
            adapter.dispose();
        });

        it("an adapter that goes away by itself ends its session with the reason in the Debug Console, not a notification", async () => {
            const adapter = new MockDebugAdapter();
            registerMock("mock", adapter);
            await fx.service.startDebugging(undefined, { type: "mock", name: "m", request: "launch" });
            const [session] = fx.service.getModel().getSessions();

            adapter.fireExit(1);
            await vi.waitFor(() => {
                expect(fx.service.getModel().getSessions()).toEqual([]);
            });

            const [last] = session.getReplElements().slice(-1);
            expect(last.toString()).toBe("Debug adapter process has terminated unexpectedly (exit code: 1)\n");
            expect((last as { severity?: unknown }).severity).toBe("error");
            expect(errors()).toEqual([]);
            adapter.dispose();
        });

        it("an adapter stopped by the session writes nothing to the Debug Console", async () => {
            const adapter = new MockDebugAdapter();
            registerMock("mock", adapter);
            await fx.service.startDebugging(undefined, { type: "mock", name: "m", request: "launch" });
            const [session] = fx.service.getModel().getSessions();
            const before = session.getReplElements().length;

            await fx.service.stopSession(session);

            expect(session.getReplElements()).toHaveLength(before);
            adapter.dispose();
        });

        it("the focus moves to another session, not explicitly; the multi-session view lasts while two run", async () => {
            const first = await startStopped();
            await fx.service.startDebugging(undefined, { ...SYNTHETIC_LAUNCH_CONFIG, name: "second" });
            await fx.service.focusStackFrame(undefined, undefined, first);
            const focusEvents: boolean[] = [];
            fx.service.getViewModel().onDidFocusStackFrame((e) => focusEvents.push(e.explicit));

            await fx.service.stopSession(first);

            await vi.waitFor(() => {
                expect(fx.service.getViewModel().focusedSession?.name).toBe("second");
            });
            expect(focusEvents.every((explicit) => !explicit)).toBe(true);
            expect(focusEvents.length).toBeGreaterThan(0);
            expect(key("multiSessionDebug")).toBe(true);
            await fx.service.stopSession(fx.service.getViewModel().focusedSession);
            await vi.waitFor(() => {
                expect(key("multiSessionDebug")).toBe(false);
            });
        });

        it("a session that is not focused ends without moving the focus", async () => {
            await startStopped();
            const second = await startStopped({ ...SYNTHETIC_LAUNCH_CONFIG, name: "second" });
            const third = await startStopped({ ...SYNTHETIC_LAUNCH_CONFIG, name: "third" });
            await fx.service.focusStackFrame(undefined, undefined, second);

            await fx.service.stopSession(third);
            await vi.waitFor(() => {
                expect(fx.service.getModel().getSessions()).toHaveLength(2);
            });

            // Refocusing would take the first stopped session.
            expect(fx.service.getViewModel().focusedSession).toBe(second);
        });
    });

    describe("stop", () => {
        it("disconnects a session when asked to", async () => {
            const session = await startStopped();

            await fx.service.stopSession(session, true);

            expect(factory.adapters[0].requests.map((r) => r.command)).not.toContain("terminate");
            expect(factory.adapters[0].requests.at(-1)?.command).toBe("disconnect");
        });

        it("without a session stops all of them", async () => {
            await startStopped();
            await fx.service.startDebugging(undefined, { ...SYNTHETIC_LAUNCH_CONFIG, name: "second" });
            await vi.waitFor(() => {
                expect(
                    fx.service
                        .getModel()
                        .getSessions()
                        .every((s) => s.state === State.Stopped),
                ).toBe(true);
            });

            await fx.service.stopSession(undefined, true);

            expect(factory.adapters.map((a) => a.requests.at(-1)?.command)).toEqual(["disconnect", "disconnect"]);
        });

        it("without sessions gets out of the initializing state", async () => {
            const adapter = new MockDebugAdapter();
            registerMock("mock", adapter);
            adapter.handlers.set("initialize", () => NO_RESPONSE);
            void fx.service.startDebugging(undefined, { type: "mock", name: "m", request: "launch" });
            await vi.waitFor(() => {
                expect(key("debugState")).toBe("initializing");
            });
            expect(fx.service.initializingOptions).toBeUndefined();

            fx.service.getModel().getSessions().length = 0;
            await fx.service.stopSession(undefined);

            expect(key("debugState")).toBe("inactive");
            adapter.dispose();
        });
    });

    describe("restart", () => {
        it("without the adapter's restart terminates and launches again", async () => {
            const session = await startStopped();
            const events: string[] = [];
            fx.service.onDidEndSession((e) => events.push(`end:${String(e.restart)}`));
            fx.service.onDidNewSession(() => events.push("new"));

            await fx.service.restartSession(session);
            await vi.waitFor(() => {
                expect(fx.service.state).toBe(State.Stopped);
            });

            expect(factory.adapters).toHaveLength(2);
            expect(factory.adapters[0].requests.map((r) => r.command)).toContain("terminate");
            expect(events).toEqual(["end:true", "new"]);
            expect(fx.service.getViewModel().focusedSession).toBe(session);
        });

        it("waits a moment before launching again", async () => {
            const session = await startStopped();
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

            const restarted = fx.service.restartSession(session);
            await vi.advanceTimersByTimeAsync(299);
            expect(factory.adapters).toHaveLength(1);
            await vi.advanceTimersByTimeAsync(10);
            // The new session's start answers on timers too: let them run before the real clock comes back.
            await vi.advanceTimersByTimeAsync(100);
            vi.useRealTimers();
            await restarted;

            expect(factory.adapters).toHaveLength(2);
        });

        it("an automatic restart disconnects instead of terminating", async () => {
            const session = await startStopped();

            await fx.service.restartSession(session, { port: 1 });

            expect(factory.adapters[0].requests.map((r) => r.command)).not.toContain("terminate");
            expect(session.configuration.__restart).toEqual({ port: 1 });
        });

        it("asks the adapter to restart when it can", async () => {
            const adapter = new MockDebugAdapter();
            adapter.handlers.set("initialize", () => ({ supportsRestartRequest: true }));
            registerMock("mock", adapter);
            await fx.service.startDebugging(undefined, { type: "mock", name: "m", request: "launch" });
            const session = fx.service.getModel().getSessions()[0];

            await fx.service.restartSession(session);

            expect(adapter.sent("restart")).toHaveLength(1);
            expect(adapter.sent("terminate")).toEqual([]);
            adapter.dispose();
        });

        it("a failing preLaunchTask keeps the adapter from restarting", async () => {
            const adapter = new MockDebugAdapter();
            adapter.handlers.set("initialize", () => ({ supportsRestartRequest: true }));
            registerMock("mock", adapter);
            fx.tasks = [makeTask({ label: "pre" })];
            await fx.service.startDebugging(undefined, {
                type: "mock",
                name: "m",
                request: "launch",
                preLaunchTask: "pre",
            });
            const session = fx.service.getModel().getSessions()[0];
            fx.ran.length = 0;
            fx.taskExitCode = 1;
            fx.answer = 2;

            await fx.service.restartSession(session);

            expect(fx.ran).toEqual(["pre"]);
            expect(adapter.sent("restart")).toEqual([]);
            adapter.dispose();
        });

        it("a session started without saveBeforeRestart restarts without saving", async () => {
            expect(
                await fx.service.startDebugging(
                    undefined,
                    { ...SYNTHETIC_LAUNCH_CONFIG },
                    { saveBeforeRestart: false },
                ),
            ).toBe(true);
            await vi.waitFor(() => {
                expect(fx.service.state).toBe(State.Stopped);
            });
            const saves = fx.saves.length;

            await fx.service.restartSession(fx.service.getModel().getSessions()[0]);

            expect(fx.saves).toHaveLength(saves);
        });

        it("a failed restart is a final end", async () => {
            const adapter = new MockDebugAdapter();
            adapter.handlers.set("initialize", () => ({ supportsRestartRequest: true }));
            registerMock("mock", adapter);
            await fx.service.startDebugging(undefined, { type: "mock", name: "m", request: "launch" });
            const session = fx.service.getModel().getSessions()[0];
            adapter.handlers.set("restart", () => new Error("cannot"));
            const ends: boolean[] = [];
            fx.service.onDidEndSession((e) => ends.push(e.restart));

            await expect(fx.service.restartSession(session)).rejects.toBeInstanceOf(DebugRequestError);

            expect(ends).toEqual([false]);
            adapter.dispose();
        });

        it("resets the triggered breakpoints of the session", async () => {
            const session = await startStopped();
            const model = fx.service.getModel() as unknown as {
                addBreakpoints(
                    uri: Uri,
                    data: { lineNumber: number; triggeredBy?: string }[],
                ): {
                    getId(): string;
                    setSessionDidTrigger(id: string, v?: boolean): void;
                    getSessionDidTrigger(id: string): boolean;
                }[];
            };
            const [trigger] = model.addBreakpoints(Uri.file("/a.c"), [{ lineNumber: 1 }]);
            const [dependent] = model.addBreakpoints(Uri.file("/a.c"), [
                { lineNumber: 2, triggeredBy: trigger.getId() },
            ]);
            dependent.setSessionDidTrigger(session.getId());

            await fx.service.restartSession(session, { auto: true });

            expect(dependent.getSessionDidTrigger(session.getId())).toBe(false);
        });
    });

    describe("focus", () => {
        it("sets debugType from the focused session and resets it without one", async () => {
            const session = await startStopped();
            expect(key("debugType")).toBe(SYNTHETIC_DEBUG_TYPE);

            await fx.service.focusStackFrame(undefined, undefined, undefined);
            expect(fx.service.getViewModel().focusedSession).toBe(session);

            await session.terminate();
            await vi.waitFor(() => {
                expect(fx.service.getModel().getSessions()).toEqual([]);
            });
            await fx.service.focusStackFrame(undefined);
            expect(key("debugType")).toBeUndefined();
        });

        it("a focused session becomes the fallback of the exception breakpoints", async () => {
            const session = await startStopped();

            expect(
                fx.service
                    .getModel()
                    .getExceptionBreakpointsForSession(undefined)
                    .map((e) => e.filter),
            ).toEqual(["cpp_throw", "cpp_catch"]);
            expect(fx.state.values.has("debug.exceptionbreakpoint")).toBe(true);
            expect(session.getId()).toBeTruthy();
        });

        it("a running focused session loses its stack frame a moment later", async () => {
            const slow = new SyntheticDebugAdapter({ ...NO_DELAY_TIMING, continueMs: 60_000 });
            fx.service.getAdapterManager().registerDebugger({ type: "slow" });
            fx.service.getAdapterManager().registerDebugAdapterFactory(["slow"], {
                createDebugAdapter: () => slow,
                substituteVariables: (_folder, config) => Promise.resolve(config),
            });
            const session = await startStopped({ ...SYNTHETIC_LAUNCH_CONFIG, type: "slow" });
            await vi.waitFor(() => {
                expect(fx.service.getViewModel().focusedStackFrame).toBeDefined();
            });
            const main = session.getThread(1) as Thread;
            await main.continue();
            expect(fx.service.getViewModel().focusedStackFrame).toBeDefined();

            await vi.waitFor(() => {
                expect(fx.service.getViewModel().focusedStackFrame).toBeUndefined();
            });
        });
    });

    describe("breakpoints", () => {
        async function withMock(
            capabilities: DebugProtocol.Capabilities,
            config: Partial<IConfig> = {},
        ): Promise<MockDebugAdapter> {
            const adapter = new MockDebugAdapter();
            adapter.handlers.set("initialize", () => {
                setTimeout(() => {
                    adapter.sendEventBody("initialized");
                }, 0);
                return capabilities;
            });
            const verifiedAll = (args: unknown): unknown => ({
                breakpoints: ((args as { breakpoints?: unknown[] }).breakpoints ?? []).map(() => ({ verified: true })),
            });
            for (const command of [
                "setBreakpoints",
                "setFunctionBreakpoints",
                "setDataBreakpoints",
                "setInstructionBreakpoints",
            ]) {
                adapter.handlers.set(command, verifiedAll);
            }
            registerMock("mock", adapter);
            await fx.service.startDebugging(undefined, { type: "mock", name: "m", request: "launch", ...config });
            await vi.waitFor(() => {
                expect(adapter.sent("threads").length).toBeGreaterThan(0);
            });
            return adapter;
        }

        function addAll(): void {
            const model = fx.service.getModel() as unknown as {
                addBreakpoints(uri: Uri, data: { lineNumber: number; enabled?: boolean }[]): unknown[];
                addFunctionBreakpoint(opts: { name: string }): unknown;
                addDataBreakpoint(opts: unknown): void;
                addInstructionBreakpoint(opts: unknown): void;
            };
            model.addBreakpoints(Uri.file("/a.c"), [{ lineNumber: 1 }, { lineNumber: 2, enabled: false }]);
            model.addBreakpoints(Uri.file("/b.c"), [{ lineNumber: 3 }]);
            model.addFunctionBreakpoint({ name: "main" });
            model.addDataBreakpoint({
                description: "x",
                src: { type: DataBreakpointSetType.Variable, dataId: "x" },
                canPersist: true,
                accessTypes: undefined,
                accessType: "write",
            });
            model.addInstructionBreakpoint({ instructionReference: "0x1", offset: 0, address: 1n, canPersist: false });
        }

        it("sends every kind the adapter supports, the enabled ones, per source", async () => {
            addAll();
            const adapter = await withMock({
                supportsConfigurationDoneRequest: true,
                supportsFunctionBreakpoints: true,
                supportsDataBreakpoints: true,
                supportsInstructionBreakpoints: true,
                exceptionBreakpointFilters: [{ filter: "all", label: "All" }],
            });

            expect(
                adapter.sent("setBreakpoints").map((r) => (r.arguments as DebugProtocol.SetBreakpointsArguments).lines),
            ).toEqual([[1], [3]]);
            expect(adapter.sent("setFunctionBreakpoints")).toHaveLength(1);
            expect(adapter.sent("setDataBreakpoints")).toHaveLength(1);
            expect(adapter.sent("setInstructionBreakpoints")).toHaveLength(1);
            expect(adapter.sent("setExceptionBreakpoints")).toHaveLength(1);
        });

        it("sends only what the adapter supports; exception filters last without configurationDone", async () => {
            addAll();
            const adapter = await withMock({});

            const commands = adapter.requests.map((r) => r.command).filter((c) => c.startsWith("set"));
            expect(commands).toEqual(["setBreakpoints", "setBreakpoints", "setExceptionBreakpoints"]);
        });

        it("sends no breakpoints of a deactivated model but the source ones, as upstream", async () => {
            addAll();
            (fx.service.getModel() as unknown as { setBreakpointsActivated(v: boolean): void }).setBreakpointsActivated(
                false,
            );
            const adapter = await withMock({
                supportsFunctionBreakpoints: true,
                supportsDataBreakpoints: true,
                supportsInstructionBreakpoints: true,
            });

            expect(adapter.sent("setFunctionBreakpoints")[0].arguments).toEqual({ breakpoints: [] });
            expect(adapter.sent("setDataBreakpoints")[0].arguments).toEqual({ breakpoints: [] });
            expect(adapter.sent("setInstructionBreakpoints")[0].arguments).toEqual({ breakpoints: [] });
        });

        it("sends none to a session run without debugging", async () => {
            addAll();
            const adapter = await withMock(
                {
                    supportsFunctionBreakpoints: true,
                    supportsDataBreakpoints: true,
                    supportsInstructionBreakpoints: true,
                },
                { noDebug: true },
            );

            expect(adapter.requests.map((r) => r.command).filter((c) => c.startsWith("set"))).toEqual([]);
        });

        it("sends a source's breakpoints to every session, triggered ones only where they triggered", async () => {
            const adapter = await withMock({});
            const model = fx.service.getModel() as unknown as {
                addBreakpoints(
                    uri: Uri,
                    data: { lineNumber: number; triggeredBy?: string }[],
                ): { getId(): string; setSessionDidTrigger(id: string): void }[];
            };
            const [trigger] = model.addBreakpoints(Uri.file("/a.c"), [{ lineNumber: 1 }]);
            const [dependent] = model.addBreakpoints(Uri.file("/a.c"), [
                { lineNumber: 5, triggeredBy: trigger.getId() },
            ]);

            await fx.service.sendBreakpoints(Uri.file("/a.c"));
            dependent.setSessionDidTrigger(fx.service.getModel().getSessions()[0].getId());
            await fx.service.sendBreakpoints(Uri.file("/a.c"), true);

            expect(
                adapter
                    .sent("setBreakpoints")
                    .slice(-2)
                    .map((r) => (r.arguments as DebugProtocol.SetBreakpointsArguments).lines),
            ).toEqual([[1], [1, 5]]);
            expect(adapter.sent("setBreakpoints").at(-1)?.arguments).toMatchObject({ sourceModified: true });
        });
    });
});
