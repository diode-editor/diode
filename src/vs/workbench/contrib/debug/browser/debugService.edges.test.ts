// The edges of the debug service: child sessions from the adapter, notifications, cancellation, a failed relaunch.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugServiceFixture, type IDebugServiceFixture } from "../../../../../TestUtils/debugServiceFixture.ts";
import { MockDebugAdapter, NO_RESPONSE } from "../../../../../TestUtils/mockDebugAdapter.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_LAUNCH_CONFIG,
    type SyntheticDebugAdapterFactory,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import type { IConfig, IDebugSession } from "../common/debug.ts";
import { State } from "../common/debug.ts";
import type { Thread } from "../common/debugModel.ts";

describe("DebugService edges", () => {
    let fx: IDebugServiceFixture;
    let factory: SyntheticDebugAdapterFactory;
    const mocks: MockDebugAdapter[] = [];

    beforeEach(() => {
        fx = createDebugServiceFixture();
        factory = registerSyntheticDebugger(fx.service.getAdapterManager(), NO_DELAY_TIMING).factory;
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

    /** Registers type `mock`: each session gets a new mock adapter, set up by `setup`. */
    function registerMock(setup: (adapter: MockDebugAdapter, index: number) => void = () => undefined): void {
        fx.service.getAdapterManager().registerDebugger({ type: "mock" });
        fx.service.getAdapterManager().registerDebugAdapterFactory(["mock"], {
            createDebugAdapter: () => {
                const adapter = new MockDebugAdapter();
                setup(adapter, mocks.length);
                mocks.push(adapter);
                return adapter;
            },
            substituteVariables: (_folder, config) => Promise.resolve(config),
        });
    }

    const MOCK: IConfig = { type: "mock", name: "m", request: "launch" };

    it("a `startDebugging` request of the adapter starts a child session", async () => {
        registerMock();
        await fx.service.startDebugging(undefined, { ...MOCK });
        const parent = fx.service.getModel().getSessions()[0];

        mocks[0].sendRequestBody("startDebugging", { request: "attach", configuration: { name: "child" } });
        const response = await mocks[0].waitForResponseFromClient("startDebugging");

        expect(response.success).toBe(true);
        const child = fx.service
            .getModel()
            .getSessions()
            .find((s) => s.name === "child");
        expect(child?.parentSession).toBe(parent);
        expect(child?.configuration).toMatchObject({ type: "mock", request: "attach" });
    });

    it("important output and errors the adapter shows are notifications", async () => {
        registerMock();
        await fx.service.startDebugging(undefined, { ...MOCK });
        const session = fx.service.getModel().getSessions()[0];

        mocks[0].sendEventBody("output", { category: "important", output: "Read me" });
        mocks[0].handlers.set("evaluate", () => NO_RESPONSE);
        const failed = session.evaluate("x", 1).catch(() => undefined);
        await settle(5);
        mocks[0].sendErrorResponse(mocks[0].sent("evaluate")[0], "", {
            error: { id: 1, format: "Shown", showUser: true },
        });
        await failed;
        await settle(5);

        expect(fx.shown.map((m) => [m.severity, m.message, m.modal])).toEqual([
            ["info", "m: Read me", false],
            ["error", "Shown", false],
        ]);
    });

    it("a debugger registered during a session keeps the default debug UX", async () => {
        await fx.service.startDebugging(undefined, { ...SYNTHETIC_LAUNCH_CONFIG });

        fx.service.getAdapterManager().registerDebugger({ type: "late" });

        expect(fx.contextKeys.getRaw("debugUx")).toBe("default");
    });

    it("stopping while the variables are substituted cancels the start", async () => {
        let substituted: (config: IConfig) => void = () => undefined;
        fx.service.getAdapterManager().registerDebugger({ type: "slow" });
        fx.service.getAdapterManager().registerDebugAdapterFactory(["slow"], {
            createDebugAdapter: () => factory.createDebugAdapter(),
            substituteVariables: (_folder, config) =>
                new Promise((resolve) => {
                    substituted = () => {
                        resolve(config);
                    };
                }),
        });
        const started = fx.service.startDebugging(undefined, { type: "slow", name: "s", request: "launch" });
        await settle(5);

        await fx.service.stopSession(undefined);
        substituted({ type: "slow", name: "s", request: "launch" });

        expect(await started).toBe(false);
        expect(fx.service.getModel().getSessions()).toEqual([]);
        expect(fx.shown).toEqual([]);
    });

    it("a session restarted twice ends once its start is long gone", async () => {
        await fx.service.startDebugging(undefined, { ...SYNTHETIC_LAUNCH_CONFIG });
        const session = fx.service.getModel().getSessions()[0];
        await vi.waitFor(() => {
            expect(session.state).toBe(State.Stopped);
        });
        const ends: boolean[] = [];
        fx.service.onDidEndSession((e) => ends.push(e.restart));

        await fx.service.restartSession(session);
        await fx.service.restartSession(session);

        expect(ends).toEqual([true, true]);
        expect(factory.adapters).toHaveLength(3);
    });

    it("a relaunch that fails takes the focus off the session and rejects", async () => {
        registerMock((adapter, index) => {
            if (index === 1) adapter.handlers.set("launch", () => new Error("gone"));
        });
        await fx.service.startDebugging(undefined, { ...MOCK });
        const session = fx.service.getModel().getSessions()[0];
        expect(fx.service.getViewModel().focusedSession).toBe(session);

        await expect(fx.service.restartSession(session)).rejects.toThrow("gone");

        expect(fx.service.getViewModel().focusedSession).toBeUndefined();
    });

    it("a launch that fails after the session took the focus gives the focus up", async () => {
        registerMock((adapter) => {
            adapter.handlers.set("launch", () => NO_RESPONSE);
            adapter.handlers.set("threads", () => ({ threads: [{ id: 1, name: "main" }] }));
            adapter.handlers.set("stackTrace", () => ({
                stackFrames: [{ id: 1, name: "f", source: { path: "/a.c" }, line: 1, column: 1 }],
            }));
        });
        const started = fx.service.startDebugging(undefined, { ...MOCK });
        await vi.waitFor(() => {
            expect(mocks[0]?.sent("launch")).toHaveLength(1);
        });
        mocks[0].sendEventBody("stopped", { reason: "entry", threadId: 1 });
        await vi.waitFor(() => {
            expect(fx.service.getViewModel().focusedSession).toBeDefined();
        });

        mocks[0].sendErrorResponse(mocks[0].sent("launch")[0], "no program");

        expect(await started).toBe(false);
        expect(fx.service.getViewModel().focusedSession).toBeUndefined();
    });

    it("a session that stops again within 200 ms keeps its focused frame", async () => {
        await fx.service.startDebugging(undefined, { ...SYNTHETIC_LAUNCH_CONFIG });
        const session = fx.service.getModel().getSessions()[0];
        await vi.waitFor(() => {
            expect(fx.service.getViewModel().focusedStackFrame).toBeDefined();
        });

        await (session.getThread(1) as Thread).next();
        await settle(300);

        expect(fx.service.getViewModel().focusedStackFrame).toBeDefined();
    });

    it("sends no exception filters to an adapter with configurationDone and no filters", async () => {
        registerMock((adapter) => {
            adapter.handlers.set("initialize", () => {
                setTimeout(() => {
                    adapter.sendEventBody("initialized");
                }, 0);
                return { supportsConfigurationDoneRequest: true };
            });
        });
        await fx.service.startDebugging(undefined, { ...MOCK });
        await vi.waitFor(() => {
            expect(mocks[0].sent("configurationDone")).toHaveLength(1);
        });

        expect(mocks[0].sent("setExceptionBreakpoints")).toEqual([]);
    });
});
