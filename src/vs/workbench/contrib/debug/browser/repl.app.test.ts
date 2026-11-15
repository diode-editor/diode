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
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import { computeThemeVars } from "../../../../platform/theme/browser/themeStyleVars.ts";
import { ProductIconServiceDIToken } from "../../../../platform/theme/common/productIconService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { ThemeServiceDIToken } from "../../../services/themes/common/themeTokens.ts";
import { REPL_VIEW_ID } from "../common/debug.ts";

import { DebugServiceDIToken } from "./debugService.ts";
import { ReplDIToken, START_DEBUG_FIRST } from "./repl.ts";
import { CLEAR_REPL_ID } from "./replActions.ts";

describe("Debug Console in the workbench", () => {
    let h: IAppHarness;
    let registration: (IDisposable & { factory: SyntheticDebugAdapterFactory }) | undefined;
    let state: MockStateService;

    beforeEach(async () => {
        state = mockStateService();
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

    async function startStopped(): Promise<void> {
        registration = registerSyntheticDebugger(
            h.container.get(DebugServiceDIToken).getAdapterManager(),
            NO_DELAY_TIMING,
        );
        await h.commands.execute("debug.startFromConfig", { ...SYNTHETIC_LAUNCH_CONFIG });
        await vi.waitFor(() => {
            expect(h.container.get(ContextKeyServiceDIToken).getRaw("debugState")).toBe("stopped");
        });
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
        expect(h.container.get(ViewsServiceDIToken).isViewShown(REPL_VIEW_ID)).toBe(false);

        await startStopped();

        expect(h.container.get(ViewsServiceDIToken).isViewShown(REPL_VIEW_ID)).toBe(true);
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
        await startStopped();

        await evaluate("nums[3] + 1");

        await vi.waitFor(() => {
            expect(screen()).toContain(echo("nums[3] + 1"));
        });
        expect(h.container.get(ReplDIToken).input.isFocused).toBe(true);
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
        expect(h.container.get(ViewsServiceDIToken).isViewShown(REPL_VIEW_ID)).toBe(true);
    });

    it("without a session the input shows the hint and Enter answers with it", async () => {
        await h.commands.execute("workbench.debug.action.focusRepl");
        expect(h.container.get(ViewsServiceDIToken).isViewShown(REPL_VIEW_ID)).toBe(true);
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
        await startStopped();
        const session = h.container.get(DebugServiceDIToken).getViewModel().focusedSession;
        if (!session) throw new Error("no session");

        // F5: the program runs to the breakpoint again and logs `sum=… i=…` at main.cpp:35.
        h.testApp.sendKey("F5");
        await vi.waitFor(() => {
            expect(screen()).toContain("sum=");
        });
        const sum = rowOf("sum=");
        expect(sum.trimEnd()).toMatch(/sum=\d+ i=100 +main\.cpp:35 *│?$/u);
        expect(fg("main.cpp:35")).toBe(vars()["debugConsole.sourceForeground"]);

        session.appendToRepl({ output: "boom\nboom\nboom\n", sev: "error" });
        session.appendToRepl({ output: "Console note\n", sev: "ignore" });
        await vi.waitFor(() => {
            expect(screen()).toContain("Console note");
        });
        const badge = find(" 3 ");
        expect(rowOf("boom")).toContain(" 3  boom");
        expect(h.testApp.backend.getBgAt(new Point(badge.x + 1, badge.y))).toBe(vars()["badge.background"]);
        expect(fg("boom")).toBe(vars()["debugConsole.errorForeground"]);
        expect(h.testApp.app.screen.getCell(find("Console note")).style & StyleFlags.Italic).toBe(StyleFlags.Italic);
    });

    it("an object the adapter logged (`variablesReference`) expands in the output", async () => {
        await startStopped();
        const session = h.container.get(DebugServiceDIToken).getViewModel().focusedSession;
        if (!session) throw new Error("no session");

        session.appendToRepl({
            output: "",
            expression: new TestVariable("point", "{x=1, y=2}", [
                new TestVariable("x", "1"),
                new TestVariable("y", "2"),
            ]),
            sev: "info",
        });
        await vi.waitFor(() => {
            expect(screen()).toContain("{x=1, y=2}");
        });
        const console = h.container.get(ReplDIToken);
        console.tree.list.focus();
        h.testApp.sendKey("End");
        h.testApp.sendKey("ArrowRight");

        await vi.waitFor(() => {
            expect(screen()).toContain("x: 1");
        });
        expect(screen()).toContain("y: 2");
    });

    it("an evaluation scrolls to the tail even after the user scrolled up; new output alone does not", async () => {
        await startStopped();
        const session = h.container.get(DebugServiceDIToken).getViewModel().focusedSession;
        if (!session) throw new Error("no session");
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
            expect(h.container.get(DebugServiceDIToken).getViewModel().focusedSession?.getReplElements().length).toBe(
                66,
            );
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
        expect(h.container.get(ViewsServiceDIToken).isViewShown(REPL_VIEW_ID)).toBe(false);
        h.testApp.sendKey("Ctrl+k");
        h.testApp.sendKey("y");
        expect(h.container.get(ViewsServiceDIToken).isViewShown(REPL_VIEW_ID)).toBe(true);
        expect(h.container.get(ReplDIToken).input.isFocused).toBe(true);
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
        expect(h.container.get(ViewsServiceDIToken).isViewShown(REPL_VIEW_ID)).toBe(true);

        await h.container.get(DebugServiceDIToken).stopSession(undefined);

        await vi.waitFor(() => {
            expect(h.container.get(ViewsServiceDIToken).isViewShown(REPL_VIEW_ID)).toBe(false);
        });
    });
});
