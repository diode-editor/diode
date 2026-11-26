// Debug Console edge cases on the whole workbench with the synthetic debugger: partial and multi-line output, wide
// characters, a narrow panel, the history across a reload, evaluating while the program runs, a second session, and
// the console's place in the panel.

import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { typeText } from "../../../../../TestUtils/domQueries.ts";
import { type MockStateService, mockStateService } from "../../../../../TestUtils/mockDebug.ts";
import {
    type ISyntheticTiming,
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_LAUNCH_CONFIG,
    type SyntheticDebugAdapterFactory,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { codicon } from "../../../../base/common/codicons.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import { ProductIconServiceDIToken } from "../../../../platform/theme/common/productIconService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { OUTPUT_VIEW_ID } from "../../../services/output/common/output.ts";
import { type IDebugSession, REPL_VIEW_ID } from "../common/debug.ts";

import { DebugServiceDIToken } from "./debugService.ts";
import { ReplDIToken } from "./repl.ts";
import { FOCUS_REPL_ID } from "./replActions.ts";

describe("Debug Console edge cases in the workbench", () => {
    let h: IAppHarness;
    let registration: (IDisposable & { factory: SyntheticDebugAdapterFactory }) | undefined;
    let state: MockStateService;

    async function open(size = new Size(120, 40), shared?: MockStateService): Promise<void> {
        state = shared ?? mockStateService();
        h = createAppTestHarness({
            size,
            stateService: { ...NULL_STATE_SERVICE, get: state.get, store: state.store, remove: state.remove },
        });
        await h.workbench.activate();
        registration = undefined;
    }

    async function close(): Promise<void> {
        await h.container.get(DebugServiceDIToken).stopSession(undefined);
        registration?.factory.adapters.forEach((a) => {
            a.dispose();
        });
        registration?.dispose();
        registration = undefined;
        h.dispose();
    }

    afterEach(async () => {
        await close();
    });

    function lines(): string[] {
        h.testApp.render();
        return h.testApp.backend.screenToString().split("\n");
    }

    function screen(): string {
        return lines().join("\n");
    }

    function glyph(name: string): string {
        return h.container.get(ProductIconServiceDIToken).glyph(codicon(name));
    }

    function echo(expression: string): string {
        return `${glyph("arrow-small-right")} ${expression}`;
    }

    function consoleShown(): boolean {
        return h.container.get(ViewsServiceDIToken).isViewShown(REPL_VIEW_ID);
    }

    async function start(timing: ISyntheticTiming = NO_DELAY_TIMING): Promise<IDebugSession> {
        registration ??= registerSyntheticDebugger(h.container.get(DebugServiceDIToken).getAdapterManager(), timing);
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

    it("output without a newline continues on the same line", async () => {
        await open();
        const session = await start();

        session.appendToRepl({ output: "Progress: ", sev: "info" });
        session.appendToRepl({ output: "50%", sev: "info" });
        session.appendToRepl({ output: " done\n", sev: "info" });

        await vi.waitFor(() => {
            expect(screen()).toContain("Progress: 50% done");
        });
    });

    it("one output with several lines shows each on its own row", async () => {
        await open();
        const session = await start();

        session.appendToRepl({ output: "first line\nsecond line\n", sev: "info" });

        await vi.waitFor(() => {
            expect(screen()).toContain("second line");
        });
        const rows = lines();
        const first = rows.findIndex((r) => r.includes("first line"));
        expect(rows[first]).not.toContain("second line");
        expect(rows[first + 1]).toContain("second line");
    });

    it("wide characters in output and in the echo keep the panel's border in place", async () => {
        await open();
        const session = await start();
        await vi.waitFor(() => {
            expect(screen()).toContain("Hello from hello");
        });
        const before = lines();
        const borderRow = before.findLastIndex((r) => r.includes("Hello from hello"));
        const width = before[borderRow].length;

        session.appendToRepl({ output: "héllo 世界 🎉 end\n", sev: "info" });
        await evaluate("世界");

        await vi.waitFor(() => {
            expect(screen()).toContain(echo("世界"));
        });
        expect(screen()).toContain("héllo 世界 🎉 end");
        for (const row of lines()) expect(row.length).toBeLessThanOrEqual(width + 8);
    });

    it("on a narrow terminal the input's prompt and the title stay inside the panel", async () => {
        await open(new Size(40, 24));
        await start();

        await vi.waitFor(() => {
            expect(screen()).toContain("warning:");
        });
        const rows = lines();
        expect(rows.some((r) => r.includes(glyph("chevron-right")))).toBe(true);

        h.container.get(ReplDIToken).focus();
        typeText(h.testApp, "a".repeat(60) + "Z");
        // The caret end of a long input is visible.
        expect(screen()).toContain("aZ");
    });

    it("the history survives a reload of the workspace", async () => {
        await open();
        await start();
        await evaluate("cfg");
        await evaluate("sum");
        await evaluate("nums[3] + 1");
        await close();

        // The newest entry comes first, as before the reload.
        await open(new Size(120, 40), state);
        await h.commands.execute(FOCUS_REPL_ID);
        h.testApp.sendKey("ArrowUp");
        expect(h.container.get(ReplDIToken).input.inputState.value).toBe("nums[3] + 1");
        h.testApp.sendKey("ArrowUp");
        expect(h.container.get(ReplDIToken).input.inputState.value).toBe("sum");
    });

    it("the history keeps the last 100 entries", async () => {
        await open();
        await start();
        for (let i = 0; i < 105; i++) await evaluate(`nums[${String(i)}]`);

        const history = state.values.get("debug.repl.history") as string[];
        expect(history).toHaveLength(100);
        expect(history.at(-1)).toBe("nums[104]");
        expect(history[0]).toBe("nums[5]");
    });

    it("a whitespace-only input evaluates nothing", async () => {
        await open();
        const session = await start();
        await vi.waitFor(() => {
            expect(screen()).toContain("Hello from hello");
        });
        const count = session.getReplElements().length;

        h.container.get(ReplDIToken).focus();
        typeText(h.testApp, "   ");
        h.testApp.sendKey("Enter");
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(session.getReplElements()).toHaveLength(count);
        expect(state.values.get("debug.repl.history") ?? []).toEqual([]);
    });

    it("evaluating while the program runs answers in the console", async () => {
        await open();
        await start({ ...NO_DELAY_TIMING, continueMs: 2000 });

        h.testApp.sendKey("F5");
        await vi.waitFor(() => {
            expect(h.container.get(ContextKeyServiceDIToken).getRaw("debugState")).toBe("running");
        });
        await evaluate("sum");

        await vi.waitFor(() => {
            expect(screen()).toContain(echo("sum"));
        });
        const rows = lines();
        const y = rows.findLastIndex((r) => r.includes(echo("sum")));
        expect(rows[y + 1].trim()).not.toBe("");
    });

    it("a second session after the first ended shows its own output and evaluates", async () => {
        await open();
        await start();
        await h.container.get(DebugServiceDIToken).stopSession(undefined);
        await h.commands.execute("workbench.debug.panel.action.clearReplAction");

        await start();

        await vi.waitFor(() => {
            expect(screen()).toContain("Hello from hello");
        });
        await evaluate("nums[3] + 1");
        await vi.waitFor(() => {
            expect(screen()).toContain(echo("nums[3] + 1"));
        });
    });

    it("Ctrl+K Y over the Output view brings the console instead of hiding the panel", async () => {
        await open();
        await h.commands.execute(FOCUS_REPL_ID);
        h.container.get(ViewsServiceDIToken).openView(OUTPUT_VIEW_ID, true);
        expect(consoleShown()).toBe(false);

        h.testApp.sendKey("Ctrl+k");
        h.testApp.sendKey("y");

        expect(consoleShown()).toBe(true);
    });

    it("neverOpen keeps the console closed on start; openOnSessionStart reopens it each session", async () => {
        await open();
        const config = h.container.get(IConfigurationServiceDIToken);
        await config.updateValue("debug.internalConsoleOptions", "neverOpen");
        await start();
        expect(consoleShown()).toBe(false);
        await h.container.get(DebugServiceDIToken).stopSession(undefined);

        await config.updateValue("debug.internalConsoleOptions", "openOnSessionStart");
        await start();
        expect(consoleShown()).toBe(true);
    });

    it("the default opens the console only on the first session", async () => {
        await open();
        await start();
        expect(consoleShown()).toBe(true);
        await h.container.get(DebugServiceDIToken).stopSession(undefined);
        h.container.get(ViewsServiceDIToken).openView(OUTPUT_VIEW_ID, true);
        expect(consoleShown()).toBe(false);

        await start();
        expect(consoleShown()).toBe(false);
    });
});
