// The Debug Console on the whole workbench with the synthetic debugger: what the user sees in the panel — the
// program's and the adapter's output in their colors with the source on the right, evaluations in the focused frame
// with their objects expanded in place, the history of the input, the hint without a session; keys through the
// real keybinding dispatcher.

import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { TestVariable } from "../../../../../TestUtils/debugViewsFixture.ts";
import { typeText } from "../../../../../TestUtils/domQueries.ts";
import { type MockStateService, mockStateService } from "../../../../../TestUtils/mockDebug.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_LAUNCH_CONFIG,
    type SyntheticDebugAdapterFactory,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { codicon } from "../../../../base/common/codicons.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { MenuRegistryDIToken } from "../../../../platform/actions/common/menuRegistry.ts";
import { ClipboardDIToken } from "../../../../platform/clipboard/common/iClipboard.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import { computeThemeVars } from "../../../../platform/theme/browser/themeStyleVars.ts";
import { ProductIconServiceDIToken } from "../../../../platform/theme/common/productIconService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { PANEL_HEIGHT_STATE } from "../../../common/stateKeys.ts";
import { ThemeServiceDIToken } from "../../../services/themes/common/themeTokens.ts";
import { type IDebugSession, REPL_VIEW_ID } from "../common/debug.ts";

import { DebugServiceDIToken } from "./debugService.ts";
import { ReplDIToken, START_DEBUG_FIRST } from "./repl.ts";
import {
    ACCEPT_REPL_INPUT_ID,
    CLEAR_REPL_ID,
    COLLAPSE_REPL_ID,
    COPY_ALL_REPL_ID,
    FOCUS_REPL_ID,
} from "./replActions.ts";

