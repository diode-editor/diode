// The breakpoint editing of the debug service the views drive: enabling and disabling one or all, removing, the
// global activation, function breakpoints — each stored for the workspace and sent to the running session.

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
import { DataBreakpointSetType, type IBreakpoint, State } from "../common/debug.ts";
import type { DebugModel } from "../common/debugModel.ts";

const MAIN = Uri.file(`${SYNTHETIC_PROGRAM_ROOT}/src/main.cpp`);
const LIST = Uri.file(`${SYNTHETIC_PROGRAM_ROOT}/src/list.cpp`);
const UTIL = Uri.file(`${SYNTHETIC_PROGRAM_ROOT}/src/util.cpp`);

describe("DebugService breakpoint editing", () => {
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

    function model(): DebugModel {
        return fx.service.getModel() as DebugModel;
    }

    /** What the store holds for the breakpoints of a kind (`debug.breakpoint`, `debug.functionbreakpoint`...). */
    function stored(kind: string): unknown {
        const key = [...fx.state.values.keys()].find((k) => k.endsWith(kind));
        return key === undefined ? undefined : fx.state.values.get(key);
    }

    async function startStopped(): Promise<SyntheticDebugAdapter> {
        expect(await fx.service.startDebugging(undefined, { ...SYNTHETIC_LAUNCH_CONFIG })).toBe(true);
        await vi.waitFor(() => {
            expect(fx.service.state).toBe(State.Stopped);
        });
        const adapter = factory.adapters[0];
        adapter.requests.length = 0;
        return adapter;
    }

    /** The arguments of the requests of `command` the adapter got since the start. */
    function sent(adapter: SyntheticDebugAdapter, command: string): Record<string, unknown>[] {
        return adapter.requests.filter((r) => r.command === command).map((r) => r.arguments as Record<string, unknown>);
    }

    function lines(args: Record<string, unknown>): number[] {
        return ((args.breakpoints ?? []) as { line: number }[]).map((bp) => bp.line);
    }

    it("disabling a source breakpoint sends its file without it and stores the state", async () => {
        const [first] = model().addBreakpoints(MAIN, [{ lineNumber: 27 }, { lineNumber: 31 }]);
        model().addBreakpoints(LIST, [{ lineNumber: 90 }]);
        const adapter = await startStopped();

        await fx.service.enableOrDisableBreakpoints(false, first);

        expect(first.enabled).toBe(false);
        const requests = sent(adapter, "setBreakpoints");
        expect(requests).toHaveLength(1);
        expect(lines(requests[0])).toEqual([31]);
        expect(stored("debug.breakpoint")).toEqual(
            expect.arrayContaining([expect.objectContaining({ lineNumber: 27, enabled: false })]),
        );
    });

    it("the new state is stored before the adapter answers, its adapter data once it does", async () => {
        const [first] = model().addBreakpoints(MAIN, [{ lineNumber: 27 }, { lineNumber: 31 }]);
        const adapter = await startStopped();
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
        const storedAt = (line: number): unknown =>
            (stored("debug.breakpoint") as { lineNumber: number }[]).find((bp) => bp.lineNumber === line);

        // One breakpoint, then all at once.
        for (const [change, enabled] of [
            [() => fx.service.enableOrDisableBreakpoints(false, first), false],
            [() => fx.service.enableOrDisableBreakpoints(true), true],
        ] as const) {
            const done = change();
            await vi.waitFor(() => {
                expect(held).not.toHaveLength(0);
            });
            expect(storedAt(27)).toEqual(expect.objectContaining({ enabled }));
            for (const release of held.splice(0)) release();
            await done;
            expect(storedAt(31)).toEqual(expect.objectContaining({ adapterData: "cookie" }));
            adapter.breakpointAdapterData = undefined;
        }
    });

    it("all at once: every kind is sent again", async () => {
        model().addBreakpoints(MAIN, [{ lineNumber: 27 }]);
        await fx.service.addFunctionBreakpoint({ name: "accumulate" });
        const adapter = await startStopped();

        await fx.service.enableOrDisableBreakpoints(false);

        expect(model().getBreakpoints()[0].enabled).toBe(false);
        expect(model().getFunctionBreakpoints()[0].enabled).toBe(false);
        expect(lines(sent(adapter, "setBreakpoints")[0])).toEqual([]);
        expect(sent(adapter, "setFunctionBreakpoints")).toEqual([{ breakpoints: [] }]);
        expect(sent(adapter, "setExceptionBreakpoints")).toHaveLength(1);
    });

    it("each kind goes to its own request: function, data, instruction, exception", async () => {
        await fx.service.addFunctionBreakpoint({ name: "accumulate" });
        model().addDataBreakpoint({
            description: "sum",
            src: { type: DataBreakpointSetType.Variable, dataId: "sum" },
            canPersist: true,
            accessTypes: undefined,
            accessType: "write",
        });
        model().addInstructionBreakpoint({
            instructionReference: "0x10",
            offset: 0,
            canPersist: true,
            address: 16n,
        });
        const adapter = await startStopped();
        const filter = model().getExceptionBreakpoints()[0];

        await fx.service.enableOrDisableBreakpoints(false, model().getFunctionBreakpoints()[0]);
        await fx.service.enableOrDisableBreakpoints(false, model().getDataBreakpoints()[0]);
        await fx.service.enableOrDisableBreakpoints(false, model().getInstructionBreakpoints()[0]);
        await fx.service.enableOrDisableBreakpoints(true, filter);

        expect(adapter.requests.map((r) => r.command)).toEqual([
            "setFunctionBreakpoints",
            "setDataBreakpoints",
            "setInstructionBreakpoints",
            "setExceptionBreakpoints",
        ]);
        expect(sent(adapter, "setExceptionBreakpoints")[0]).toEqual({
            filters: [],
            filterOptions: [{ filterId: filter.filter }],
        });
    });

    it("a triggered breakpoint follows its trigger: enabled with it, disabled with it", async () => {
        const [trigger] = model().addBreakpoints(MAIN, [{ lineNumber: 27 }]);
        const [triggered] = model().addBreakpoints(LIST, [{ lineNumber: 90, triggeredBy: trigger.getId() }]);
        const [other] = model().addBreakpoints(LIST, [{ lineNumber: 95 }]);
        await fx.service.enableOrDisableBreakpoints(false, trigger);
        expect(triggered.enabled).toBe(false);
        expect(other.enabled).toBe(true);

        // Enabling the triggered one enables its trigger first.
        await fx.service.enableOrDisableBreakpoints(true, triggered);

        expect(trigger.enabled).toBe(true);
        expect(triggered.enabled).toBe(true);

        // A trigger that is gone: the breakpoint is enabled alone.
        const [orphan] = model().addBreakpoints(LIST, [{ lineNumber: 99, triggeredBy: "gone", enabled: false }]);
        await fx.service.enableOrDisableBreakpoints(true, orphan);
        expect(orphan.enabled).toBe(true);
    });

    it("a trigger moves only its own breakpoints, and only those not already in its state", async () => {
        const [trigger] = model().addBreakpoints(MAIN, [{ lineNumber: 27, enabled: false }]);
        const [triggered] = model().addBreakpoints(LIST, [{ lineNumber: 90, triggeredBy: trigger.getId() }]);
        const [orphan] = model().addBreakpoints(UTIL, [{ lineNumber: 5, triggeredBy: "gone", enabled: false }]);
        const adapter = await startStopped();
        /** The files sent since the last call. */
        const files = (): string[] =>
            sent(adapter, "setBreakpoints")
                .splice(0)
                .map((args) => (args.source as { path: string }).path)
                .sort();
        const step = async (enable: boolean, bp: IBreakpoint): Promise<string[]> => {
            adapter.requests.length = 0;
            await fx.service.enableOrDisableBreakpoints(enable, bp);
            return files();
        };

        // Disabling leaves the trigger alone, even a disabled one.
        expect(await step(false, triggered)).toEqual([LIST.fsPath]);
        // Enabling the trigger enables what it triggers, not the other disabled breakpoints.
        expect(await step(true, trigger)).toEqual([LIST.fsPath, MAIN.fsPath]);
        expect(orphan.enabled).toBe(false);
        // An enabled trigger is not enabled again.
        expect(await step(true, triggered)).toEqual([LIST.fsPath]);
        // A triggered breakpoint already disabled is not disabled again.
        await step(false, triggered);
        expect(await step(false, trigger)).toEqual([MAIN.fsPath]);
        // A trigger that is gone enables nothing else.
        expect(await step(true, orphan)).toEqual([UTIL.fsPath]);
        expect(trigger.enabled).toBe(false);
    });

    it("removing: one by id, several, all; a triggered breakpoint loses its trigger and its file is sent", async () => {
        const [a, b, c] = model().addBreakpoints(MAIN, [{ lineNumber: 27 }, { lineNumber: 31 }, { lineNumber: 40 }]);
        const remaining = (): number[] =>
            model()
                .getBreakpoints()
                .map((bp) => bp.lineNumber)
                .sort((x, y) => x - y);
        const [triggered] = model().addBreakpoints(LIST, [{ lineNumber: 90, triggeredBy: a.getId() }]);
        const [byB] = model().addBreakpoints(UTIL, [{ lineNumber: 5, triggeredBy: b.getId() }]);
        const adapter = await startStopped();

        await fx.service.removeBreakpoints(a.getId());

        expect(remaining()).toEqual([5, 31, 40, 90]);
        expect(triggered.triggeredBy).toBeUndefined();
        // The breakpoint another one triggers keeps its trigger, and its file is not sent.
        expect(byB.triggeredBy).toBe(b.getId());
        expect(sent(adapter, "setBreakpoints").map((args) => (args.source as { path: string }).path)).toEqual([
            MAIN.fsPath,
            LIST.fsPath,
        ]);

        await fx.service.removeBreakpoints([b.getId(), c.getId()]);
        expect(remaining()).toEqual([5, 90]);
        expect(byB.triggeredBy).toBeUndefined();

        await fx.service.removeBreakpoints();
        expect(remaining()).toEqual([]);
        expect(stored("debug.breakpoint")).toBeUndefined();
    });

    it("deactivating sends no breakpoint; reactivating sends them again", async () => {
        model().addBreakpoints(MAIN, [{ lineNumber: 27 }]);
        await fx.service.addFunctionBreakpoint({ name: "accumulate" });
        const adapter = await startStopped();

        await fx.service.setBreakpointsActivated(false);

        expect(model().areBreakpointsActivated()).toBe(false);
        expect(lines(sent(adapter, "setBreakpoints")[0])).toEqual([]);
        expect(sent(adapter, "setFunctionBreakpoints")).toEqual([{ breakpoints: [] }]);

        await fx.service.setBreakpointsActivated(true);
        expect(lines(sent(adapter, "setBreakpoints")[1])).toEqual([27]);
        expect(sent(adapter, "setFunctionBreakpoints")[1]).toEqual({ breakpoints: [{ name: "accumulate" }] });
    });

    it("a data breakpoint is stored before the adapter hears of it, and sent", async () => {
        const adapter = await startStopped();
        // The adapter's answer is held: what is stored by then is the breakpoint as added.
        const send = fx.service.addDataBreakpoint({
            description: "count",
            src: { type: DataBreakpointSetType.Variable, dataId: "1:count" },
            canPersist: true,
            accessTypes: undefined,
            accessType: "write",
        });
        const storedWhileSending = stored("debug.databreakpoint");
        await send;

        expect(storedWhileSending).toEqual([expect.objectContaining({ description: "count", accessType: "write" })]);
        expect(sent(adapter, "setDataBreakpoints").at(-1)).toMatchObject({
            breakpoints: [{ dataId: "1:count", accessType: "write" }],
        });
    });

    it("function breakpoints: added with a name, sent and stored; an empty one waits for its name", async () => {
        const adapter = await startStopped();

        await fx.service.addFunctionBreakpoint({ name: "accumulate" });

        expect(sent(adapter, "setFunctionBreakpoints")).toEqual([{ breakpoints: [{ name: "accumulate" }] }]);
        expect(stored("debug.functionbreakpoint")).toEqual([expect.objectContaining({ name: "accumulate" })]);

        await fx.service.addFunctionBreakpoint();
        expect(
            model()
                .getFunctionBreakpoints()
                .map((bp) => bp.name),
        ).toEqual(["accumulate", ""]);
        expect(sent(adapter, "setFunctionBreakpoints")).toHaveLength(1);

        await fx.service.removeFunctionBreakpoints(model().getFunctionBreakpoints()[0].getId());
        expect(
            model()
                .getFunctionBreakpoints()
                .map((bp) => bp.name),
        ).toEqual([""]);
        expect(sent(adapter, "setFunctionBreakpoints")).toHaveLength(2);
        expect(stored("debug.functionbreakpoint")).toEqual([expect.objectContaining({ name: "" })]);
    });

    it("data and instruction breakpoints are removed and sent", async () => {
        model().addDataBreakpoint({
            description: "sum",
            src: { type: DataBreakpointSetType.Variable, dataId: "sum" },
            canPersist: true,
            accessTypes: undefined,
            accessType: "write",
        });
        model().addInstructionBreakpoint({ instructionReference: "0x10", offset: 0, canPersist: true, address: 16n });
        const adapter = await startStopped();
        expect(stored("debug.databreakpoint")).toEqual([expect.objectContaining({ description: "sum" })]);

        await fx.service.removeDataBreakpoints();
        await fx.service.removeInstructionBreakpoints();

        expect(model().getDataBreakpoints()).toEqual([]);
        expect(model().getInstructionBreakpoints()).toEqual([]);
        expect(adapter.requests.map((r) => r.command)).toEqual(["setDataBreakpoints", "setInstructionBreakpoints"]);
        expect(stored("debug.databreakpoint")).toBeUndefined();
    });

    it("updates of a function, a data and an exception breakpoint are stored and sent; an instruction one is added", async () => {
        model().addFunctionBreakpoint({ name: "f" });
        model().addDataBreakpoint({
            description: "sum",
            src: { type: DataBreakpointSetType.Variable, dataId: "sum" },
            canPersist: true,
            accessTypes: undefined,
            accessType: "write",
        });
        const adapter = await startStopped();
        const [fn] = model().getFunctionBreakpoints();
        const [data] = model().getDataBreakpoints();
        const filter = model().getExceptionBreakpoints()[0];
        await fx.service.enableOrDisableBreakpoints(true, filter);
        adapter.requests.length = 0;

        // Each is stored by its own update: the next ones store the whole model again.
        await fx.service.updateFunctionBreakpoint(fn.getId(), { condition: "a", hitCondition: "2" });
        expect(stored("debug.functionbreakpoint")).toEqual([
            expect.objectContaining({ condition: "a", hitCondition: "2" }),
        ]);
        await fx.service.updateDataBreakpoint(data.getId(), { condition: "b" });
        expect(stored("debug.databreakpoint")).toEqual([expect.objectContaining({ condition: "b" })]);
        await fx.service.setExceptionBreakpointCondition(filter, "std::bad_alloc");
        await fx.service.addInstructionBreakpoint({
            instructionReference: "0x20",
            offset: 0,
            canPersist: false,
            address: 32n,
        });

        expect(adapter.requests.map((r) => r.command)).toEqual([
            "setFunctionBreakpoints",
            "setDataBreakpoints",
            "setExceptionBreakpoints",
            "setInstructionBreakpoints",
        ]);
        expect(sent(adapter, "setFunctionBreakpoints")[0].breakpoints).toEqual([
            { name: "f", condition: "a", hitCondition: "2" },
        ]);
        expect(sent(adapter, "setExceptionBreakpoints")[0].filterOptions).toEqual([
            { filterId: "cpp_throw", condition: "std::bad_alloc" },
        ]);
        expect(stored("debug.exceptionbreakpoint")).toEqual(
            expect.arrayContaining([expect.objectContaining({ filter: "cpp_throw", condition: "std::bad_alloc" })]),
        );
        expect(
            model()
                .getInstructionBreakpoints()
                .map((bp) => bp.instructionReference),
        ).toEqual(["0x20"]);
    });
});

