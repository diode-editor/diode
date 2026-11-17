// Upstream `DebugService.runTo` (Run to Cursor) on the synthetic program: a breakpoint where it should stop, Continue
// on the thread that verified it, the breakpoint taken away at the stop; one already there stays; a breakpoint the
// adapter does not verify is waited for; without a session the selected configuration starts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugServiceFixture, type IDebugServiceFixture } from "../../../../../TestUtils/debugServiceFixture.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_LAUNCH_CONFIG,
    SYNTHETIC_PROGRAM_ROOT,
    type SyntheticDebugAdapter,
    type SyntheticDebugAdapterFactory,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { State } from "../common/debug.ts";
import type { DebugModel } from "../common/debugModel.ts";

const MAIN = Uri.file(`${SYNTHETIC_PROGRAM_ROOT}/src/main.cpp`);
const UNKNOWN = Uri.file("/elsewhere/util.cpp");

describe("DebugService.runTo", () => {
    let fx: IDebugServiceFixture;
    let factory: SyntheticDebugAdapterFactory;

    beforeEach(() => {
        fx = createDebugServiceFixture();
        factory = registerSyntheticDebugger(fx.service.getAdapterManager(), NO_DELAY_TIMING).factory;
    });

    afterEach(async () => {
        vi.useRealTimers();
        await fx.service.stopSession(undefined);
        for (const adapter of factory.adapters) adapter.dispose();
        fx.service.dispose();
    });

    async function startStopped(): Promise<SyntheticDebugAdapter> {
        expect(await fx.service.startDebugging(undefined, { ...SYNTHETIC_LAUNCH_CONFIG })).toBe(true);
        await vi.waitFor(() => {
            expect(fx.service.state).toBe(State.Stopped);
        });
        const adapter = factory.adapters[0];
        adapter.requests.length = 0;
        return adapter;
    }

    function focusedLine(): number | undefined {
        return fx.service.getViewModel().focusedStackFrame?.range.startLineNumber;
    }

    function lines(): (number | undefined)[][] {
        return fx.service
            .getModel()
            .getBreakpoints()
            .map((bp) => [bp.lineNumber, bp.column]);
    }

    it("stops on the line and takes the breakpoint away at the stop", async () => {
        const adapter = await startStopped();
        await fx.service.runTo(MAIN, 29);
        await vi.waitFor(() => {
            expect(fx.service.state).toBe(State.Stopped);
            expect(focusedLine()).toBe(29);
        });
        await vi.waitFor(() => {
            expect(lines()).toEqual([]);
        });
        const commands = adapter.requests.map((r) => r.command);
        expect(commands.filter((c) => c === "continue")).toHaveLength(1);
        expect(adapter.requests.find((r) => r.command === "continue")?.arguments).toMatchObject({ threadId: 1 });
        // The breakpoint was sent with its column, then without the breakpoint.
        const sent = adapter.requests
            .filter((r) => r.command === "setBreakpoints")
            .map((r) => (r.arguments as DebugProtocol.SetBreakpointsArguments).breakpoints);
        expect(sent).toEqual([[{ line: 29 }], []]);
    });

    it("a column goes with the breakpoint", async () => {
        const adapter = await startStopped();
        await fx.service.runTo(MAIN, 29, 16);
        await vi.waitFor(() => {
            expect(focusedLine()).toBe(29);
        });
        const [first] = adapter.requests.filter((r) => r.command === "setBreakpoints");
        expect((first.arguments as DebugProtocol.SetBreakpointsArguments).breakpoints).toEqual([
            { line: 29, column: 16 },
        ]);
    });

    it("a breakpoint already there stays; the program still runs to it", async () => {
        await startStopped();
        await fx.service.addBreakpoints(MAIN, [{ lineNumber: 30 }]);
        await fx.service.runTo(MAIN, 30);
        await vi.waitFor(() => {
            expect(focusedLine()).toBe(30);
        });
        expect(lines()).toEqual([[30, undefined]]);
    });

    it("a breakpoint no session verifies is waited for two seconds, then the focused thread goes on", async () => {
        const adapter = await startStopped();
        vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout"] });
        const run = fx.service.runTo(UNKNOWN, 3);
        await vi.waitFor(() => {
            expect(lines()).toEqual([[3, undefined]]);
        });
        await vi.advanceTimersByTimeAsync(1900);
        expect(adapter.requests.some((r) => r.command === "continue")).toBe(false);
        await vi.advanceTimersByTimeAsync(200);
        await run;
        expect(adapter.requests.find((r) => r.command === "continue")?.arguments).toMatchObject({ threadId: 1 });
        await vi.waitFor(() => {
            expect(fx.service.state).toBe(State.Stopped);
            expect(lines()).toEqual([]);
        });
    });

    it("a breakpoint verified while waited for: the program goes on at once", async () => {
        const adapter = await startStopped();
        vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout"] });
        const run = fx.service.runTo(UNKNOWN, 3);
        await vi.waitFor(() => {
            expect(fx.service.getModel().getBreakpoints()[0]?.verified).toBe(false);
        });
        const [bp] = fx.service.getModel().getBreakpoints();
        const session = fx.service.getViewModel().focusedSession;
        if (!session) throw new Error("no session");
        // Another change first: the breakpoint is still not verified.
        (fx.service.getModel() as DebugModel).setBreakpointSessionData(
            session.getId(),
            session.capabilities,
            new Map(),
        );
        (fx.service.getModel() as DebugModel).setBreakpointSessionData(
            session.getId(),
            session.capabilities,
            new Map([[bp.getId(), { verified: true, line: 3 }]]),
        );
        await run;
        expect(adapter.requests.find((r) => r.command === "continue")?.arguments).toMatchObject({ threadId: 1 });
        // The program's timers were faked: it stops while they still are.
        await vi.waitFor(() => {
            expect(fx.service.state).toBe(State.Stopped);
        });
    });

    it("without a session: the selected configuration starts, the breakpoint goes at its first stop", async () => {
        await fx.service
            .getConfigurationManager()
            .selectConfiguration(undefined, SYNTHETIC_LAUNCH_CONFIG.name, { ...SYNTHETIC_LAUNCH_CONFIG });
        await fx.service.runTo(MAIN, 29);
        await vi.waitFor(() => {
            expect(fx.service.state).toBe(State.Stopped);
        });
        const [adapter] = factory.adapters;
        const sent = adapter.requests
            .filter((r) => r.command === "setBreakpoints")
            .map((r) => (r.arguments as DebugProtocol.SetBreakpointsArguments).breakpoints);
        expect(sent[0]).toEqual([{ line: 29 }]);
        await vi.waitFor(() => {
            expect(lines()).toEqual([]);
        });
        // The listener is gone: a breakpoint set later stays at the next stop.
        await fx.service.addBreakpoints(MAIN, [{ lineNumber: 30 }]);
        await fx.service.getViewModel().focusedThread?.continue();
        await vi.waitFor(() => {
            expect(focusedLine()).toBe(30);
        });
        expect(lines()).toEqual([[30, undefined]]);
    });

    it("without a session or a configuration: nothing runs, the breakpoint goes when the start fails", async () => {
        await fx.service.runTo(MAIN, 29);
        expect(fx.service.state).toBe(State.Inactive);
        await vi.waitFor(() => {
            expect(lines()).toEqual([]);
        });
        expect(factory.adapters).toEqual([]);
    });
});
