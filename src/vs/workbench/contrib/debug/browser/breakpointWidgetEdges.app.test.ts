// The breakpoint widget's edges on the whole workbench with the synthetic debugger: Escape writes nothing, editing
// starts on the breakpoint's kind as upstream's widget does, a triggered breakpoint switched to another kind stops
// waiting, the Wait for Breakpoint list leaves out the breakpoint itself and logpoints, the Mode row of a session with
// two modes shows the breakpoint's mode and an edit keeps it.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugViewletHarness, type IDebugViewletHarness } from "../../../../../TestUtils/debugViewletHarness.ts";
import { typeText } from "../../../../../TestUtils/domQueries.ts";
import { Uri } from "../../../../base/common/uri.ts";
import {
    type QuickInputComponent,
    QuickInputComponentDIToken,
} from "../../../browser/parts/quickinput/quickInputComponent.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import type { IBreakpoint } from "../common/debug.ts";

import { DebugServiceDIToken } from "./debugService.ts";

const SOURCE = Array.from({ length: 40 }, (_, i) => `int line${String(i + 1)} = ${String(i + 1)};`).join("\n");

describe("The breakpoint widget: Escape, the kind it starts on, Wait for Breakpoint", () => {
    let root: string;
    let main: string;
    let t: IDebugViewletHarness;

    beforeEach(async () => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "diode-widget-edges-")));
        main = path.join(root, "src", "main.cpp");
        fs.mkdirSync(path.dirname(main));
        fs.writeFileSync(main, SOURCE);
        t = await createDebugViewletHarness(root, root);
        t.registerDebugger();
        const editors = t.h.container.get(EditorServiceDIToken);
        editors.openFile(main);
        const editor = editors.getActiveEditor();
        if (editor === null) throw new Error("main.cpp did not open");
        t.h.container.get(DebugServiceDIToken).getAdapterManager().registerBreakpoints({ language: editor.languageId });
        await new Promise((resolve) => setTimeout(resolve));
    });

    afterEach(async () => {
        await t.dispose();
        fs.rmSync(root, { recursive: true, force: true });
    });

    function breakpoints(): readonly IBreakpoint[] {
        return t.h.container.get(DebugServiceDIToken).getModel().getBreakpoints();
    }

    function quickInput(): QuickInputComponent {
        return t.h.container.get(QuickInputComponentDIToken);
    }

    function goTo(line: number): void {
        t.h.container
            .get(EditorServiceDIToken)
            .getActiveEditor()
            ?.goToPosition(line - 1, 0);
    }

    /** Runs an editor command that opens the widget and waits for its kinds; the caller answers it. */
    async function openWidget(command: string): Promise<{ run: Promise<unknown> }> {
        await new Promise((resolve) => setTimeout(resolve));
        const run = t.h.commands.execute(command);
        await vi.waitFor(() => {
            expect(t.screen()).toContain("Wait for Breakpoint");
        });
        return { run };
    }

    async function addWith(line: number, command: string, keys: readonly string[], value: string): Promise<void> {
        goTo(line);
        const { run } = await openWidget(command);
        for (const key of keys) t.h.testApp.sendKey(key);
        typeText(t.h.testApp, value);
        t.h.testApp.sendKey("Enter");
        await run;
    }

    it("Escape after typing a condition adds no breakpoint", async () => {
        goTo(10);
        const { run } = await openWidget("editor.debug.action.conditionalBreakpoint");
        typeText(t.h.testApp, "x > 1");
        t.h.testApp.sendKey("Escape");
        await run;
        expect(breakpoints()).toEqual([]);
    });

    it("Escape while editing keeps the breakpoint's condition", async () => {
        await addWith(10, "editor.debug.action.conditionalBreakpoint", [], "x > 1");
        goTo(10);
        const { run } = await openWidget("editor.debug.action.editBreakpoint");
        typeText(t.h.testApp, "23");
        t.h.testApp.sendKey("Escape");
        await run;
        expect(breakpoints().map((bp) => bp.condition)).toEqual(["x > 1"]);
    });

    it("editing a breakpoint with only a hit count starts on Hit Count with it in the line", async () => {
        await addWith(10, "editor.debug.action.conditionalBreakpoint", ["ArrowDown"], ">= 5");
        expect(breakpoints().map((bp) => [bp.condition, bp.hitCondition])).toEqual([[undefined, ">= 5"]]);
        goTo(10);
        const { run } = await openWidget("editor.debug.action.editBreakpoint");
        expect(quickInput().view.getQuery()).toBe(">= 5");
        t.h.testApp.sendKey("Escape");
        await run;
    });

    it("editing a logpoint starts on Log Message with its message in the line", async () => {
        await addWith(10, "editor.debug.action.addLogPoint", [], "x={x}");
        goTo(10);
        const { run } = await openWidget("editor.debug.action.editBreakpoint");
        expect(quickInput().view.getQuery()).toBe("x={x}");
        t.h.testApp.sendKey("Escape");
        await run;
    });

    it("typing a hit count on an edited conditional breakpoint keeps its condition", async () => {
        await addWith(10, "editor.debug.action.conditionalBreakpoint", [], "x > 1");
        goTo(10);
        const { run } = await openWidget("editor.debug.action.editBreakpoint");
        t.h.testApp.sendKey("ArrowDown");
        typeText(t.h.testApp, "3");
        t.h.testApp.sendKey("Enter");
        await run;
        expect(breakpoints().map((bp) => [bp.condition, bp.hitCondition])).toEqual([["x > 1", "3"]]);
    });

    it("Wait for Breakpoint lists the other breakpoints but not logpoints; the picked one is waited for", async () => {
        goTo(5);
        t.h.testApp.sendKey("F9");
        await addWith(7, "editor.debug.action.addLogPoint", [], "log here");
        goTo(10);
        const { run } = await openWidget("editor.debug.action.triggerByBreakpoint");
        t.h.testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(t.screen()).toContain("main.cpp: 5");
        });
        expect(t.screen()).not.toContain("main.cpp: 7");
        t.h.testApp.sendKey("Enter");
        await run;
        const first = breakpoints().find((bp) => bp.lineNumber === 5);
        expect(breakpoints().find((bp) => bp.lineNumber === 10)?.triggeredBy).toBe(first?.getId());
    });

    it("a triggered breakpoint edited to a condition no longer waits", async () => {
        goTo(5);
        t.h.testApp.sendKey("F9");
        goTo(10);
        let { run } = await openWidget("editor.debug.action.triggerByBreakpoint");
        t.h.testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(t.screen()).toContain("main.cpp: 5");
        });
        t.h.testApp.sendKey("Enter");
        await run;
        expect(breakpoints().find((bp) => bp.lineNumber === 10)?.triggeredBy).toBeDefined();

        goTo(10);
        ({ run } = await openWidget("editor.debug.action.editBreakpoint"));
        // From Wait for Breakpoint up to Expression.
        for (let i = 0; i < 3; i++) t.h.testApp.sendKey("ArrowUp");
        typeText(t.h.testApp, "x > 1");
        t.h.testApp.sendKey("Enter");
        await run;
        const edited = breakpoints().find((bp) => bp.lineNumber === 10);
        expect([edited?.condition, edited?.triggeredBy]).toEqual(["x > 1", undefined]);
    });

    it("a condition in Cyrillic and CJK is kept as typed", async () => {
        await addWith(10, "editor.debug.action.conditionalBreakpoint", [], 'имя == "日本"');
        expect(breakpoints().map((bp) => bp.condition)).toEqual(['имя == "日本"']);
    });

    it("in a session with two modes the widget has a Mode row; editing the condition keeps the picked mode", async () => {
        const factory = await t.startStopped();
        const adapter = factory.adapters[0];
        await t.h.container.get(DebugServiceDIToken).addBreakpoints(Uri.file(main), [{ lineNumber: 5 }]);
        const [bp] = breakpoints();
        let run = t.h.commands.execute("debug.editBreakpointMode", bp);
        await vi.waitFor(() => {
            expect(t.screen()).toContain("Select Breakpoint Mode");
        });
        t.h.testApp.sendKey("ArrowDown");
        t.h.testApp.sendKey("Enter");
        await run;
        expect(breakpoints()[0].mode).toBe("hardware");

        t.h.container.get(EditorServiceDIToken).openFile(main);
        goTo(5);
        ({ run } = await openWidget("editor.debug.action.editBreakpoint"));
        expect(t.screen()).toMatch(/Mode\s+Hardware/u);
        typeText(t.h.testApp, "x > 1");
        t.h.testApp.sendKey("Enter");
        await run;
        expect(breakpoints().map((b) => [b.condition, b.mode])).toEqual([["x > 1", "hardware"]]);
        await vi.waitFor(() => {
            const sent = adapter.requests.findLast((r) => r.command === "setBreakpoints")?.arguments as {
                breakpoints: unknown[];
            };
            expect(sent.breakpoints).toEqual([{ line: 5, condition: "x > 1", mode: "hardware" }]);
        });
    });

    it("Edit Breakpoint on a line without a breakpoint opens nothing and adds nothing", async () => {
        goTo(12);
        await t.h.commands.execute("editor.debug.action.editBreakpoint");
        expect(t.screen()).not.toContain("Wait for Breakpoint");
        expect(breakpoints()).toEqual([]);
    });
});
