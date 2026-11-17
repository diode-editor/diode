// What the workbench tests of the BREAKPOINTS editing commands do not reach: upstream's parsing of a memory range,
// the data breakpoint on an address without a session, with an adapter that fails or knows no such range, with one
// access type, and cancelled; the commands on rows of other kinds.

import { describe, expect, it } from "vitest";

import { testDebugService } from "../../../../../TestUtils/debugSessionFixture.ts";
import { createMockDebugModel, mockSession } from "../../../../../TestUtils/mockDebug.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import { NotificationServiceDIToken } from "../../../services/notification/browser/notificationService.ts";
import type { IDataBreakpointInfoResponse, IDebugSession } from "../common/debug.ts";
import type { DebugModel } from "../common/debugModel.ts";

import {
    addDataBreakpointOnAddressAction,
    editBreakpointConditionAction,
    editBreakpointModeAction,
    editFunctionBreakpointAction,
    editFunctionBreakpointHitCountAction,
    parseAddress,
} from "./breakpointEditActions.ts";
import { DebugServiceDIToken } from "./debugService.ts";

describe("parseAddress", () => {
    it("a start and a count of bytes, a start and an end, a start alone is one byte", () => {
        expect(parseAddress("0x1000 + 0x10", true)).toEqual({ address: "0x1000", bytes: 16 });
        expect(parseAddress("4096 +8", true)).toEqual({ address: "0x1000", bytes: 8 });
        expect(parseAddress("0x1000 - 0x1010", true)).toEqual({ address: "0x1000", bytes: 16 });
        expect(parseAddress("0x1000", true)).toEqual({ address: "0x1000", bytes: 1 });
    });

    it("errors: no number, an end before the start, a number that does not parse", () => {
        expect(parseAddress("", true)).toEqual({
            error: 'Address should be a range of numbers the form "[Start] - [End]" or "[Start] + [Bytes]"',
        });
        expect(parseAddress("0x20 - 0x10", true)).toEqual({ error: "End (0x10) should be greater than Start (0x20)" });
        expect(parseAddress("zz", false)).toEqual({
            error: 'Number must be a decimal integer or hex value starting with "0x", got zz',
        });
        expect(parseAddress("0x10 + zz", false)).toEqual({
            error: 'Number must be a decimal integer or hex value starting with "0x", got zz',
        });
        expect(parseAddress("12g", true)).toEqual({
            error: 'Number must be a decimal integer or hex value starting with "0x", got 12g',
        });
    });

    it("while typing: no range yet, only the errors", () => {
        expect(parseAddress("0x10 + 4", false)).toBeUndefined();
    });
});

interface IFakes {
    readonly accessor: ServiceAccessor;
    readonly inputs: unknown[];
    readonly picks: unknown[];
    readonly shown: unknown[];
    readonly service: ReturnType<typeof testDebugService>;
}

function fakes(answers: { input?: string; pick?: number }, session?: IDebugSession): IFakes {
    const model = createMockDebugModel({ add: (o) => o });
    const service = testDebugService(model);
    if (session) service.viewModel.setFocus(undefined, undefined, session, false);
    const inputs: unknown[] = [];
    const picks: unknown[] = [];
    const shown: unknown[] = [];
    const quickInput = {
        input: (opts: unknown) => {
            inputs.push(opts);
            return Promise.resolve(answers.input);
        },
        quickPick: (opts: { items: readonly unknown[] }) => {
            picks.push(opts);
            return Promise.resolve(answers.pick === undefined ? undefined : opts.items[answers.pick]);
        },
    };
    const notifications = { show: (message: unknown) => shown.push(message) };
    const accessor = {
        get: (token: unknown) =>
            token === QuickInputServiceDIToken
                ? quickInput
                : token === NotificationServiceDIToken
                  ? notifications
                  : token === DebugServiceDIToken
                    ? service
                    : undefined,
    } as unknown as ServiceAccessor;
    return { accessor, inputs, picks, shown, service };
}

function sessionAnswering(info: IDataBreakpointInfoResponse | Error): IDebugSession {
    return mockSession({
        getId: () => "s",
        capabilities: {},
        dataBytesBreakpointInfo: () => (info instanceof Error ? Promise.reject(info) : Promise.resolve(info)),
    });
}

