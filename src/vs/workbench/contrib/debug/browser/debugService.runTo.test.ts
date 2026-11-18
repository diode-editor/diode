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
import { type IDebugSession, type IThread, State } from "../common/debug.ts";
import type { DebugModel } from "../common/debugModel.ts";

import { threadToRunTo } from "./debugService.ts";

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

    /** Counts the removals from the model from now on: a listener left behind removes again at every stop. */
    function countRemovals(): () => number {
        let removals = 0;
        fx.service.getModel().onDidChangeBreakpoints((e) => {
            if (e?.removed) removals++;
        });
        return () => removals;
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

        // Its listener is gone: the next stop takes nothing away.
        const removals = countRemovals();
        await fx.service.addBreakpoints(MAIN, [{ lineNumber: 30 }]);
        const session = fx.service.getViewModel().focusedSession;
        if (!session) throw new Error("no session");
        // Listeners run in order: the session's stop has reached runTo's listener, if one is left, by then.
        const stopped = new Promise<void>((resolve) => {
            const listener = session.onDidChangeState(() => {
                if (session.state !== State.Stopped) return;
                listener.dispose();
                resolve();
            });
        });
        await fx.service.getViewModel().focusedThread?.continue();
        await stopped;
        expect(focusedLine()).toBe(30);
        expect(removals()).toBe(0);
    });

    it("a column goes with the breakpoint; one verified at once is not waited for", async () => {
        const adapter = await startStopped();
        vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout"] });
        void fx.service.runTo(MAIN, 29, 16);
        await vi.advanceTimersByTimeAsync(100);
        expect(adapter.requests.map((r) => r.command)).toContain("continue");
        await vi.waitFor(() => {
            expect(focusedLine()).toBe(29);
        });
        const [first] = adapter.requests.filter((r) => r.command === "setBreakpoints");
        expect((first.arguments as DebugProtocol.SetBreakpointsArguments).breakpoints).toEqual([
            { line: 29, column: 16 },
        ]);
    });

    it("a breakpoint already there stays and is not sent again; the program still runs to it", async () => {
        const adapter = await startStopped();
        await fx.service.addBreakpoints(MAIN, [{ lineNumber: 30 }]);
        adapter.requests.length = 0;
        await fx.service.runTo(MAIN, 30);
        await vi.waitFor(() => {
            expect(focusedLine()).toBe(30);
        });
        expect(lines()).toEqual([[30, undefined]]);
        expect(adapter.requests.map((r) => r.command)).not.toContain("setBreakpoints");
    });

    it("the thread of the session that verified the breakpoint goes on, not the focused one of another", async () => {
        const focused = await startStopped();
        // The second session's program lives elsewhere: only it verifies a breakpoint in its file.
        const elsewhere = "/elsewhere/program";
        (factory as unknown as { root: string }).root = elsewhere;
        expect(await fx.service.startDebugging(undefined, { ...SYNTHETIC_LAUNCH_CONFIG })).toBe(true);
        await vi.waitFor(() => {
            expect(fx.service.getModel().getSessions()[1]?.getAllThreads()[0]?.stopped).toBe(true);
        });
        const verifying = factory.adapters[1];
        const [first] = fx.service.getModel().getSessions();
        await fx.service.focusStackFrame(undefined, first.getAllThreads()[0], first);
        focused.requests.length = 0;
        verifying.requests.length = 0;
        await fx.service.runTo(Uri.file(`${elsewhere}/src/main.cpp`), 29);
        expect(verifying.requests.map((r) => r.command)).toContain("continue");
        expect(focused.requests.map((r) => r.command)).not.toContain("continue");
    });

    it("a breakpoint on another line is not the one to run to", async () => {
        await startStopped();
        await fx.service.addBreakpoints(UNKNOWN, [{ lineNumber: 3 }]);
        await fx.service.runTo(MAIN, 29);
        await vi.waitFor(() => {
            expect(focusedLine()).toBe(29);
        });
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
        const continued = () => adapter.requests.some((r) => r.command === "continue");
        await vi.advanceTimersByTimeAsync(100);
        expect(continued()).toBe(false);
        (fx.service.getModel() as DebugModel).setBreakpointSessionData(
            session.getId(),
            session.capabilities,
            new Map([[bp.getId(), { verified: true, line: 3 }]]),
        );
        // Long before the two seconds are up.
        await vi.advanceTimersByTimeAsync(100);
        expect(continued()).toBe(true);
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
        // The listener is gone: a breakpoint set later stays at the next stop, nothing is taken away.
        const removals = countRemovals();
        await fx.service.addBreakpoints(MAIN, [{ lineNumber: 30 }]);
        await fx.service.getViewModel().focusedThread?.continue();
        await vi.waitFor(() => {
            expect(focusedLine()).toBe(30);
        });
        expect(lines()).toEqual([[30, undefined]]);
        expect(removals()).toBe(0);
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

describe("threadToRunTo", () => {
    const FILE = Uri.file("/w/main.cpp");
    const ELSEWHERE = Uri.file("/w/other.cpp");

    /** A thread whose top frame is in `uri` (none without one). */
    function thread(name: string, stopped: boolean, uri?: Uri): IThread {
        return {
            name,
            stopped,
            getTopStackFrame: () => (uri === undefined ? undefined : { source: { uri } }),
        } as unknown as IThread;
    }

    function pick(focused: IThread | undefined, sessions: Record<string, IThread[]>, verified: string[]): string {
        const model = {
            getSession: (id: string) =>
                id in sessions ? ({ getAllThreads: () => sessions[id] } as unknown as IDebugSession) : undefined,
        };
        return threadToRunTo(model, focused, { sessionsThatVerified: verified }, FILE)?.name ?? "none";
    }

    it("no session verified it, or the sessions are gone: the focused thread", () => {
        const focused = thread("focused", true, ELSEWHERE);
        expect(pick(focused, {}, [])).toBe("focused");
        expect(pick(focused, {}, ["gone"])).toBe("focused");
        expect(pick(undefined, {}, [])).toBe("none");
    });

    it("the focused thread of a verifying session wins over a thread paused in the file", () => {
        const focused = thread("focused", true, ELSEWHERE);
        const sessions = { b: [thread("in-file", true, FILE)], a: [focused] };
        expect(pick(focused, sessions, ["b", "a"])).toBe("focused");
        expect(pick(focused, sessions, ["a", "b"])).toBe("focused");
    });

    it("else a stopped thread paused in the breakpoint's file; a running or frameless one is not", () => {
        const focused = thread("focused", true, ELSEWHERE);
        const sessions = {
            b: [thread("running", false, FILE), thread("frameless", true), thread("in-file", true, FILE)],
        };
        expect(pick(focused, sessions, ["b"])).toBe("in-file");
        // The focused thread there but running: not it.
        const running = thread("focused", false, FILE);
        expect(pick(running, { a: [running, thread("in-file", true, FILE)] }, ["a"])).toBe("in-file");
    });

    it("else the first stopped thread of the session; then, as upstream, it is not given up for one in the file", () => {
        const focused = thread("focused", true, ELSEWHERE);
        const sessions = {
            c: [thread("running", false, ELSEWHERE), thread("first", true, ELSEWHERE)],
            d: [thread("in-file", true, FILE)],
        };
        expect(pick(focused, sessions, ["c"])).toBe("first");
        expect(pick(focused, sessions, ["c", "d"])).toBe("first");
        // A session without a stopped thread: no thread at all.
        expect(pick(focused, { e: [thread("running", false, FILE)] }, ["e"])).toBe("none");
    });
});
