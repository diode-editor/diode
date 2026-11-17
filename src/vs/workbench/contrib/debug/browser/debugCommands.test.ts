// The session commands on the debug service: which thread, frame or session they act on, the call stack
// navigation, and what they start.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugServiceFixture, type IDebugServiceFixture } from "../../../../../TestUtils/debugServiceFixture.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_LAUNCH_CONFIG,
    type SyntheticDebugAdapterFactory,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ServiceAccessor, Token } from "../../../../platform/instantiation/common/diContainer.ts";
import { NotificationServiceDIToken } from "../../../services/notification/browser/notificationService.ts";
import { type IDebugSession, type IStackFrame, State } from "../common/debug.ts";
import type { Thread } from "../common/debugModel.ts";
import type { ViewModel } from "../common/debugViewModel.ts";

import {
    callStackBottomAction,
    callStackDownAction,
    callStackTopAction,
    callStackUpAction,
    continueAction,
    DEBUG_ACTIONS,
    disconnectAction,
    focusSessionAction,
    pauseAction,
    restartFrameAction,
    restartSessionAction,
    startAction,
    startFromConfigAction,
    stepIntoAction,
    stepOutAction,
    stepOverAction,
    stopAction,
    terminateThreadAction,
} from "./debugCommands.ts";
import { DebugServiceDIToken, DebugServicePortsDIToken } from "./debugService.ts";

