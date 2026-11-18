// Restart of a session started for a test run: tests have no notion of restarts, so the run is cancelled and its
// tests are run again (the extension starts a new session for them).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugServiceFixture, type IDebugServiceFixture } from "../../../../../TestUtils/debugServiceFixture.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_LAUNCH_CONFIG,
    type SyntheticDebugAdapterFactory,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { type ICorrelatedTestRun, State } from "../common/debug.ts";

describe("DebugService: Restart of a test run's session", () => {
    let fx: IDebugServiceFixture;
    let factory: SyntheticDebugAdapterFactory;
    let complete: Emitter<void>;
    let run: { -readonly [K in keyof ICorrelatedTestRun]: ICorrelatedTestRun[K] };
    const request = { targets: [] };

    beforeEach(() => {
        fx = createDebugServiceFixture();
        factory = registerSyntheticDebugger(fx.service.getAdapterManager(), NO_DELAY_TIMING).factory;
        complete = new Emitter<void>();
        run = { id: "run-1", completedAt: undefined, onComplete: complete.event, request };
        fx.testRuns.set(run.id, run);
    });

    afterEach(async () => {
        await fx.service.stopSession(undefined);
        for (const adapter of factory.adapters) adapter.dispose();
        fx.service.dispose();
        complete.dispose();
    });

    async function start(): Promise<void> {
        expect(
            await fx.service.startDebugging(undefined, SYNTHETIC_LAUNCH_CONFIG, {
                testRun: { runId: "run-1", taskId: "t" },
            }),
        ).toBe(true);
        await vi.waitFor(() => {
            expect(fx.service.state).toBe(State.Stopped);
        });
    }

    it("cancels the running test run, waits for its end, then runs its tests again", async () => {
        await start();
        const [session] = fx.service.getModel().getSessions();

        const restarted = fx.service.restartSession(session);
        await vi.waitFor(() => {
            expect(fx.cancelledTestRuns).toEqual(["run-1"]);
        });
        expect(fx.rerunTests).toEqual([]);
        run.completedAt = 1;
        complete.fire();
        await restarted;

        expect(fx.rerunTests).toEqual([request]);
        // The session itself is not restarted.
        expect(factory.adapters).toHaveLength(1);
    });

    it("an ended run's tests are run again at once", async () => {
        await start();
        run.completedAt = 1;

        await fx.service.restartSession(fx.service.getModel().getSessions()[0]);

        expect(fx.cancelledTestRuns).toEqual([]);
        expect(fx.rerunTests).toEqual([request]);
    });
});
