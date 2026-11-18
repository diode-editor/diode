// A session started for a test run (`DebugSessionOptions.testRun`): the first Stop cancels the run instead of the
// program, the end of the run terminates the session, a child session shares its parent's run.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    createTestDebugSession,
    type ITestSessionServices,
    type TestDebugService,
    testDebugService,
    testSessionServices,
} from "../../../../../TestUtils/debugSessionFixture.ts";
import { createMockDebugModel } from "../../../../../TestUtils/mockDebug.ts";
import { MockDebugAdapter } from "../../../../../TestUtils/mockDebugAdapter.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { DisposableStore } from "../../../../base/common/lifecycle.ts";
import type { ICorrelatedTestRun, IDebugger, IDebugSessionOptions } from "../common/debug.ts";
import type { DebugModel } from "../common/debugModel.ts";

import type { DebugSession } from "./debugSession.ts";

function debuggerOf(adapter: MockDebugAdapter): IDebugger {
    return {
        type: "mock",
        createDebugAdapter: () => Promise.resolve(adapter),
        runInTerminal: () => Promise.resolve(undefined),
        startDebugging: () => Promise.resolve(true),
        getInitialConfigurationContent: () => Promise.resolve(""),
    };
}

describe("DebugSession of a test run", () => {
    const disposables = new DisposableStore();
    let model: DebugModel;
    let debugService: TestDebugService;
    let services: ITestSessionServices;
    let complete: Emitter<void>;
    let run: { -readonly [K in keyof ICorrelatedTestRun]: ICorrelatedTestRun[K] };

    beforeEach(() => {
        model = createMockDebugModel(disposables);
        debugService = testDebugService(model);
        services = testSessionServices();
        complete = disposables.add(new Emitter<void>());
        run = { id: "run-1", completedAt: undefined, onComplete: complete.event, request: { targets: [] } };
        services.testRuns.set(run.id, run);
    });

    afterEach(() => {
        disposables.clear();
        debugService.viewModel.dispose();
    });

    async function launch(options: IDebugSessionOptions): Promise<{ session: DebugSession; adapter: MockDebugAdapter }> {
        const adapter = disposables.add(new MockDebugAdapter());
        adapter.handlers.set("initialize", () => ({ supportsTerminateRequest: true }));
        const session = disposables.add(createTestDebugSession(model, "s", options, debugService, services, { type: "mock" }));
        await session.initialize(debuggerOf(adapter));
        await session.launchOrAttach(session.configuration);
        return { session, adapter };
    }

    it("the first Stop cancels the run and leaves the program, the next one terminates it", async () => {
        const { session, adapter } = await launch({ testRun: { runId: "run-1", taskId: "t" } });
        expect(session.correlatedTestRun).toBe(run);

        await session.terminate();
        expect(services.cancelledTestRuns).toEqual(["run-1"]);
        expect(adapter.sent("terminate")).toEqual([]);

        await session.terminate();
        expect(services.cancelledTestRuns).toEqual(["run-1"]);
        expect(adapter.sent("terminate")).toHaveLength(1);
    });

    it("a completed run is not cancelled: Stop terminates the program", async () => {
        const { session, adapter } = await launch({ testRun: { runId: "run-1", taskId: "t" } });
        run.completedAt = 1;

        session.cancelCorrelatedTestRun();
        await session.terminate();

        expect(services.cancelledTestRuns).toEqual([]);
        expect(adapter.sent("terminate")).toHaveLength(1);
    });

    it("the end of the run terminates the session", async () => {
        const { adapter } = await launch({ testRun: { runId: "run-1", taskId: "t" } });
        run.completedAt = 1;

        complete.fire();

        await vi.waitFor(() => {
            expect(adapter.sent("terminate")).toHaveLength(1);
        });
    });

    it("a child shares the parent's run; a run the core does not know ties nothing", async () => {
        const { session: parent } = await launch({ testRun: { runId: "run-1", taskId: "t" } });
        const child = disposables.add(createTestDebugSession(model, "child", { parentSession: parent }));
        expect(child.correlatedTestRun).toBe(run);

        const { session: unknown } = await launch({ testRun: { runId: "gone", taskId: "t" } });
        expect(unknown.correlatedTestRun).toBeUndefined();
        const { session: plain } = await launch({});
        expect(plain.correlatedTestRun).toBeUndefined();
    });
});