// The editor's side: the gutter adds through the service, the positions it moves breakpoints to go to the adapter on
// the file's save, the stop opens the frame.
describe("DebugService and the editor", () => {
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

    async function startStopped(): Promise<SyntheticDebugAdapter> {
        expect(await fx.service.startDebugging(undefined, { ...SYNTHETIC_LAUNCH_CONFIG })).toBe(true);
        await vi.waitFor(() => {
            expect(fx.service.state).toBe(State.Stopped);
        });
        return factory.adapters[0];
    }

    function setBreakpointLines(adapter: SyntheticDebugAdapter): number[][] {
        return adapter.requests
            .filter((r) => r.command === "setBreakpoints")
            .map((r) => ((r.arguments as DebugProtocol.SetBreakpointsArguments).breakpoints ?? []).map((b) => b.line));
    }

    it("added breakpoints are sent, verified by the adapter and stored: a new window has them", async () => {
        const adapter = await startStopped();
        adapter.requests.length = 0;

        const [breakpoint] = await fx.service.addBreakpoints(MAIN, [{ lineNumber: 12 }]);

        expect(setBreakpointLines(adapter)).toEqual([[12]]);
        expect(breakpoint.verified).toBe(true);
        const again = createDebugServiceFixture({ state: fx.state });
        const restored = again.service.getModel().getBreakpoints();
        again.service.dispose();
        expect(restored.map((bp) => `${bp.uri.path}:${String(bp.lineNumber)}`)).toEqual([`${MAIN.path}:12`]);
    });

    it("a position the editor moved is stored at once and sent on the file's save, once", async () => {
        const [breakpoint] = await fx.service.addBreakpoints(MAIN, [{ lineNumber: 12 }]);
        const adapter = await startStopped();
        adapter.requests.length = 0;

        await fx.service.updateBreakpoints(MAIN, new Map([[breakpoint.getId(), { lineNumber: 14 }]]), true);

        expect(setBreakpointLines(adapter)).toEqual([]);
        const again = createDebugServiceFixture({ state: fx.state });
        const restored = again.service.getModel().getBreakpoints();
        again.service.dispose();
        expect(restored.map((bp) => bp.lineNumber)).toEqual([14]);

        fx.saveTextFile(LIST);
        fx.saveTextFile(MAIN);
        fx.saveTextFile(MAIN);
        await vi.waitFor(() => {
            expect(setBreakpointLines(adapter)).toEqual([[14]]);
        });
        // Upstream's `sourceModified`: the file changed under the session.
        expect(adapter.requests.find((r) => r.command === "setBreakpoints")?.arguments).toEqual(
            expect.objectContaining({ sourceModified: true }),
        );
    });

    it("an update that is not for the save is sent at once", async () => {
        const [breakpoint] = await fx.service.addBreakpoints(MAIN, [{ lineNumber: 12 }]);
        const adapter = await startStopped();
        adapter.requests.length = 0;

        adapter.breakpointAdapterData = "cookie";

        await fx.service.updateBreakpoints(MAIN, new Map([[breakpoint.getId(), { condition: "x" }]]), false);

        expect(setBreakpointLines(adapter)).toEqual([[12]]);
        // Stored again once the adapter answered, with its data.
        const key = [...fx.state.values.keys()].find((k) => k.endsWith("debug.breakpoint"));
        expect(fx.state.values.get(key ?? "")).toEqual([expect.objectContaining({ adapterData: "cookie" })]);
    });

    it("`debug.allowBreakpointsEverywhere` lets breakpoints into a language no extension contributes them to", async () => {
        expect(fx.service.canSetBreakpointsIn("plaintext")).toBe(false);
        await fx.configuration.updateValue("debug.allowBreakpointsEverywhere", true);
        expect(fx.service.canSetBreakpointsIn("plaintext")).toBe(true);
    });

    it("the stop opens the top frame without taking the focus by `debug.focusEditorOnBreak`", async () => {
        await fx.configuration.updateValue("debug.focusEditorOnBreak", false);
        await startStopped();
        await vi.waitFor(() => {
            expect(fx.openedFrames).toEqual([
                {
                    frame: "accumulate(std::vector<int> const&)@27",
                    preserveFocus: true,
                    sideBySide: false,
                },
            ]);
        });
    });

    it("by default the stop focuses the editor; a frame focused with options opens with them", async () => {
        await startStopped();
        await vi.waitFor(() => {
            expect(fx.openedFrames.map((f) => f.preserveFocus)).toEqual([false]);
        });
        const thread = fx.service.getViewModel().focusedThread;
        const frame = await vi.waitFor(() => {
            const found = thread?.getCallStack()[1];
            expect(found).toBeDefined();
            return found;
        });

        await fx.service.focusStackFrame(frame, undefined, undefined, { sideBySide: true, pinned: true });
        await fx.service.focusStackFrame(undefined, undefined, undefined, {});

        expect(fx.openedFrames.slice(1)).toEqual([
            { frame: "process(Config const&)@47", preserveFocus: true, sideBySide: true },
            // No frame given: the focused thread's top one, focus kept.
            { frame: "accumulate(std::vector<int> const&)@27", preserveFocus: true, sideBySide: false },
        ]);
    });

    it("a source that cannot be loaded is marked unavailable in the model", () => {
        const sourceIsNotAvailable = vi.spyOn(fx.service.getModel() as DebugModel, "sourceIsNotAvailable");
        fx.service.sourceIsNotAvailable(MAIN);
        expect(sourceIsNotAvailable).toHaveBeenCalledWith(MAIN);
    });

    it("can set breakpoints where the adapter manager says", () => {
        expect(fx.service.canSetBreakpointsIn("cpp")).toBe(false);
        fx.service.getAdapterManager().registerBreakpoints({ language: "cpp" });
        expect(fx.service.canSetBreakpointsIn("cpp")).toBe(true);
    });
});