describe("debug commands", () => {
    let fx: IDebugServiceFixture;
    let factory: SyntheticDebugAdapterFactory;
    let accessor: ServiceAccessor;
    const notifications = { show: vi.fn() };
    let executed: unknown[][];

    beforeEach(() => {
        fx = createDebugServiceFixture();
        factory = registerSyntheticDebugger(fx.service.getAdapterManager(), NO_DELAY_TIMING).factory;
        notifications.show.mockReset();
        executed = [];
        accessor = {
            get: <T>(token: Token<T>): T => {
                if (token === (DebugServiceDIToken as Token<unknown>)) return fx.service as T;
                if (token === (DebugServicePortsDIToken as Token<unknown>)) return fx.ports as T;
                if (token === (CommandRegistryDIToken as Token<unknown>)) {
                    return { execute: (...args: unknown[]) => executed.push(args) } as T;
                }
                if (token === (NotificationServiceDIToken as Token<unknown>)) return notifications as T;
                throw new Error(`unexpected ${token.id}`);
            },
        };
    });

    afterEach(async () => {
        await fx.service.stopSession(undefined);
        factory.adapters.forEach((a) => {
            a.dispose();
        });
        fx.service.dispose();
    });

    function sent(command: string, adapter = 0): DebugProtocol.Request[] {
        return factory.adapters[adapter].requests.filter((r) => r.command === command);
    }

    async function startStopped(name = SYNTHETIC_LAUNCH_CONFIG.name): Promise<IDebugSession> {
        await startFromConfigAction.run(accessor, { ...SYNTHETIC_LAUNCH_CONFIG, name });
        await vi.waitFor(() => {
            expect(
                fx.service
                    .getModel()
                    .getSessions()
                    .find((s) => s.name === name)?.state,
            ).toBe(State.Stopped);
        });
        const session = fx.service
            .getModel()
            .getSessions()
            .find((s) => s.name === name)!;
        await vi.waitFor(() => {
            expect((session.getThread(1) as Thread).getCallStack().length).toBeGreaterThan(1);
        });
        return session;
    }

    function focusedFrame(): IStackFrame | undefined {
        return fx.service.getViewModel().focusedStackFrame;
    }

    it("are upstream's ids, each once", () => {
        const ids = DEBUG_ACTIONS.map((a) => a.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toEqual(
            expect.arrayContaining([
                "workbench.action.debug.start",
                "workbench.action.debug.run",
                "workbench.action.debug.continue",
                "workbench.action.debug.pause",
                "workbench.action.debug.stepOver",
                "workbench.action.debug.stepInto",
                "workbench.action.debug.stepOut",
                "workbench.action.debug.stop",
                "workbench.action.debug.disconnect",
                "workbench.action.debug.restart",
                "workbench.action.debug.restartFrame",
                "workbench.action.debug.terminateThread",
                "workbench.action.debug.callStackTop",
                "workbench.action.debug.callStackBottom",
                "workbench.action.debug.callStackUp",
                "workbench.action.debug.callStackDown",
                "workbench.action.debug.focusProcess",
                "debug.startFromConfig",
            ]),
        );
    });

    describe("the thread they act on", () => {
        it.each([
            [stepOverAction, "next"],
            [stepIntoAction, "stepIn"],
            [stepOutAction, "stepOut"],
            [continueAction, "continue"],
        ])("%# from a key: the focused thread", async (action, command) => {
            await startStopped();

            await action.run(accessor);

            expect(sent(command).map((r) => (r.arguments as { threadId: number }).threadId)).toEqual([1]);
        });

        it("from a call stack row: that thread of that session", async () => {
            const session = await startStopped();

            await terminateThreadAction.run(accessor, undefined, {
                sessionId: session.getId(),
                threadId: session.getThread(3)?.getId(),
            });

            expect(sent("terminateThreads").map((r) => r.arguments as unknown)).toEqual([{ threadIds: [3] }]);
        });

        it("from a session row: its first thread, not the focused one", async () => {
            const session = await startStopped();
            await fx.service.focusStackFrame(undefined, session.getThread(2), session);

            await stepOverAction.run(accessor, undefined, { sessionId: session.getId() });

            expect(sent("next").map((r) => r.arguments as unknown)).toEqual([{ threadId: 1 }]);
        });

        it("a row of a thread that is gone falls back to the focused thread", async () => {
            const session = await startStopped();

            await stepOverAction.run(accessor, undefined, { sessionId: session.getId(), threadId: "nope" });
            await stepOverAction.run(accessor, undefined, { sessionId: "gone", threadId: "nope" });

            expect(sent("next")).toHaveLength(2);
        });

        it("without a focused thread: the first thread of the focused session", async () => {
            const session = await startStopped();
            (fx.service.getViewModel() as ViewModel).setFocus(undefined, undefined, session, false);

            await pauseAction.run(accessor);

            expect(sent("pause").map((r) => r.arguments as unknown)).toEqual([{ threadId: 1 }]);
        });

        it("without any session: nothing", async () => {
            await stepOverAction.run(accessor);
            await pauseAction.run(accessor, undefined, { sessionId: "gone" });

            expect(factory.adapters).toEqual([]);
        });
    });

    describe("stop, disconnect, restart", () => {
        it("stop terminates the focused session, disconnect only disconnects", async () => {
            await startStopped();

            await disconnectAction.run(accessor);

            expect(sent("terminate")).toEqual([]);
            expect(sent("disconnect")).toHaveLength(1);
        });

        it("stop from a session row stops that session", async () => {
            const first = await startStopped("first");
            await startStopped("second");

            await stopAction.run(accessor, undefined, { sessionId: first.getId() });

            expect(sent("terminate", 0)).toHaveLength(1);
            expect(sent("terminate", 1)).toEqual([]);
        });

        it("stop without a session stops them all", async () => {
            await startStopped("first");
            await startStopped("second");
            (fx.service.getViewModel() as ViewModel).setFocus(undefined, undefined, undefined, false);

            await stopAction.run(accessor);

            expect([sent("terminate", 0).length, sent("terminate", 1).length]).toEqual([1, 1]);
        });

        it("restart restarts the session and clears its console", async () => {
            const session = await startStopped();
            session.appendToRepl({ output: "old\n", sev: "info" });

            await restartSessionAction.run(accessor, undefined, { sessionId: session.getId() });

            expect(factory.adapters).toHaveLength(2);
            expect(session.getReplElements().map((e) => e.toString())).not.toContain("old\n");
        });

        it("restart of the focused session", async () => {
            await startStopped();

            await restartSessionAction.run(accessor);

            expect(factory.adapters).toHaveLength(2);
        });

        it("restart without a session starts the selected configuration", async () => {
            const start = vi.spyOn(fx.service, "startDebugging");

            await restartSessionAction.run(accessor);

            const { launch, name } = fx.service.getConfigurationManager().selectedConfiguration;
            expect(start).toHaveBeenCalledWith(launch, name, { noDebug: false, startedByUser: true });
        });
    });

    describe("start", () => {
        it("without a selected configuration Start Debugging starts without one: the debugger is guessed", async () => {
            const start = vi.spyOn(fx.service, "startDebugging");

            await startAction.run(accessor);

            expect(start).toHaveBeenCalledWith(
                fx.service.getConfigurationManager().selectedConfiguration.launch,
                undefined,
                { noDebug: undefined, startedByUser: true },
                false,
            );
            expect(executed).toEqual([]);
            expect(fx.saves).toHaveLength(1);
        });
    });

    describe("frames", () => {
        it("restart frame restarts the frame of the row, or the focused one", async () => {
            const session = await startStopped();
            const frame = (session.getThread(1) as Thread).getCallStack()[2];

            await restartFrameAction.run(accessor, undefined, {
                sessionId: session.getId(),
                threadId: frame.thread.getId(),
                frameId: frame.getId(),
            });
            await vi.waitFor(() => {
                expect(fx.service.state).toBe(State.Stopped);
            });
            await restartFrameAction.run(accessor);

            expect(sent("restartFrame").map((r) => r.arguments as unknown)).toEqual([
                { frameId: 1002 },
                { frameId: 1000 },
            ]);
        });

        it("a frame row of another thread restarts that thread's frame", async () => {
            const session = await startStopped();
            const worker = session.getThread(2) as Thread;
            await worker.fetchCallStack();
            const frame = worker.getCallStack()[0];
            expect(frame.name).toBe("__futex_abstimed_wait_common");
            const restart = vi.spyOn(frame, "restart").mockResolvedValue();

            await restartFrameAction.run(accessor, undefined, {
                sessionId: session.getId(),
                threadId: worker.getId(),
                frameId: frame.getId(),
            });

            expect(restart).toHaveBeenCalledTimes(1);
        });

        it("a thread row without a frame restarts the focused frame", async () => {
            await startStopped();

            await restartFrameAction.run(accessor, undefined, { sessionId: "any", threadId: "any" });

            expect(sent("restartFrame").map((r) => r.arguments as unknown)).toEqual([{ frameId: 1000 }]);
        });

        it("without a frame restarts nothing and says nothing", async () => {
            await restartFrameAction.run(accessor);

            expect(notifications.show).not.toHaveBeenCalled();
        });

        it("down in the middle of the loaded stack loads no more frames", async () => {
            await startStopped();
            const stackTraces = sent("stackTrace").length;

            await callStackDownAction.run(accessor);

            expect(sent("stackTrace")).toHaveLength(stackTraces);
        });

        it("a frame row of a thread that is gone restarts nothing", async () => {
            const session = await startStopped();

            await restartFrameAction.run(accessor, undefined, {
                sessionId: session.getId(),
                threadId: "x",
                frameId: "y",
            });
            await restartFrameAction.run(accessor, undefined, { sessionId: "gone", threadId: "x", frameId: "y" });

            expect(sent("restartFrame")).toEqual([]);
        });

        it("a failed restart frame is an error notification", async () => {
            const session = await startStopped();
            const frame = (session.getThread(1) as Thread).getTopStackFrame()!;
            vi.spyOn(frame, "restart").mockRejectedValue(new Error("cannot restart"));

            await restartFrameAction.run(accessor);

            expect(notifications.show).toHaveBeenCalledWith({
                severity: "error",
                message: "cannot restart",
                modal: false,
                items: [],
            });
        });

        it("navigates the call stack: down, up, bottom and top, loading the rest of the stack", async () => {
            await startStopped();

            await callStackDownAction.run(accessor);
            expect(focusedFrame()?.name).toBe("process(Config const&)");
            await callStackUpAction.run(accessor);
            expect(focusedFrame()?.name).toBe("accumulate(std::vector<int> const&)");

            await callStackBottomAction.run(accessor);
            // The bottom frames without a source are de-emphasized: the last one with a source.
            expect(focusedFrame()?.name).toBe("recurse<19>(Node*)");
            await callStackTopAction.run(accessor);
            expect(focusedFrame()?.name).toBe("accumulate(std::vector<int> const&)");
        });

        it("up from the top goes to the bottom, down from the end of a full stack to the top", async () => {
            await startStopped();

            await callStackUpAction.run(accessor);
            expect(focusedFrame()?.name).toBe("recurse<19>(Node*)");
            await callStackDownAction.run(accessor);

            expect(focusedFrame()?.name).toBe("accumulate(std::vector<int> const&)");
        });

        it("down from the last loaded frame loads the next page", async () => {
            const session = await startStopped();
            const main = session.getThread(1) as Thread;
            await fx.service.focusStackFrame(main.getCallStack()[19]);

            await callStackDownAction.run(accessor);

            expect(main.getCallStack()).toHaveLength(26);
            expect(focusedFrame()?.name).toBe("recurse<17>(Node*)");
        });

        it("without a focused frame or thread navigates nowhere", async () => {
            await callStackDownAction.run(accessor);
            await callStackUpAction.run(accessor);
            await callStackBottomAction.run(accessor);
            await callStackTopAction.run(accessor);

            expect(focusedFrame()).toBeUndefined();
        });
    });

    it("focus session focuses the session and its stopped thread, explicitly", async () => {
        const first = await startStopped("first");
        const second = await startStopped("second");
        await fx.service.focusStackFrame(undefined, undefined, second);
        const explicit: boolean[] = [];
        fx.service.getViewModel().onDidFocusStackFrame((e) => explicit.push(e.explicit));

        await focusSessionAction.run(accessor, first);

        expect(fx.service.getViewModel().focusedSession).toBe(first);
        expect(fx.service.getViewModel().focusedThread?.threadId).toBe(1);
        expect(explicit).toEqual([true]);
    });
});
