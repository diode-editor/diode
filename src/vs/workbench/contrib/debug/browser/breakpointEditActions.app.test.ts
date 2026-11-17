// The editing commands of the BREAKPOINTS rows on the whole workbench with the synthetic debugger: what each one
// asks in the quick input, what the row shows afterwards and what the adapter is sent — the condition of an exception
// filter, the condition, hit count and name of a function breakpoint, a data breakpoint on a range of memory and its
// address, the mode of a source breakpoint, the breakpoint widget of a source breakpoint opened from its row.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugViewletHarness, type IDebugViewletHarness } from "../../../../../TestUtils/debugViewletHarness.ts";
import { typeText } from "../../../../../TestUtils/domQueries.ts";
import type { SyntheticDebugAdapter } from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { Uri } from "../../../../base/common/uri.ts";
import {
    type QuickInputComponent,
    QuickInputComponentDIToken,
} from "../../../browser/parts/quickinput/quickInputComponent.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { DataBreakpointSetType, type IDebugModel } from "../common/debug.ts";

import { DebugServiceDIToken } from "./debugService.ts";

const SOURCE = Array.from({ length: 40 }, (_, i) => `int line${String(i + 1)} = ${String(i + 1)};`).join("\n");

describe("BREAKPOINTS: the editing commands of the rows", () => {
    let root: string;
    let main: string;
    let t: IDebugViewletHarness;
    let adapter: SyntheticDebugAdapter;

    beforeEach(async () => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "diode-breakpoint-edits-")));
        main = path.join(root, "src", "main.cpp");
        fs.mkdirSync(path.dirname(main));
        fs.writeFileSync(main, SOURCE);
        t = await createDebugViewletHarness(root, root);
        const factory = await t.startStopped();
        adapter = factory.adapters[0];
    });

    afterEach(async () => {
        await t.dispose();
        fs.rmSync(root, { recursive: true, force: true });
    });

    function model(): IDebugModel {
        return t.h.container.get(DebugServiceDIToken).getModel();
    }

    /** The arguments of the last request of a command to the adapter. */
    async function lastSent(command: string): Promise<Record<string, unknown>> {
        let sent: Record<string, unknown> | undefined;
        await vi.waitFor(() => {
            sent = adapter.requests.findLast((r) => r.command === command)?.arguments as Record<string, unknown>;
            expect(sent).toBeDefined();
        });
        return sent!;
    }

    function quickInput(): QuickInputComponent {
        return t.h.container.get(QuickInputComponentDIToken);
    }

    /** Clears the quick input's line. */
    function clear(): void {
        for (const _ of quickInput().view.getQuery()) t.h.testApp.sendKey("Backspace");
    }

    /**
     * Runs a row's command, waits for the quick input with `value` in its line or `placeholder` for an empty one,
     * replaces its value with `answer`, accepts.
     */
    async function answer(
        command: string,
        arg: unknown,
        expected: { value?: string; placeholder?: string },
        typed: string,
    ): Promise<void> {
        const run = t.h.commands.execute(command, arg);
        await vi.waitFor(() => {
            expect(quickInput().isOpen()).toBe(true);
        });
        expect(quickInput().view.getQuery()).toBe(expected.value ?? "");
        if (expected.placeholder !== undefined) expect(quickInput().view.placeholder).toBe(expected.placeholder);
        clear();
        typeText(t.h.testApp, typed);
        t.h.testApp.sendKey("Enter");
        await run;
    }

    it("Edit Condition... of an exception filter: its own description as the placeholder, the condition sent with it", async () => {
        const filter = model()
            .getExceptionBreakpoints()
            .find((bp) => bp.filter === "cpp_throw");
        await t.h.container.get(DebugServiceDIToken).enableOrDisableBreakpoints(true, filter);
        await answer(
            "debug.editBreakpoint",
            filter,
            { placeholder: "Comma-separated list of exception types" },
            "std::out_of_range",
        );

        await vi.waitFor(() => {
            expect(t.screen()).toMatch(/C\+\+: on throw +std::out_of_range/u);
        });
        expect((await lastSent("setExceptionBreakpoints")).filterOptions).toEqual([
            { filterId: "cpp_throw", condition: "std::out_of_range" },
        ]);

        // An empty condition is none.
        await answer("debug.editBreakpoint", filter, { value: "std::out_of_range" }, "");
        expect(filter?.condition).toBeUndefined();
    });

    it("a function breakpoint: Edit Condition..., Edit Hit Count... and its name, each written to the row and sent", async () => {
        await t.h.container.get(DebugServiceDIToken).addFunctionBreakpoint({ name: "accumulate" });
        const [breakpoint] = model().getFunctionBreakpoints();

        await answer(
            "debug.editBreakpoint",
            breakpoint,
            { placeholder: "Break when expression evaluates to true" },
            "n > 1",
        );
        await answer(
            "debug.editFunctionBreakpointHitCount",
            breakpoint,
            { placeholder: "Break when hit count is met" },
            "3",
        );
        await answer(
            "debug.editFunctionBreakpoint",
            breakpoint,
            { value: "accumulate", placeholder: "Function to break on" },
            "process",
        );

        await vi.waitFor(() => {
            expect(t.screen()).toMatch(/process +Condition: n > 1 \| Hit Count: 3/u);
        });
        expect((await lastSent("setFunctionBreakpoints")).breakpoints).toEqual([
            { name: "process", condition: "n > 1", hitCondition: "3" },
        ]);
    });

    it("Add Data Breakpoint at Address: a range, the access type, the row; Edit Address... replaces it", async () => {
        const run = t.h.commands.execute("workbench.debug.viewlet.action.addDataBreakpointOnAddress");
        await vi.waitFor(() => {
            expect(quickInput().isOpen()).toBe(true);
        });
        expect(quickInput().view.prompt).toBe("Enter a memory range in which to break");
        typeText(t.h.testApp, "zz");
        await vi.waitFor(() => {
            expect(t.screen()).toContain('Number must be a decimal integer or hex value starting with "0x", got zz');
        });
        clear();
        typeText(t.h.testApp, "0x1000 + 4");
        t.h.testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(t.screen()).toContain("Select the access type to monitor");
        });
        t.h.testApp.sendKey("ArrowDown");
        t.h.testApp.sendKey("Enter");
        await run;

        await vi.waitFor(() => {
            expect(t.screen()).toMatch(/0x1000 \(4 bytes\) +Write/u);
        });
        expect((await lastSent("setDataBreakpoints")).breakpoints).toEqual([
            { dataId: "0x1000+4", accessType: "write" },
        ]);

        const [breakpoint] = model().getDataBreakpoints();
        const edit = t.h.commands.execute("workbench.debug.viewlet.action.editDataBreakpointOnAddress", breakpoint);
        await vi.waitFor(() => {
            expect(quickInput().isOpen()).toBe(true);
        });
        expect(quickInput().view.getQuery()).toBe("0x1000 + 4");
        clear();
        typeText(t.h.testApp, "0x2000 - 0x2010");
        t.h.testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(t.screen()).toContain("Select the access type to monitor");
        });
        t.h.testApp.sendKey("Enter");
        await edit;
        await vi.waitFor(() => {
            expect(t.screen()).toMatch(/0x2000 \(16 bytes\) +Read/u);
        });
        expect(model().getDataBreakpoints()).toHaveLength(1);
    });

    it("a data breakpoint's Edit Condition... and Edit Hit Count... go into the row", async () => {
        await t.h.commands.execute("workbench.view.debug");
        const service = t.h.container.get(DebugServiceDIToken);
        await service.addDataBreakpoint({
            description: "count",
            src: { type: DataBreakpointSetType.Variable, dataId: "1:count" },
            canPersist: false,
            accessTypes: undefined,
            accessType: "write",
        });
        const [breakpoint] = model().getDataBreakpoints();
        await answer(
            "debug.editBreakpoint",
            breakpoint,
            { placeholder: "Break when expression evaluates to true" },
            "count > 2",
        );
        await answer(
            "debug.editFunctionBreakpointHitCount",
            breakpoint,
            { placeholder: "Break when hit count is met" },
            "4",
        );
        await vi.waitFor(() => {
            expect(t.screen()).toMatch(/count +Write +Condition: count > 2 \| Hit Count: 4/u);
        });
        expect((await lastSent("setDataBreakpoints")).breakpoints).toEqual([
            { dataId: "1:count", accessType: "write", condition: "count > 2", hitCondition: "4" },
        ]);
    });

    it("Edit Mode... picks among the adapter's modes: the badge names it, the adapter gets it", async () => {
        const service = t.h.container.get(DebugServiceDIToken);
        await service.addBreakpoints(Uri.file(main), [{ lineNumber: 5 }]);
        const [breakpoint] = model().getBreakpoints();
        const run = t.h.commands.execute("debug.editBreakpointMode", breakpoint);
        await vi.waitFor(() => {
            expect(t.screen()).toContain("Select Breakpoint Mode");
        });
        expect(t.screen()).toContain("A debug register of the CPU");
        t.h.testApp.sendKey("ArrowDown");
        t.h.testApp.sendKey("Enter");
        await run;

        await vi.waitFor(() => {
            expect(t.screen()).toContain("Hardware: 5");
        });
        expect((await lastSent("setBreakpoints")).breakpoints).toEqual([{ line: 5, mode: "hardware" }]);
    });

    it("Edit Condition... of a source breakpoint opens its file at the line and the breakpoint widget on its condition", async () => {
        const service = t.h.container.get(DebugServiceDIToken);
        await service.addBreakpoints(Uri.file(main), [{ lineNumber: 7, condition: "x" }]);
        const [breakpoint] = model().getBreakpoints();
        await answer("debug.editBreakpoint", breakpoint, { value: "x" }, "y");

        expect(t.h.container.get(EditorServiceDIToken).getActiveEditor()?.uri.fsPath).toBe(main);
        expect(
            model()
                .getBreakpoints()
                .map((bp) => bp.condition),
        ).toEqual(["y"]);
        expect((await lastSent("setBreakpoints")).breakpoints).toEqual([{ line: 7, condition: "y" }]);
    });
});