describe("Add Data Breakpoint at Address", () => {
    it("without a session asks nothing", async () => {
        const f = fakes({ input: "0x10" });
        await addDataBreakpointOnAddressAction.run(f.accessor);
        expect(f.inputs).toEqual([]);
    });

    it("cancelled, or with a range that does not parse in the end, adds nothing; the error is told", async () => {
        const session = sessionAnswering({ dataId: "x", description: "x" });
        let f = fakes({}, session);
        await addDataBreakpointOnAddressAction.run(f.accessor);
        expect(f.inputs).toHaveLength(1);
        f = fakes({ input: "12g" }, session);
        await addDataBreakpointOnAddressAction.run(f.accessor);
        expect(f.shown).toEqual([
            {
                severity: "error",
                message: 'Number must be a decimal integer or hex value starting with "0x", got 12g',
                modal: false,
                items: [],
            },
        ]);
        expect(f.service.addDataBreakpoint).not.toHaveBeenCalled();
    });

    it("an adapter that fails is told; one without a data id adds nothing", async () => {
        let f = fakes({ input: "0x10" }, sessionAnswering(new Error("no memory")));
        await addDataBreakpointOnAddressAction.run(f.accessor);
        expect(f.shown).toEqual([
            { severity: "error", message: "Failed to set data breakpoint at 0x10: no memory", modal: false, items: [] },
        ]);
        f = fakes({ input: "0x10" }, sessionAnswering({ dataId: null, description: "none" }));
        await addDataBreakpointOnAddressAction.run(f.accessor);
        expect(f.shown).toEqual([]);
        expect(f.service.addDataBreakpoint).not.toHaveBeenCalled();
    });

    it("one access type or none is a write without asking; a pick of several cancelled adds nothing", async () => {
        const session = sessionAnswering({ dataId: "d", description: "0x10", accessTypes: ["read"] });
        let f = fakes({ input: "0x10 + 2" }, session);
        await addDataBreakpointOnAddressAction.run(f.accessor);
        expect(f.picks).toEqual([]);
        expect(f.service.addDataBreakpoint).toHaveBeenCalledWith({
            description: "0x10",
            src: { type: 1, address: "0x10", bytes: 2 },
            canPersist: true,
            accessTypes: ["read"],
            accessType: "write",
            initialSessionData: { session, dataId: "d" },
        });

        f = fakes(
            { input: "0x10" },
            sessionAnswering({ dataId: "d", description: "", accessTypes: ["read", "write"] }),
        );
        await addDataBreakpointOnAddressAction.run(f.accessor);
        expect(f.picks).toHaveLength(1);
        expect(f.service.addDataBreakpoint).not.toHaveBeenCalled();
    });
});

describe("the editing commands on rows they do not edit", () => {
    it("do nothing with no row or a row of another kind", async () => {
        const f = fakes({ input: "x", pick: 0 });
        await editBreakpointConditionAction.run(f.accessor, undefined);
        await editFunctionBreakpointAction.run(f.accessor, {});
        await editFunctionBreakpointHitCountAction.run(f.accessor, {});
        await editBreakpointModeAction.run(f.accessor, {});
        expect(f.inputs).toEqual([]);
        expect(f.picks).toEqual([]);
    });

    it("Escape in an input or the mode list changes nothing", async () => {
        const f = fakes({});
        (f.service.getModel() as DebugModel).addFunctionBreakpoint({ name: "f" });
        const [fn] = (f.service.getModel() as DebugModel).getFunctionBreakpoints();
        await editFunctionBreakpointHitCountAction.run(f.accessor, fn);
        (f.service.getModel() as DebugModel).addBreakpoints(Uri.file("/w/a.c"), [{ lineNumber: 1 }]);
        const [bp] = (f.service.getModel() as DebugModel).getBreakpoints();
        await editBreakpointModeAction.run(f.accessor, bp);
        expect(f.service.updateFunctionBreakpoint).not.toHaveBeenCalled();
        expect(f.service.updateBreakpoints).not.toHaveBeenCalled();
    });
});

describe("Edit Mode...", () => {
    const modes = (kind: string): DebugProtocol.BreakpointMode[] => [
        { mode: "a", label: "A", appliesTo: [kind] },
        { mode: "b", label: "B", description: "the second", appliesTo: [kind] },
    ];

    it("of an exception filter sets it on the filter and sends the filters again", async () => {
        const f = fakes({ pick: 1 });
        const model = f.service.getModel() as DebugModel;
        model.registerBreakpointModes("t", modes("exception"));
        model.setExceptionBreakpointsForSession("s", [{ filter: "all", label: "All" }]);
        const [filter] = model.getExceptionBreakpoints();
        model.setExceptionBreakpointCondition(filter, "c");
        await editBreakpointModeAction.run(f.accessor, filter);

        expect(f.picks).toEqual([
            {
                placeholder: "Select Breakpoint Mode",
                items: [{ label: "A" }, { label: "B", description: "the second" }],
            },
        ]);
        expect([filter.mode, filter.modeLabel]).toEqual(["b", "B"]);
        expect(f.service.setExceptionBreakpointCondition).toHaveBeenCalledWith(filter, "c");
    });

    it("of an instruction breakpoint replaces it with one in the mode", async () => {
        const f = fakes({ pick: 0 });
        const model = f.service.getModel() as DebugModel;
        model.registerBreakpointModes("t", modes("instruction"));
        model.addInstructionBreakpoint({ instructionReference: "0x10", offset: 2, canPersist: false, address: 18n });
        const [instruction] = model.getInstructionBreakpoints();
        await editBreakpointModeAction.run(f.accessor, instruction);

        expect(f.service.removeInstructionBreakpoints).toHaveBeenCalledWith("0x10", 2);
        expect(f.service.addInstructionBreakpoint).toHaveBeenCalledWith(
            expect.objectContaining({ instructionReference: "0x10", offset: 2, mode: "a", modeLabel: "A" }),
        );
    });
});
