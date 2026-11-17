// The editor's commands while debugging on the whole workbench with the synthetic debugger, whose `main.cpp` is a
// real file here: the exception's badge after the line on the third F10 with its whole text in the Debug Console and
// Escape that closes it, Run to Cursor, Jump to Cursor, Step Into Target from the cursor and from Ctrl+F11's pick,
// Evaluate in Debug Console, Add to Watch, the inline breakpoint with the candidate locations, and the items of the
// editor's context menu.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { compositeOver } from "@tuidom/core/common/colorUtils";
import { Point } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugViewletHarness, type IDebugViewletHarness } from "../../../../../TestUtils/debugViewletHarness.ts";
import type { SyntheticDebugAdapter } from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { codicon } from "../../../../base/common/codicons.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createSelection } from "../../../../editor/common/core/iSelection.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ProductIconServiceDIToken } from "../../../../platform/theme/common/productIconService.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { REPL_VIEW_ID } from "../common/debug.ts";

import {
    JUMP_TO_CURSOR_ID,
    RUN_TO_CURSOR_ID,
    SELECTION_TO_REPL_ID,
    SELECTION_TO_WATCH_ID,
    STEP_INTO_TARGETS_ID,
} from "./debugEditorActions.ts";
import { DebugServiceDIToken } from "./debugService.ts";

/** The loop of `accumulate` on lines 27-31 as the synthetic program has it; `// line N` elsewhere. */
const LOOP: Readonly<Record<number, string>> = {
    27: "        long total = sum * 2;",
    28: "        int count = 0;",
    29: "        sum += numAt(nums.at(i));",
    30: "        total += nums.at(i + 1000);",
    31: "        ++count;",
};
const SOURCE = Array.from({ length: 80 }, (_, i) => LOOP[i + 1] ?? `// line ${String(i + 1)}`).join("\n");

