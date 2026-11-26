// The edges of the editor's commands while debugging on the whole workbench with the synthetic debugger: Run to
// Cursor next to the user's own breakpoints, going through the breakpoints, Ctrl+F11's pick
// cancelled, and the exception's badge after Continue.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugViewletHarness, type IDebugViewletHarness } from "../../../../../TestUtils/debugViewletHarness.ts";
import type { SyntheticDebugAdapter } from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { LayoutServiceDIToken } from "../../../services/layout/browser/layoutService.ts";
import { REPL_VIEW_ID } from "../common/debug.ts";

import { RUN_TO_CURSOR_ID } from "./debugEditorActions.ts";
import { DebugServiceDIToken } from "./debugService.ts";

const LOOP: Readonly<Record<number, string>> = {
    27: "        long total = sum * 2;",
    28: "        int count = 0;",
    29: "        sum += numAt(nums.at(i));",
    30: "        total += nums.at(i + 1000);",
    31: "        ++count;",
};
const SOURCE = Array.from({ length: 80 }, (_, i) => LOOP[i + 1] ?? `// line ${String(i + 1)}`).join("\n");

describe("The editor's commands while debugging, on the edges", () => {
    let root: string;
    let main: string;
    let t: IDebugViewletHarness;

    beforeEach(async () => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "diode-debug-editor-edges-")));
        main = path.join(root, "src", "main.cpp");
        fs.mkdirSync(path.dirname(main));
        fs.writeFileSync(main, SOURCE);
        t = await createDebugViewletHarness(root, root);
    });

    afterEach(async () => {
        await t.dispose();
        fs.rmSync(root, { recursive: true, force: true });
    });

    function contextKey(key: string): unknown {
        return t.h.container.get(ContextKeyServiceDIToken).getRaw(key);
    }

    async function start(): Promise<SyntheticDebugAdapter> {
        const factory = t.registerDebugger();
        await t.startStopped();
        await vi.waitFor(() => {
            expect(editor().uri.fsPath).toBe(main);
        });
        t.h.container
            .get(DebugServiceDIToken)
            .getAdapterManager()
            .registerBreakpoints({ language: editor().languageId });
        return factory.adapters[0];
    }

    function editor(): TextEditorPane {
        const active = t.h.container.get(EditorServiceDIToken).getActiveEditor();
        if (active === null) throw new Error("no editor");
        return active;
    }

    function breakpointLines(): number[] {
        return t.h.container
            .get(DebugServiceDIToken)
            .getModel()
            .getBreakpoints()
            .map((bp) => bp.lineNumber)
            .sort((a, b) => a - b);
    }

    async function stoppedOn(line: number): Promise<void> {
        await vi.waitFor(() => {
            expect(contextKey("debugState")).toBe("stopped");
            const frame = t.h.container.get(DebugServiceDIToken).getViewModel().focusedStackFrame;
            expect(frame?.range.startLineNumber).toBe(line);
        });
    }

    function cursor(line: number, column = 0): void {
        editor().goToPosition(line - 1, column);
        editor().revealRange(createRange(line - 1, column, line - 1, column));
    }

    /** F9 on `line`: the user's own breakpoint. */
    async function toggleBreakpoint(line: number): Promise<void> {
        const before = breakpointLines().length;
        cursor(line);
        editor().focusEditor();
        t.h.testApp.sendKey("F9");
        await vi.waitFor(() => {
            expect(breakpointLines().length).not.toBe(before);
        });
    }

    it("Run to Cursor on a line with the user's breakpoint stops there and keeps that breakpoint", async () => {
        await start();
        await toggleBreakpoint(30);
        cursor(30, 8);
        await t.h.commands.execute(RUN_TO_CURSOR_ID);
        await stoppedOn(30);
        // The breakpoint is the user's: Run to Cursor must not take it away.
        await new Promise((r) => setTimeout(r, 200));
        expect(breakpointLines()).toEqual([30]);
    });

    it("Run to Cursor past the user's breakpoint stops at that breakpoint first and leaves no breakpoint of its own", async () => {
        await start();
        await toggleBreakpoint(29);
        cursor(31);
        await t.h.commands.execute(RUN_TO_CURSOR_ID);
        await stoppedOn(29);
        await vi.waitFor(() => {
            expect(breakpointLines()).toEqual([29]);
        });
    });

    it("Go to Next/Previous Breakpoint moves the cursor through the breakpoints and wraps around", async () => {
        await start();
        await toggleBreakpoint(28);
        await toggleBreakpoint(31);
        cursor(29);
        const cursorLine = () => editor().viewState.selections[0].active.line + 1;
        await t.h.commands.execute("editor.debug.action.goToNextBreakpoint");
        await vi.waitFor(() => {
            expect(cursorLine()).toBe(31);
        });
        await t.h.commands.execute("editor.debug.action.goToNextBreakpoint");
        await vi.waitFor(() => {
            expect(cursorLine()).toBe(28);
        });
        await t.h.commands.execute("editor.debug.action.goToPreviousBreakpoint");
        await vi.waitFor(() => {
            expect(cursorLine()).toBe(31);
        });
    });

    it("Escape in Ctrl+F11's pick steps nowhere", async () => {
        const adapter = await start();
        cursor(29, 8);
        await t.h.commands.execute(RUN_TO_CURSOR_ID);
        await stoppedOn(29);
        cursor(29, 8);
        editor().focusEditor();
        t.h.testApp.sendKey("Ctrl+F11");
        await vi.waitFor(() => {
            expect(t.screen()).toContain("numAt(int)");
        });
        t.h.testApp.sendKey("Escape");
        await vi.waitFor(() => {
            expect(t.screen()).not.toContain("numAt(int)");
        });
        await new Promise((r) => setTimeout(r, 200));
        expect(adapter.requests.some((r) => r.command === "stepIn")).toBe(false);
        expect(contextKey("debugState")).toBe("stopped");
    });

    it("the exception's badge goes away when the program runs on", async () => {
        // The editor group's frame takes two columns: the sidebar gives them back, the badge's text fits as before.
        t.h.container.get(LayoutServiceDIToken).nudgeSidebarWidth(-2);
        await start();
        for (const line of [28, 29, 30]) {
            editor().focusEditor();
            t.h.testApp.sendKey("F10");
            await stoppedOn(line);
        }
        await vi.waitFor(() => {
            expect(t.screen()).toContain("Exception has ");
        });
        editor().focusEditor();
        t.h.testApp.sendKey("F5");
        await vi.waitFor(() => {
            expect(t.screen()).not.toContain("Exception has ");
        });
        expect(contextKey("exceptionWidgetVisible")).toBe(false);
    });

    it("the exception's text goes to the Debug Console once per stop, not again when the frames change focus", async () => {
        await start();
        // The console in the whole width: no side bar.
        await t.h.commands.execute("workbench.action.toggleSidebarVisibility");
        for (const line of [28, 29, 30]) {
            editor().focusEditor();
            t.h.testApp.sendKey("F10");
            await stoppedOn(line);
        }
        const debugService = t.h.container.get(DebugServiceDIToken);
        const thread = debugService.getViewModel().focusedThread;
        const frames = await vi.waitFor(() => {
            const all = thread?.getCallStack() ?? [];
            const process = all.find((f) => f.name.startsWith("process("));
            expect(process).toBeDefined();
            return { top: all[0], process };
        });
        await debugService.focusStackFrame(frames.process, thread, undefined, { explicit: true });
        await debugService.focusStackFrame(frames.top, thread, undefined, { explicit: true });

        t.h.container.get(ViewsServiceDIToken).openView(REPL_VIEW_ID, false);
        await vi.waitFor(() => {
            expect(t.screen()).toContain("Exception has occurred: std::out_of_range");
        });
        await new Promise((r) => setTimeout(r, 200));
        // The console's line, not the badge's (`… — description`).
        expect(t.screen().match(/Exception has occurred: std::out_of_range(?! —)/gu)).toHaveLength(1);
    });
});
