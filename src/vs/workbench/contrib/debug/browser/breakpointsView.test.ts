// Upstream's choice of a breakpoint's icon by its kind and state (`getBreakpointMessageAndIcon`).

import { describe, expect, it } from "vitest";

import { createMockDebugModel } from "../../../../../TestUtils/mockDebug.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { DataBreakpointSetType, type IBaseBreakpoint, State } from "../common/debug.ts";
import type { DebugModel } from "../common/debugModel.ts";

import { getBreakpointIcon } from "./breakpointsView.ts";

const FILE = Uri.file("/w/main.cpp");

/** The adapter's word on a breakpoint in session `s` with the given capabilities. */
function verify(model: DebugModel, bp: IBaseBreakpoint, verified: boolean, capabilities = {}): void {
    model.setBreakpointSessionData("s", capabilities, new Map([[bp.getId(), { verified }]]));
}

describe("getBreakpointIcon", () => {
    it("a source breakpoint: plain, disabled, deactivated, unverified only while debugging", () => {
        const model = createMockDebugModel({ add: (o) => o });
        const [bp] = model.addBreakpoints(FILE, [{ lineNumber: 1 }]);

        expect(getBreakpointIcon(State.Inactive, true, bp, model)).toBe("debug-breakpoint");
        expect(getBreakpointIcon(State.Inactive, false, bp, model)).toBe("debug-breakpoint-disabled");
        model.setEnablement(bp, false);
        expect(getBreakpointIcon(State.Inactive, true, bp, model)).toBe("debug-breakpoint-disabled");
        model.setEnablement(bp, true);

        verify(model, bp, false);
        expect(getBreakpointIcon(State.Inactive, true, bp, model)).toBe("debug-breakpoint");
        expect(getBreakpointIcon(State.Initializing, true, bp, model)).toBe("debug-breakpoint");
        expect(getBreakpointIcon(State.Running, true, bp, model)).toBe("debug-breakpoint-unverified");
        expect(getBreakpointIcon(State.Stopped, true, bp, model)).toBe("debug-breakpoint-unverified");
    });

    it("a condition, a hit count or a trigger makes it conditional; a log message a logpoint", () => {
        const model = createMockDebugModel({ add: (o) => o });
        const [trigger] = model.addBreakpoints(FILE, [{ lineNumber: 1 }]);
        const [condition, hit, triggered, log] = model.addBreakpoints(FILE, [
            { lineNumber: 2, condition: "i > 3" },
            { lineNumber: 3, hitCondition: "5" },
            { lineNumber: 4, triggeredBy: trigger.getId() },
            { lineNumber: 5, logMessage: "i = {i}" },
        ]);
        const [orphan] = model.addBreakpoints(FILE, [{ lineNumber: 6, triggeredBy: "gone" }]);

        expect(getBreakpointIcon(State.Inactive, true, condition, model)).toBe("debug-breakpoint-conditional");
        expect(getBreakpointIcon(State.Inactive, true, hit, model)).toBe("debug-breakpoint-conditional");
        expect(getBreakpointIcon(State.Inactive, true, triggered, model)).toBe("debug-breakpoint-conditional");
        expect(getBreakpointIcon(State.Inactive, true, log, model)).toBe("debug-breakpoint-log");
        // A trigger that is no more: a plain breakpoint.
        expect(getBreakpointIcon(State.Inactive, true, orphan, model)).toBe("debug-breakpoint");
        expect(getBreakpointIcon(State.Inactive, false, log, model)).toBe("debug-breakpoint-log-disabled");
        verify(model, log, false);
        expect(getBreakpointIcon(State.Stopped, true, log, model)).toBe("debug-breakpoint-log-unverified");
    });

    it("a feature the adapter lacks: unsupported; a triggered breakpoint not sent yet: pending", () => {
        const model = createMockDebugModel({ add: (o) => o });
        const [trigger] = model.addBreakpoints(FILE, [{ lineNumber: 1 }]);
        const [condition, log, triggered] = model.addBreakpoints(FILE, [
            { lineNumber: 2, condition: "i > 3" },
            { lineNumber: 3, logMessage: "i = {i}" },
            { lineNumber: 4, triggeredBy: trigger.getId() },
        ]);
        verify(model, condition, true);
        verify(model, log, true, { supportsLogPoints: true });

        expect(getBreakpointIcon(State.Stopped, true, condition, model)).toBe("debug-breakpoint-unsupported");
        expect(getBreakpointIcon(State.Stopped, true, log, model)).toBe("debug-breakpoint-log");
        expect(getBreakpointIcon(State.Stopped, true, triggered, model)).toBe("debug-breakpoint-pending");
        expect(getBreakpointIcon(State.Inactive, true, triggered, model)).toBe("debug-breakpoint-conditional");
    });

    it("function, data and instruction breakpoints: their own icons, unverified where the adapter lacks them", () => {
        const model = createMockDebugModel({ add: (o) => o });
        const fn = model.addFunctionBreakpoint({ name: "main" });
        model.addDataBreakpoint({
            description: "sum",
            src: { type: DataBreakpointSetType.Variable, dataId: "sum" },
            canPersist: true,
            accessTypes: undefined,
            accessType: "write",
            // A log message does not make a data breakpoint a logpoint.
            logMessage: "x",
        });
        const data = model.getDataBreakpoints()[0];
        model.addInstructionBreakpoint({ instructionReference: "0x10", offset: 0, canPersist: true, address: 16n });
        const instruction = model.getInstructionBreakpoints()[0];

        expect(getBreakpointIcon(State.Inactive, true, fn, model)).toBe("debug-breakpoint-function");
        expect(getBreakpointIcon(State.Inactive, true, data, model)).toBe("debug-breakpoint-data");
        expect(getBreakpointIcon(State.Inactive, true, instruction, model)).toBe("debug-breakpoint");
        expect(getBreakpointIcon(State.Inactive, false, fn, model)).toBe("debug-breakpoint-function-disabled");
        expect(getBreakpointIcon(State.Inactive, false, data, model)).toBe("debug-breakpoint-data-disabled");

        for (const bp of [fn, data, instruction]) verify(model, bp, true);
        expect(getBreakpointIcon(State.Stopped, true, fn, model)).toBe("debug-breakpoint-function-unverified");
        expect(getBreakpointIcon(State.Stopped, true, data, model)).toBe("debug-breakpoint-data-unverified");
        expect(getBreakpointIcon(State.Stopped, true, instruction, model)).toBe("debug-breakpoint-unverified");

        const supported = {
            supportsFunctionBreakpoints: true,
            supportsDataBreakpoints: true,
            supportsInstructionBreakpoints: true,
        };
        for (const bp of [fn, data, instruction]) verify(model, bp, true, supported);
        expect(getBreakpointIcon(State.Stopped, true, fn, model)).toBe("debug-breakpoint-function");
        expect(getBreakpointIcon(State.Stopped, true, data, model)).toBe("debug-breakpoint-data");
        expect(getBreakpointIcon(State.Stopped, true, instruction, model)).toBe("debug-breakpoint");
    });
});
