// Upstream `DebugService.addBreakpoints`: the new source breakpoints join the model, are stored for the workspace,
// sent to the running session, and stored again with what the adapter answered.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugServiceFixture, type IDebugServiceFixture } from "../../../../../TestUtils/debugServiceFixture.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_LAUNCH_CONFIG,
    SYNTHETIC_PROGRAM_ROOT,
    type SyntheticDebugAdapterFactory,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { State } from "../common/debug.ts";

const MAIN = Uri.file(`${SYNTHETIC_PROGRAM_ROOT}/src/main.cpp`);

describe("DebugService.addBreakpoints", () => {
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

    function stored(): { lineNumber: number; adapterData?: unknown }[] | undefined {
        const key = [...fx.state.values.keys()].find((k) => k.endsWith("debug.breakpoint"));
        return key === undefined ? undefined : (fx.state.values.get(key) as { lineNumber: number }[]);
    }

    it("stores the breakpoints before the adapter answers, and its adapter data once it does", async () => {
        expect(await fx.service.startDebugging(undefined, { ...SYNTHETIC_LAUNCH_CONFIG })).toBe(true);
        await vi.waitFor(() => {
            expect(fx.service.state).toBe(State.Stopped);
        });
        const adapter = factory.adapters[0];
        adapter.breakpointAdapterData = "cookie";
        // The adapter holds every setBreakpoints until released.
        const held: (() => void)[] = [];
        const send = adapter.sendMessage.bind(adapter);
        adapter.sendMessage = (message) => {
            if ((message as DebugProtocol.Request).command === "setBreakpoints")
                held.push(() => {
                    send(message);
                });
            else send(message);
        };

        const done = fx.service.addBreakpoints(MAIN, [{ lineNumber: 27 }]);
        await vi.waitFor(() => {
            expect(held).not.toHaveLength(0);
        });
        expect(stored()).toEqual([expect.objectContaining({ lineNumber: 27 })]);
        expect(stored()?.[0]?.adapterData).toBeUndefined();

        for (const release of held.splice(0)) release();
        const [added] = await done;

        expect(added.lineNumber).toBe(27);
        expect(stored()).toEqual([expect.objectContaining({ lineNumber: 27, adapterData: "cookie" })]);
    });
});
