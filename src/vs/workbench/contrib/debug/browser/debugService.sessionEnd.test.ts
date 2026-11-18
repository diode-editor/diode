// What the end of a session does by the settings: `debug.closeReadonlyTabsOnEnd` closes the session's `debug:` tabs
// before the end is announced, `debug.openExplorerOnEnd` shows Explorer when the last session ends.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugServiceFixture, type IDebugServiceFixture } from "../../../../../TestUtils/debugServiceFixture.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_LAUNCH_CONFIG,
    type SyntheticDebugAdapterFactory,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { State } from "../common/debug.ts";

describe("DebugService at the end of a session", () => {
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
    });

    async function start(): Promise<string> {
        expect(await fx.service.startDebugging(undefined, SYNTHETIC_LAUNCH_CONFIG)).toBe(true);
        await vi.waitFor(() => {
            expect(fx.service.state).toBe(State.Stopped);
        });
        return fx.service.getModel().getSessions().at(-1)?.getId() ?? "";
    }

    async function stop(sessionId: string): Promise<void> {
        await fx.service.stopSession(fx.service.getModel().getSession(sessionId));
        await vi.waitFor(() => {
            expect(fx.service.getModel().getSession(sessionId)).toBeUndefined();
        });
    }

    describe("debug.closeReadonlyTabsOnEnd", () => {
        it("closes the tabs of each ending session, before the end is announced", async () => {
            await fx.configuration.updateValue("debug.closeReadonlyTabsOnEnd", true);
            const first = await start();
            const second = await start();
            const closedAtEnd: string[][] = [];
            fx.service.onDidEndSession(() => closedAtEnd.push([...fx.closedSessionEditors]));

            await stop(first);
            await stop(second);

            expect(closedAtEnd).toEqual([[first], [first, second]]);
        });

        it("is off by default", async () => {
            await stop(await start());

            expect(fx.closedSessionEditors).toEqual([]);
        });
    });

    describe("debug.openExplorerOnEnd", () => {
        it("shows Explorer when the last session ends", async () => {
            await fx.configuration.updateValue("debug.openExplorerOnEnd", true);
            const first = await start();
            const second = await start();

            await stop(first);
            expect(fx.explorerOpenings).toBe(0);

            await stop(second);
            expect(fx.explorerOpenings).toBe(1);
        });

        it("is off by default", async () => {
            await stop(await start());

            expect(fx.explorerOpenings).toBe(0);
        });
    });
});