describe("Debug Console in the workbench", () => {
    let h: IAppHarness;
    let registration: (IDisposable & { factory: SyntheticDebugAdapterFactory }) | undefined;
    let state: MockStateService;

    beforeEach(async () => {
        state = mockStateService();
        // The panel's frame takes two rows and its gone top line gave one back: a row taller panel keeps the
        // console's rows the expansions below need.
        state.values.set(PANEL_HEIGHT_STATE.key, PANEL_HEIGHT_STATE.default + 1);
        h = createAppTestHarness({
            size: new Size(120, 40),
            stateService: { ...NULL_STATE_SERVICE, get: state.get, store: state.store, remove: state.remove },
        });
        await h.workbench.activate();
        registration = undefined;
    });

    afterEach(async () => {
        await h.container.get(DebugServiceDIToken).stopSession(undefined);
        registration?.factory.adapters.forEach((a) => {
            a.dispose();
        });
        registration?.dispose();
        h.dispose();
    });

    function lines(): string[] {
        h.testApp.render();
        return h.testApp.backend.screenToString().split("\n");
    }

    function screen(): string {
        return lines().join("\n");
    }

    /** Where `text` starts on screen; the last occurrence (the console is at the bottom). */
    function find(text: string): Point {
        const rows = lines();
        const y = rows.findLastIndex((row) => row.includes(text));
        expect(y, `"${text}" on screen`).toBeGreaterThanOrEqual(0);
        return new Point(rows[y].indexOf(text), y);
    }

    function rowOf(text: string): string {
        return lines()[find(text).y];
    }

    /** The console's own columns of the screen row `y`: no sidebar, no frame lines. */
    function consoleRow(y: number): string {
        const view = h.container.get(ReplDIToken).view;
        const left = view.globalPosition.x;
        return lines()[y].slice(left, left + view.layoutSize.width);
    }

    function vars(): Record<string, number> {
        return computeThemeVars(h.container.get(ThemeServiceDIToken).theme);
    }

    function glyph(name: string): string {
        return h.container.get(ProductIconServiceDIToken).glyph(codicon(name));
    }

    /** The echo of an evaluation. */
    function echo(expression: string): string {
        return `${glyph("arrow-small-right")} ${expression}`;
    }

    function fg(text: string): number | undefined {
        return h.testApp.backend.getFgAt(find(text));
    }

    function consoleShown(): boolean {
        return h.container.get(ViewsServiceDIToken).isViewShown(REPL_VIEW_ID);
    }

    async function startStopped(): Promise<IDebugSession> {
        registration = registerSyntheticDebugger(
            h.container.get(DebugServiceDIToken).getAdapterManager(),
            NO_DELAY_TIMING,
        );
        await h.commands.execute("debug.startFromConfig", { ...SYNTHETIC_LAUNCH_CONFIG });
        await vi.waitFor(() => {
            expect(h.container.get(ContextKeyServiceDIToken).getRaw("debugState")).toBe("stopped");
        });
        const session = h.container.get(DebugServiceDIToken).getViewModel().focusedSession;
        if (!session) throw new Error("no session");
        return session;
    }

    async function evaluate(expression: string): Promise<void> {
        h.container.get(ReplDIToken).focus();
        typeText(h.testApp, expression);
        h.testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(h.container.get(ReplDIToken).input.inputState.value).toBe("");
        });
    }

    it("the first session opens it with the start's output: the adapter's lines in the warning color", async () => {
        expect(consoleShown()).toBe(false);

        await startStopped();

        expect(consoleShown()).toBe(true);
        // Upstream opens it without taking the focus.
        expect(h.container.get(ReplDIToken).input.isFocused).toBe(false);
        await vi.waitFor(() => {
            expect(screen()).toContain("Hello from hello 1.2.0!");
        });
        expect(screen()).toContain("DEBUG CONSOLE");
        expect(fg("Launching: /home/user/hello")).toBe(vars()["debugConsole.warningForeground"]);
        // stdout keeps the plain foreground.
        const hello = fg("Hello from hello");
        expect(hello).not.toBe(vars()["debugConsole.warningForeground"]);
        expect(hello).not.toBe(vars()["debugConsole.infoForeground"]);
        expect(hello).not.toBe(vars()["debugConsole.errorForeground"]);
        // The input's prompt, under the output.
        const prompt = find(glyph("chevron-right"));
        expect(h.testApp.backend.getFgAt(prompt)).toBe(vars()["debugConsoleInputIcon.foreground"]);
        expect(prompt.y).toBeGreaterThan(find("Hello from hello").y);
    });

    it("`cfg` echoes the input and expands its object in place down to `limits`; `foo + 1` is an error", async () => {
        // One line a row: the expanded children stay in the panel (an expansion at the bottom does not scroll, as upstream).
        await h.container.get(IConfigurationServiceDIToken).updateValue("debug.console.wordWrap", false);
        await startStopped();

        await evaluate("cfg");
        await vi.waitFor(() => {
            expect(screen()).toContain('{path="/home/user/hello/input.txt", limits=');
        });
        expect(h.testApp.backend.getFgAt(find(echo("cfg")))).toBe(vars()["debugConsoleInputIcon.foreground"]);
        // The result is an object: it has a chevron and opens with the keys.
        const console = h.container.get(ReplDIToken);
        console.tree.list.focus();
        h.testApp.render();
        expect(h.container.get(ContextKeyServiceDIToken).getRaw("inDebugRepl")).toBe(true);
        h.testApp.sendKey("End");
        h.testApp.sendKey("ArrowRight");
        await vi.waitFor(() => {
            expect(screen()).toContain("limits: {min=-1000, max=1000}");
        });
        expect(fg("limits: {")).toBe(vars()["debugTokenExpression.name"]);
        expect(screen()).toContain('path: "/home/user/hello/input.txt"');

        h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("ArrowRight");
        await vi.waitFor(() => {
            expect(screen()).toContain("min: -1000");
        });
        expect(screen()).toContain("max: 1000");

        await evaluate("foo + 1");
        await vi.waitFor(() => {
            expect(screen()).toContain("error: use of undeclared identifier 'foo'");
        });
        expect(fg("error: use of undeclared")).toBe(vars()["debugTokenExpression.error"]);
        expect(screen()).toContain(echo("foo + 1"));
    });

    it("an arithmetic result is a number in the focused frame; the input keeps the focus", async () => {
        // One line a row: the result is the line under its echo, without the scrollbar of a taller console.
        await h.container.get(IConfigurationServiceDIToken).updateValue("debug.console.wordWrap", false);
        await startStopped();

        await evaluate("6 * 7");

        await vi.waitFor(() => {
            expect(consoleRow(find(echo("6 * 7")).y + 1).trim()).toMatch(/^\d+$/u);
        });
        const y = find(echo("6 * 7")).y + 1;
        const result = new Point(lines()[y].search(/\d/u), y);
        expect(h.testApp.backend.getFgAt(result)).toBe(vars()["debugTokenExpression.number"]);
        expect(h.container.get(ReplDIToken).input.isFocused).toBe(true);
    });

    it("Debug Console: Accept Input evaluates what the input holds", async () => {
        await startStopped();
        h.container.get(ReplDIToken).focus();
        typeText(h.testApp, "cfg");

        await h.commands.execute(ACCEPT_REPL_INPUT_ID);

        await vi.waitFor(() => {
            expect(screen()).toContain(echo("cfg"));
        });
        expect(h.container.get(ReplDIToken).input.inputState.value).toBe("");
    });

    it("Up and Down walk the history of the input, Escape clears it", async () => {
        await startStopped();
        await evaluate("cfg");
        await evaluate("foo + 1");
        await evaluate("cfg");
        const input = h.container.get(ReplDIToken).input;

        // A repeated entry moves to the newest place.
        h.testApp.sendKey("ArrowUp");
        expect(input.inputState.value).toBe("cfg");
        h.testApp.sendKey("ArrowUp");
        expect(input.inputState.value).toBe("foo + 1");
        // The oldest entry stays.
        h.testApp.sendKey("ArrowUp");
        expect(input.inputState.value).toBe("foo + 1");
        h.testApp.sendKey("ArrowDown");
        expect(input.inputState.value).toBe("cfg");
        h.testApp.sendKey("ArrowDown");
        expect(input.inputState.value).toBe("");
        // Kept per workspace.
        expect(state.values.get("debug.repl.history")).toEqual(["foo + 1", "cfg"]);

        typeText(h.testApp, "sum");
        h.testApp.sendKey("Escape");
        expect(input.inputState.value).toBe("");
        expect(input.isFocused).toBe(true);
        expect(consoleShown()).toBe(true);
    });

    it("without a session the input shows the hint and Enter answers with it", async () => {
        await h.commands.execute(FOCUS_REPL_ID);
        expect(consoleShown()).toBe(true);
        expect(screen()).toContain(START_DEBUG_FIRST);

        typeText(h.testApp, "sum");
        h.testApp.sendKey("Enter");

        await vi.waitFor(() => {
            expect(screen()).toContain(echo("sum"));
        });
        // The echo, then the hint as an unavailable value: italic, in the error color.
        const y = find(echo("sum")).y + 1;
        const answer = new Point(lines()[y].indexOf(START_DEBUG_FIRST), y);
        expect(answer.x).toBeGreaterThan(0);
        expect(h.testApp.backend.getFgAt(answer)).toBe(vars()["debugTokenExpression.error"]);
        expect(h.testApp.app.screen.getCell(answer).style & StyleFlags.Italic).toBe(StyleFlags.Italic);
    });

    it("output of the adapter: stderr in the error color, the source on the right, repeats as a count", async () => {
        const session = await startStopped();

        // F5: the program runs to the breakpoint again and logs `sum=… i=…` at main.cpp:35.
        h.testApp.sendKey("F5");
        await vi.waitFor(() => {
            expect(screen()).toContain("sum=");
        });
        const sum = consoleRow(find("sum=").y);
        expect(sum.trimEnd()).toMatch(/sum=\d+ i=100 +main\.cpp:35 *[█░]?$/u);
        expect(fg("main.cpp:35")).toBe(vars()["debugConsole.sourceForeground"]);

        session.appendToRepl({ output: "boom\nboom\nboom\n", sev: "error" });
        session.appendToRepl({ output: "twice\ntwice\n", sev: "info" });
        session.appendToRepl({ output: "Console note\n", sev: "ignore" });
        await vi.waitFor(() => {
            expect(screen()).toContain("Console note");
        });
        const badge = find(" 3 ");
        expect(rowOf("boom")).toContain(" 3  boom");
        expect(rowOf("twice")).toContain(" 2  twice");
        expect(h.testApp.backend.getBgAt(new Point(badge.x + 1, badge.y))).toBe(vars()["badge.background"]);
        expect(fg("boom")).toBe(vars()["debugConsole.errorForeground"]);
        expect(h.testApp.app.screen.getCell(find("Console note")).style & StyleFlags.Italic).toBe(StyleFlags.Italic);
    });

    it("an object the adapter logged (`variablesReference`) expands in the output", async () => {
        await h.container.get(IConfigurationServiceDIToken).updateValue("debug.console.wordWrap", false);
        const session = await startStopped();

        // A logged number is colored as one.
        session.appendToRepl({ output: "", expression: new TestVariable("n", "4242"), sev: "info" });
        session.appendToRepl({
            output: "",
            expression: new TestVariable("point", "{x=1, y=2}", [
                // A child without a name shows its value alone.
                new TestVariable("", "777"),
                new TestVariable("x", "1"),
                new TestVariable("y", "2"),
            ]),
            sev: "info",
        });
        await vi.waitFor(() => {
            expect(screen()).toContain("{x=1, y=2}");
        });
        expect(fg("4242")).toBe(vars()["debugTokenExpression.number"]);
        const console = h.container.get(ReplDIToken);
        console.tree.list.focus();
        h.testApp.sendKey("End");
        h.testApp.sendKey("ArrowRight");

        await vi.waitFor(() => {
            expect(screen()).toContain("x: 1");
        });
        expect(screen()).toContain("y: 2");
        expect(fg("777")).toBe(vars()["debugTokenExpression.number"]);
        expect(screen()).not.toContain(": 777");
    });

    it("an evaluation scrolls to the tail even after the user scrolled up; new output alone does not", async () => {
        const session = await startStopped();
        for (let i = 0; i < 60; i++) session.appendToRepl({ output: `line ${String(i)}\n`, sev: "info" });
        await vi.waitFor(() => {
            expect(screen()).toContain("line 59");
        });

        // The user goes up to the first line.
        h.container.get(ReplDIToken).tree.list.focus();
        h.testApp.sendKey("Home");
        expect(screen()).not.toContain("line 59");
        session.appendToRepl({ output: "line 60\n", sev: "info" });
        await vi.waitFor(() => {
            expect(session.getReplElements()).toHaveLength(67);
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(screen()).not.toContain("line 60");

        await evaluate("sum");
        await vi.waitFor(() => {
            expect(screen()).toContain(echo("sum"));
        });
        expect(screen()).toContain("line 60");
    });

    it("Clear Console empties it; Ctrl+K Y hides and shows the panel's console", async () => {
        await startStopped();
        await vi.waitFor(() => {
            expect(screen()).toContain("Hello from hello");
        });

        await h.commands.execute(CLEAR_REPL_ID);
        await vi.waitFor(() => {
            expect(screen()).not.toContain("Hello from hello");
        });
        expect(h.container.get(ReplDIToken).input.isFocused).toBe(true);

        h.testApp.sendKey("Ctrl+k");
        h.testApp.sendKey("y");
        expect(consoleShown()).toBe(false);
        h.testApp.sendKey("Ctrl+k");
        h.testApp.sendKey("y");
        expect(consoleShown()).toBe(true);
        expect(h.container.get(ReplDIToken).input.isFocused).toBe(true);
    });

    it("Ctrl+F in the console focuses its filter; Copy All copies the rows shown; Collapse All closes the groups", async () => {
        const session = await startStopped();
        await vi.waitFor(() => {
            expect(screen()).toContain("PASS self-check");
        });
        const repl = h.container.get(ReplDIToken);
        await h.commands.execute(FOCUS_REPL_ID);
        h.testApp.sendKey("Ctrl+f");
        expect(repl.filterInput.isFocused).toBe(true);
        // The filter field is in the console's title row, in the frame.
        expect(screen()).toContain("Filter (e.g. text");

        await h.commands.execute(FOCUS_REPL_ID);
        await h.commands.execute(COPY_ALL_REPL_ID);
        const copied = await h.container.get(ClipboardDIToken).readText();
        expect(copied).toContain("Hello from hello 1.2.0!\n");
        expect(copied).toContain("PASS self-check 3/3");
        expect(copied).not.toContain("\u001b");

        const raw = session as unknown as { repl: { startGroup(s: IDebugSession, n: string, e: boolean): void } };
        raw.repl.startGroup(session, "Group", true);
        session.appendToRepl({ output: "inside the group\n", sev: "info" });
        await vi.waitFor(() => {
            expect(screen()).toContain("inside the group");
        });
        // From the filter: Collapse All focuses the console, as upstream's.
        repl.focusFilter();
        expect(repl.input.isFocused).toBe(false);
        await h.commands.execute(COLLAPSE_REPL_ID);
        await vi.waitFor(() => {
            expect(screen()).not.toContain("inside the group");
        });
        expect(repl.input.isFocused).toBe(true);
    });

    it("Clear Console is the title button of the console", () => {
        const entries = h.container
            .get(MenuRegistryDIToken)
            .getMenuItemGroups(MenuId.ViewTitle, { view: REPL_VIEW_ID })
            .flatMap((group) => group.entries)
            .flatMap((entry) => ("enabled" in entry ? [entry.id] : []));

        expect(entries).toEqual([CLEAR_REPL_ID]);
    });

    it("debug.console.closeOnEnd closes it when the session ends", async () => {
        await h.container.get(IConfigurationServiceDIToken).updateValue("debug.console.closeOnEnd", true);
        await startStopped();
        expect(consoleShown()).toBe(true);

        await h.container.get(DebugServiceDIToken).stopSession(undefined);

        await vi.waitFor(() => {
            expect(consoleShown()).toBe(false);
        });
    });
});