describe("The editor's commands while debugging", () => {
    let root: string;
    let main: string;
    let t: IDebugViewletHarness;

    beforeEach(async () => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "diode-debug-editor-")));
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

    /** The synthetic program stopped at line 27, main.cpp in the editor; C++ takes breakpoints. */
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

    /** The line (1-based) of the focused frame once the program stopped there. */
    async function stoppedOn(line: number): Promise<void> {
        await vi.waitFor(() => {
            expect(contextKey("debugState")).toBe("stopped");
            const frame = t.h.container.get(DebugServiceDIToken).getViewModel().focusedStackFrame;
            expect(frame?.range.startLineNumber).toBe(line);
        });
    }

    /** F10 in the focused editor, then the stop on `line`. */
    async function stepOver(line: number): Promise<void> {
        editor().focusEditor();
        t.h.testApp.sendKey("F10");
        await stoppedOn(line);
    }

    /** The cursor on `line` (1-based), `column` (0-based). */
    function cursor(line: number, column = 0): void {
        editor().goToPosition(line - 1, column);
        editor().revealRange(createRange(line - 1, column, line - 1, column));
    }

    function rowOf(text: string): string {
        return t.lines()[t.find(text).y];
    }

    it("the third F10 throws: a badge after the line, the whole text in the Debug Console, Escape closes it", async () => {
        await start();
        // The whole badge in the width: no side bar.
        await t.h.commands.execute("workbench.action.toggleSidebarVisibility");
        await stepOver(28);
        await stepOver(29);
        await stepOver(30);

        const title = "Exception has occurred: std::out_of_range — vector::_M_range_check";
        await vi.waitFor(() => {
            expect(rowOf("total += nums.at(i + 1000);")).toContain(title);
        });
        expect(contextKey("exceptionWidgetVisible")).toBe(true);
        // Two cells after the line's end, on the exception's background over the frame's line.
        const vars = t.vars();
        const line = t.find("total += nums.at(i + 1000);");
        const badge = t.find(title);
        expect(badge.y).toBe(line.y);
        expect(badge.x).toBe(line.x + "total += nums.at(i + 1000);".length + 3);
        expect(t.h.testApp.backend.getBgAt(new Point(badge.x + 2, badge.y))).toBe(
            compositeOver(
                vars["debugExceptionWidget.background"],
                compositeOver(vars["editor.stackFrameHighlightBackground"], vars["editor.background"]),
            ),
        );
        expect(t.h.testApp.backend.getFgAt(new Point(badge.x + 2, badge.y))).toBe(vars["editor.foreground"]);

        // The description and the stack trace in the console, once.
        t.h.container.get(ViewsServiceDIToken).openView(REPL_VIEW_ID, false);
        await vi.waitFor(() => {
            expect(t.screen()).toContain("at accumulate(std::vector<int> const&)");
        });
        expect(t.screen()).toContain("Exception has occurred: std::out_of_range");
        expect(t.screen().split("at process(Config const&)")).toHaveLength(2);

        editor().focusEditor();
        t.h.testApp.sendKey("Escape");
        await vi.waitFor(() => {
            expect(t.screen()).not.toContain(title);
        });
        expect(contextKey("exceptionWidgetVisible")).toBe(false);
        // Escape without the badge leaves the keys to others; the next stop is no exception.
        await stepOver(31);
        expect(t.screen()).not.toContain("Exception has occurred: std::out_of_range —");
    });

    it("Run to Cursor stops on the cursor's line and takes its breakpoint away", async () => {
        await start();
        cursor(29, 8);
        await t.h.commands.execute(RUN_TO_CURSOR_ID);
        await stoppedOn(29);
        await vi.waitFor(() => {
            expect(t.h.container.get(DebugServiceDIToken).getModel().getBreakpoints()).toEqual([]);
        });
    });

    it("Jump to Cursor: the program goes on from the cursor's line without running the lines between", async () => {
        const adapter = await start();
        cursor(31);
        await t.h.commands.execute(JUMP_TO_CURSOR_ID);
        await stoppedOn(31);
        expect(adapter.requests.find((r) => r.command === "goto")?.arguments).toEqual({ threadId: 1, targetId: 31 });
    });

    it("Step Into Target from the cursor steps into the call around it; elsewhere it asks", async () => {
        const adapter = await start();
        cursor(29, 8);
        await t.h.commands.execute(RUN_TO_CURSOR_ID);
        await stoppedOn(29);

        // The cursor in `nums.at(i)`: the innermost call around it.
        cursor(29, 23);
        editor().focusEditor();
        await t.h.commands.execute(STEP_INTO_TARGETS_ID);
        await vi.waitFor(() => {
            expect(adapter.requests.find((r) => r.command === "stepIn")?.arguments).toMatchObject({ targetId: 2 });
        });
    });

    it("Ctrl+F11 picks a target: the active one's call is selected in the editor, Enter steps into it", async () => {
        const adapter = await start();
        cursor(29, 8);
        await t.h.commands.execute(RUN_TO_CURSOR_ID);
        await stoppedOn(29);

        editor().focusEditor();
        t.h.testApp.sendKey("Ctrl+F11");
        await vi.waitFor(() => {
            expect(t.screen()).toContain("std::vector<int>::at(size_t)");
        });
        expect(t.screen()).toContain("numAt(int)");
        expect(editor().getSelectedTexts()).toEqual(["numAt(nums.at(i))"]);
        t.h.testApp.sendKey("ArrowDown");
        await vi.waitFor(() => {
            expect(editor().getSelectedTexts()).toEqual(["nums.at(i)"]);
        });
        t.h.testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(adapter.requests.find((r) => r.command === "stepIn")?.arguments).toMatchObject({ targetId: 2 });
        });
    });

    it("Evaluate in Debug Console sends the selection; Add to Watch watches the expression under the cursor", async () => {
        await start();
        editor().viewState.selections = [createSelection(28, 8, 28, 11)];
        await t.h.commands.execute(SELECTION_TO_REPL_ID);
        const echo = `${t.h.container.get(ProductIconServiceDIToken).glyph(codicon("arrow-small-right"))} sum`;
        await vi.waitFor(() => {
            expect(t.screen()).toContain(echo);
        });

        cursor(29, 22);
        await t.h.commands.execute(SELECTION_TO_WATCH_ID);
        await vi.waitFor(() => {
            expect(t.screen()).toMatch(/\bnums: size=1000/u);
        });
        expect(
            t.h.container
                .get(DebugServiceDIToken)
                .getModel()
                .getWatchExpressions()
                .map((e) => e.name),
        ).toEqual(["nums"]);
    });

    it("Shift+F9 sets an inline breakpoint before the column; the line's other locations show as candidates", async () => {
        await start();
        cursor(29, 15);
        editor().focusEditor();
        t.h.testApp.sendKey("Shift+F9");
        await vi.waitFor(() => {
            expect(t.screen()).toContain("●sum += ●numAt(●nums.at(i));");
        });
        const [bp] = t.h.container.get(DebugServiceDIToken).getModel().getBreakpoints();
        expect([bp.lineNumber, bp.column]).toEqual([29, 16]);
        const vars = t.vars();
        const at = t.find("●sum += ●numAt(");
        const fg = (dx: number) => t.h.testApp.backend.getFgAt(new Point(at.x + dx, at.y));
        expect(fg(0)).toBe(vars["debugIcon.breakpointDisabledForeground"]);
        expect(fg("●sum += ".length)).toBe(vars["debugIcon.breakpointForeground"]);
        expect(fg("●sum += ●numAt(".length)).toBe(vars["debugIcon.breakpointDisabledForeground"]);

        // Off: the inline breakpoint stays, the candidates go.
        await t.h.container
            .get(IConfigurationServiceDIToken)
            .updateValue("debug.showInlineBreakpointCandidates", false);
        await vi.waitFor(() => {
            expect(t.screen()).toContain(" sum += ●numAt(nums.at(i));");
        });
    });

    it("the editor's context menu has the debug group while debugging, not before", async () => {
        const items = [
            "Evaluate in Debug Console",
            "Add to Watch",
            "Step Into Target",
            "Run to Cursor",
            "Jump to Cursor",
        ];
        t.registerDebugger();
        t.h.container.get(EditorServiceDIToken).openFile(main);
        editor().focusEditor();
        t.h.testApp.sendKey("Shift+F10");
        await vi.waitFor(() => {
            expect(t.screen()).toContain("Command Palette...");
        });
        for (const item of [...items, "Add Inline Breakpoint"]) expect(t.screen()).not.toContain(item);
        t.h.testApp.sendKey("Escape");

        await start();
        editor().focusEditor();
        t.h.testApp.sendKey("Shift+F10");
        await vi.waitFor(() => {
            expect(t.screen()).toContain("Run to Cursor");
        });
        for (const item of [...items, "Add Inline Breakpoint"]) expect(t.screen()).toContain(item);
    });
});
