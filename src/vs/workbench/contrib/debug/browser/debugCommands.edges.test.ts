// Call stack navigation at the edges: the end of a fully loaded stack, a stack of only de-emphasized frames, none.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugServiceFixture, type IDebugServiceFixture } from "../../../../../TestUtils/debugServiceFixture.ts";
import { MockDebugAdapter } from "../../../../../TestUtils/mockDebugAdapter.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_LAUNCH_CONFIG,
    type SyntheticDebugAdapterFactory,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import type { ServiceAccessor, Token } from "../../../../platform/instantiation/common/diContainer.ts";
import { State } from "../common/debug.ts";
import type { Thread } from "../common/debugModel.ts";

import { callStackBottomAction, callStackDownAction, callStackUpAction } from "./debugCommands.ts";

describe("call stack navigation edges", () => {
    let fx: IDebugServiceFixture;
    let factory: SyntheticDebugAdapterFactory;
    let accessor: ServiceAccessor;
    const mocks: MockDebugAdapter[] = [];

    beforeEach(() => {
        fx = createDebugServiceFixture();
        factory = registerSyntheticDebugger(fx.service.getAdapterManager(), NO_DELAY_TIMING).factory;
        accessor = { get: <T>(_token: Token<T>): T => fx.service as T };
    });

    afterEach(async () => {
        await fx.service.stopSession(undefined);
        factory.adapters.forEach((a) => {
            a.dispose();
        });
        mocks.splice(0).forEach((a) => {
            a.dispose();
        });
        fx.service.dispose();
    });

    /** A session stopped on thread 1 whose stack is `frames`. */
    async function stoppedWith(frames: DebugProtocol.StackFrame[]): Promise<Thread> {
        fx.service.getAdapterManager().registerDebugger({ type: "mock" });
        fx.service.getAdapterManager().registerDebugAdapterFactory(["mock"], {
            createDebugAdapter: () => {
                const adapter = new MockDebugAdapter();
                adapter.handlers.set("threads", () => ({ threads: [{ id: 1, name: "main" }] }));
                adapter.handlers.set("stackTrace", () => ({ stackFrames: frames, totalFrames: frames.length }));
                mocks.push(adapter);
                return adapter;
            },
            substituteVariables: (_folder, config) => Promise.resolve(config),
        });
        await fx.service.startDebugging(undefined, { type: "mock", name: "m", request: "launch" });
        mocks[0].sendEventBody("stopped", { reason: "pause", threadId: 1 });
        const thread = await vi.waitFor(() => {
            const stopped = fx.service.getModel().getSessions()[0].getThread(1);
            expect(stopped?.stopped).toBe(true);
            return stopped as Thread;
        });
        await fx.service.focusStackFrame(undefined, thread);
        return thread;
    }

    const subtle = (id: number): DebugProtocol.StackFrame => ({
        id,
        name: `f${String(id)}`,
        line: 0,
        column: 0,
        presentationHint: "subtle",
    });

    it("down from the last frame of a fully loaded stack goes to the top", async () => {
        await fx.service.startDebugging(undefined, { ...SYNTHETIC_LAUNCH_CONFIG });
        await vi.waitFor(() => {
            expect(fx.service.state).toBe(State.Stopped);
        });
        const main = fx.service.getModel().getSessions()[0].getThread(1) as Thread;
        await fx.service.getModel().fetchCallstack(main);
        await fx.service.focusStackFrame(main.getCallStack().at(-1));

        await callStackDownAction.run(accessor);

        expect(fx.service.getViewModel().focusedStackFrame?.name).toBe("accumulate(std::vector<int> const&)");
    });

    it("a stack of only de-emphasized frames has nowhere to go", async () => {
        const thread = await stoppedWith([subtle(1), subtle(2)]);
        await fx.service.getModel().fetchCallstack(thread);
        const second = thread.getCallStack()[1];
        await fx.service.focusStackFrame(second);

        await callStackUpAction.run(accessor);
        await callStackBottomAction.run(accessor);

        expect(fx.service.getViewModel().focusedStackFrame).toBe(second);
    });

    it("bottom of an empty stack goes nowhere", async () => {
        await stoppedWith([]);

        await callStackBottomAction.run(accessor);

        expect(fx.service.getViewModel().focusedStackFrame).toBeUndefined();
    });
});
