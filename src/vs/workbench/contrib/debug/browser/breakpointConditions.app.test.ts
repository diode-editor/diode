// Conditions, hit counts and logpoints end to end on the whole workbench with the synthetic debugger, whose loop of
// `accumulate` (main.cpp:27-31, once per `i`) honors them: the editor's commands open the breakpoint widget at the
// cursor, the BREAKPOINTS row tells the condition, Continue stops only where the condition holds, a logpoint writes
// its message to the Debug Console with the values interpolated.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugViewletHarness, type IDebugViewletHarness } from "../../../../../TestUtils/debugViewletHarness.ts";
import { typeText } from "../../../../../TestUtils/domQueries.ts";
import { numAt, type SyntheticDebugAdapterFactory } from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { type IBreakpoint, REPL_VIEW_ID, State } from "../common/debug.ts";

import { DebugServiceDIToken } from "./debugService.ts";

/** `int lineN = N;` on line N: a line's text names it. */
const SOURCE = Array.from({ length: 80 }, (_, i) => `int line${String(i + 1)} = ${String(i + 1)};`).join("\n");

describe("Conditions, hit counts and logpoints with the synthetic debugger", () => {
    let root: string;
    let main: string;
    let t: IDebugViewletHarness;

    beforeEach(async () => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "diode-conditions-")));
        main = path.join(root, "src", "main.cpp");
        fs.mkdirSync(path.dirname(main));
        fs.writeFileSync(main, SOURCE);
        t = await createDebugViewletHarness(root, root);
    });

    afterEach(async () => {
        await t.dispose();
        fs.rmSync(root, { recursive: true, force: true });
    });

    function breakpoints(): readonly IBreakpoint[] {
        return t.h.container.get(DebugServiceDIToken).getModel().getBreakpoints();
    }

    /** Opens main.cpp with the cursor on `line` (1-based) and column (0-based); C++ takes breakpoints. */
    async function open(line: number, column = 0): Promise<void> {
        t.registerDebugger();
        const editors = t.h.container.get(EditorServiceDIToken);
        editors.openFile(main);
        const editor = editors.getActiveEditor();
        if (editor === null) throw new Error("main.cpp did not open");
        t.h.container.get(DebugServiceDIToken).getAdapterManager().registerBreakpoints({ language: editor.languageId });
        editor.goToPosition(line - 1, column);
        await new Promise((resolve) => setTimeout(resolve));
    }

    /** Runs an editor command that opens the widget, waits for it, types the value and accepts. */
    async function widget(command: string, keys: readonly string[], value: string): Promise<void> {
        const run = t.h.commands.execute(command);
        await vi.waitFor(() => {
            expect(t.screen()).toContain("Wait for Breakpoint");
        });
        for (const key of keys) t.h.testApp.sendKey(key);
        typeText(t.h.testApp, value);
        t.h.testApp.sendKey("Enter");
        await run;
    }

    async function start(): Promise<SyntheticDebugAdapterFactory> {
        return t.startStopped();
    }

    /** F5 from a stop; the next stop is told by {@link stoppedAt}. */
    function continueToStop(): void {
        t.h.testApp.sendKey("F5");
    }

    /** `i` of VARIABLES: the loop's counter where the program stopped. */
    async function stoppedAt(i: number): Promise<void> {
        await vi.waitFor(() => {
            expect(t.h.container.get(ContextKeyServiceDIToken).getRaw("debugState")).toBe("stopped");
            expect(t.screen()).toMatch(new RegExp(`\\bi: ${String(i)}\\b`, "u"));
        });
    }

    it("Add Conditional Breakpoint... with `i % 100 == 0`: Continue stops only where i is a multiple of 100", async () => {
        await open(27, 4);
        await widget("editor.debug.action.conditionalBreakpoint", [], "i % 100 == 0");
        expect(breakpoints().map((bp) => [bp.lineNumber, bp.column, bp.condition])).toEqual([
            [27, undefined, "i % 100 == 0"],
        ]);
        await vi.waitFor(() => {
            expect(t.screen()).toContain("if i % 100 == 0");
        });

        await start();
        await stoppedAt(0);
        continueToStop();
        await stoppedAt(100);
        continueToStop();
        await stoppedAt(200);
        // The condition went to the adapter as it was typed.
        expect(t.screen()).not.toContain("not supported");
    });

    it("Add Logpoint... writes `sum=… i=…` on every pass without stopping; the program stops where the condition holds", async () => {
        await open(29, 4);
        await widget("editor.debug.action.addLogPoint", [], "sum={sum} i={i}");
        t.h.container.get(EditorServiceDIToken).getActiveEditor()?.goToPosition(26, 0);
        await widget("editor.debug.action.conditionalBreakpoint", [], "i == 3");
        // The logpoint is a column breakpoint at the cursor, as upstream's.
        expect(breakpoints().map((bp) => [bp.lineNumber, bp.column, bp.logMessage, bp.condition])).toEqual([
            [27, undefined, undefined, "i == 3"],
            [29, 5, "sum={sum} i={i}", undefined],
        ]);

        await start();
        continueToStop();
        await stoppedAt(3);
        t.h.container.get(ViewsServiceDIToken).openView(REPL_VIEW_ID, true);
        const sum = (i: number): number => Array.from({ length: i }, (_, k) => numAt(k)).reduce((a, b) => a + b, 0);
        await vi.waitFor(() => {
            const screen = t.screen();
            for (const i of [0, 1, 2]) expect(screen).toContain(`sum=${String(sum(i))} i=${String(i)}`);
        });
        expect(t.screen()).not.toContain(" i=3");
    });

    it("Edit Breakpoint on a breakpoint of the line: the arrows to Hit Count, `>= 5` stops on the fifth pass", async () => {
        await open(27);
        t.h.testApp.sendKey("F9");
        await vi.waitFor(() => {
            expect(breakpoints()).toHaveLength(1);
        });
        await widget("editor.debug.action.editBreakpoint", ["ArrowDown"], ">= 5");
        expect(breakpoints().map((bp) => [bp.condition, bp.hitCondition])).toEqual([[undefined, ">= 5"]]);
        await vi.waitFor(() => {
            expect(t.screen()).toContain("hit count >= 5");
        });

        await start();
        continueToStop();
        await stoppedAt(5);
        continueToStop();
        await stoppedAt(6);
    });

    it("a plain breakpoint in the loop: Continue stops on its next pass, not the spike's jump", async () => {
        await open(27);
        t.h.testApp.sendKey("F9");
        await start();
        continueToStop();
        await stoppedAt(1);
        expect(t.h.container.get(DebugServiceDIToken).state).toBe(State.Stopped);
    });

    it("a condition that never holds runs the loop to its end: the program exits", async () => {
        await open(28);
        await widget("editor.debug.action.conditionalBreakpoint", [], "i > 5000");
        await start();
        t.h.testApp.sendKey("F5");
        await vi.waitFor(() => {
            expect(t.h.container.get(DebugServiceDIToken).state).toBe(State.Inactive);
        });
    });
});
