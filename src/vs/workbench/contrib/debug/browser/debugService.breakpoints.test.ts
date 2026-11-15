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
import { State } from "../common/debug.ts";
import type { DebugModel } from "../common/debugModel.ts";

const MAIN = Uri.file(`${SYNTHETIC_PROGRAM_ROOT}/src/main.cpp`);
const LIST = Uri.file(`${SYNTHETIC_PROGRAM_ROOT}/src/list.cpp`);

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
            src: { type: "variable", dataId: "sum" },
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
        expect(sent(adapter, "setExceptionBreakpoints")[0]).toEqual({ filters: [filter.filter] });
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
    });

    it("removing: one by id, several, all; a triggered breakpoint loses its trigger and its file is sent", async () => {
        const [a, b, c] = model().addBreakpoints(MAIN, [{ lineNumber: 27 }, { lineNumber: 31 }, { lineNumber: 40 }]);
        const remaining = (): number[] =>
            model()
                .getBreakpoints()
                .map((bp) => bp.lineNumber)
                .sort((x, y) => x - y);
        const [triggered] = model().addBreakpoints(LIST, [{ lineNumber: 90, triggeredBy: a.getId() }]);
        const adapter = await startStopped();

        await fx.service.removeBreakpoints(a.getId());

        expect(remaining()).toEqual([31, 40, 90]);
        expect(triggered.triggeredBy).toBeUndefined();
        expect(sent(adapter, "setBreakpoints").map((args) => (args.source as { path: string }).path)).toEqual([
            MAIN.fsPath,
            LIST.fsPath,
        ]);

        await fx.service.removeBreakpoints([b.getId(), c.getId()]);
        expect(remaining()).toEqual([90]);

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

    it("function breakpoints: added with a name, sent and stored; an empty one waits for its name", async () => {
        const adapter = await startStopped();

        await fx.service.addFunctionBreakpoint({ name: "accumulate" });

        expect(sent(adapter, "setFunctionBreakpoints")).toEqual([{ breakpoints: [{ name: "accumulate" }] }]);
        expect(stored("debug.functionbreakpoint")).toEqual([expect.objectContaining({ name: "accumulate" })]);

        await fx.service.addFunctionBreakpoint();
        expect(model().getFunctionBreakpoints().map((bp) => bp.name)).toEqual(["accumulate", ""]);
        expect(sent(adapter, "setFunctionBreakpoints")).toHaveLength(1);

        await fx.service.removeFunctionBreakpoints(model().getFunctionBreakpoints()[0].getId());
        expect(model().getFunctionBreakpoints().map((bp) => bp.name)).toEqual([""]);
        expect(sent(adapter, "setFunctionBreakpoints")).toHaveLength(2);
        expect(stored("debug.functionbreakpoint")).toEqual([expect.objectContaining({ name: "" })]);
    });

    it("data and instruction breakpoints are removed and sent", async () => {
        model().addDataBreakpoint({
            description: "sum",
            src: { type: "variable", dataId: "sum" },
            canPersist: true,
            accessTypes: undefined,
            accessType: "write",
        });
        model().addInstructionBreakpoint({ instructionReference: "0x10", offset: 0, canPersist: true, address: 16n });
        const adapter = await startStopped();

        await fx.service.removeDataBreakpoints();
        await fx.service.removeInstructionBreakpoints();

        expect(model().getDataBreakpoints()).toEqual([]);
        expect(model().getInstructionBreakpoints()).toEqual([]);
        expect(adapter.requests.map((r) => r.command)).toEqual(["setDataBreakpoints", "setInstructionBreakpoints"]);
        expect(stored("debug.databreakpoint")).toBeUndefined();
    });
});
