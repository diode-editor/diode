// The debug toolbar on the whole workbench with the synthetic debugger: in the top right corner of the active group
// while a session is on, find stacked under it, the buttons by the debug state, a click, a narrow group, the move to
// another group, `debug.toolBarLocation`, a session without the toolbar, and the status bar in debugging colors.

import { Point } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugViewletHarness, type IDebugViewletHarness } from "../../../../../TestUtils/debugViewletHarness.ts";
import { SYNTHETIC_LAUNCH_CONFIG } from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { EditorGroupsServiceDIToken } from "../../../services/editor/common/editorGroupsService.ts";
import { LayoutServiceDIToken } from "../../../services/layout/browser/layoutService.ts";
import { FindComponentDIToken } from "../../find/browser/findComponent.ts";

import { DebugServiceDIToken } from "./debugService.ts";

/** The synthetic program's `main.cpp`: the stop opens it, so it stays the editor of the test. */
const FILE = "src/main.cpp";
const BUTTONS = "▶ Continue  ↷ Over  ↓ Into  ↑ Out  ↻ Restart  ■ Stop";
const GLYPHS = "▶  ↷  ↓  ↑  ↻  ■";
const SCREEN_WIDTH = 120;

describe("the debug toolbar in the workbench", () => {
    let ws: ITempWorkspace;
    let t: IDebugViewletHarness;

    beforeEach(async () => {
        ws = createTempWorkspace({ files: { [FILE]: "alpha\nbeta\ngamma\n" } });
        t = await createDebugViewletHarness(ws.dir, ws.dir);
        t.h.workbench.openFile(ws.path(FILE));
    });

    afterEach(async () => {
        await t.dispose();
        ws.dispose();
    });

    function has(text: string): boolean {
        return t.screen().includes(text);
    }

    /** The row of the tab strip of the (single) editor group. */
    function tabRow(): number {
        return t.find("main.cpp").y;
    }

    function click(point: Point, button: "left" | "right" = "left"): void {
        for (const action of ["press", "release"] as const) {
            t.h.testApp.backend.simulateMouse({
                kind: "mouse",
                button,
                action,
                x: point.x + 1,
                y: point.y + 1,
                shiftKey: false,
                altKey: false,
                ctrlKey: false,
                raw: "",
            });
        }
    }

    function openFind(query: string): void {
        t.h.commands.execute("actions.find");
        const find = t.h.container.get(FindComponentDIToken);
        const widget = find.widgetFor(t.h.container.get(EditorGroupsServiceDIToken).activeGroup.id)!;
        widget.setQuery(query);
        widget.onQueryChange?.(query);
    }

    function statusBarBg(): number | undefined {
        const rows = t.lines();
        return t.h.testApp.backend.getBgAt(new Point(0, rows.length - 1));
    }

    it("no session, no toolbar; a stop shows it under the tab strip at the right edge of the group", async () => {
        expect(has("Continue")).toBe(false);

        await t.startStopped();

        const buttons = t.find(BUTTONS);
        // The box's top border is the row under the tabs; a padding column, the border and a margin on the right.
        expect(buttons.y).toBe(tabRow() + 2);
        expect(buttons.x + BUTTONS.length).toBe(SCREEN_WIDTH - 3);
        const vars = t.vars();
        const backend = t.h.testApp.backend;
        expect(backend.getFgAt(buttons)).toBe(vars["debugIcon.continueForeground"]);
        expect(backend.getFgAt(new Point(buttons.x + BUTTONS.indexOf("■"), buttons.y))).toBe(
            vars["debugIcon.stopForeground"],
        );
        // The label keeps the widget's text color, the box its background.
        expect(backend.getFgAt(new Point(buttons.x + 2, buttons.y))).not.toBe(vars["debugIcon.continueForeground"]);
        expect(backend.getBgAt(buttons)).toBe(vars["editorWidget.background"]);
    });

    it("find opens under the toolbar and moves up when the session ends", async () => {
        await t.startStopped();
        openFind("zzz");

        const buttons = t.find(BUTTONS);
        expect(t.find("No results").y).toBe(buttons.y + 3);

        await t.h.container.get(DebugServiceDIToken).stopSession(undefined);
        await vi.waitFor(() => {
            expect(has("Continue")).toBe(false);
        });
        expect(t.find("No results").y).toBe(buttons.y);
    });

    it("find opened first goes down when the toolbar comes", async () => {
        openFind("zzz");
        const before = t.find("No results").y;
        expect(before).toBe(tabRow() + 2);

        await t.startStopped();

        expect(t.find("No results").y).toBe(before + 3);
    });

    it("running: Pause instead of Continue, the steps disabled; stopped again: Continue", async () => {
        await t.startStopped();
        const keys = t.h.container.get(ContextKeyServiceDIToken);

        // Context keys report their changes once per tick.
        keys.set("debugState", "running");
        await vi.waitFor(() => {
            expect(has("Pause")).toBe(true);
        });

        const row = t.find("‖ Pause  ↷ Over  ↓ Into  ↑ Out  ↻ Restart  ■ Stop");
        const vars = t.vars();
        const backend = t.h.testApp.backend;
        expect(backend.getFgAt(row)).toBe(vars["debugIcon.pauseForeground"]);
        expect(backend.getFgAt(new Point(row.x + "‖ Pause  ".length, row.y))).toBe(vars.disabledForeground);
        expect(backend.getFgAt(new Point(row.x + "‖ Pause  ↷ Over  ↓ Into  ↑ Out  ".length, row.y))).toBe(
            vars["debugIcon.restartForeground"],
        );

        keys.set("debugState", "stopped");
        await vi.waitFor(() => {
            expect(has(BUTTONS)).toBe(true);
        });
    });

    it("a click on Over steps over; a click on a disabled button does nothing", async () => {
        const factory = await t.startStopped();
        const adapter = factory.adapters[0];
        const buttons = t.find(BUTTONS);

        click(new Point(buttons.x + BUTTONS.indexOf("Over"), buttons.y));

        await vi.waitFor(() => {
            expect(adapter.requests.some((r) => r.command === "next")).toBe(true);
        });
        await vi.waitFor(() => {
            expect(t.h.container.get(ContextKeyServiceDIToken).getRaw("debugState")).toBe("stopped");
        });

        t.h.container.get(ContextKeyServiceDIToken).set("debugState", "running");
        await vi.waitFor(() => {
            expect(has("‖ Pause  ↷ Over")).toBe(true);
        });
        const row = t.find("‖ Pause  ↷ Over");
        const stepIns = adapter.requests.filter((r) => r.command === "stepIn").length;
        click(new Point(row.x + "‖ Pause  ↷ Over  ↓".length, row.y));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(adapter.requests.filter((r) => r.command === "stepIn").length).toBe(stepIns);
    });

    it("a right click runs nothing; the mouse over an enabled button highlights it", async () => {
        const factory = await t.startStopped();
        const buttons = t.find(BUTTONS);
        const over = new Point(buttons.x + BUTTONS.indexOf("Over"), buttons.y);

        click(over, "right");
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(factory.adapters[0].requests.some((r) => r.command === "next")).toBe(false);

        t.h.testApp.backend.simulateMouse({
            kind: "mouse",
            button: "none",
            action: "move",
            x: over.x + 1,
            y: over.y + 1,
            shiftKey: false,
            altKey: false,
            ctrlKey: false,
            raw: "",
        });
        t.lines();
        // `toolbar.hoverBackground` is translucent: composed over the box.
        const widgetBg = t.vars()["editorWidget.background"];
        expect(t.h.testApp.backend.getBgAt(over)).not.toBe(widgetBg);
        expect(t.h.testApp.backend.getBgAt(buttons)).toBe(widgetBg);
        // The box border is the box's background too.
        expect(t.h.testApp.backend.getBgAt(new Point(buttons.x - 2, buttons.y))).toBe(widgetBg);

        // A context key change that changes nothing on the toolbar keeps its buttons, and the one under the mouse.
        t.h.container.get(ContextKeyServiceDIToken).set("debugState", "stopped");
        t.h.container.get(ContextKeyServiceDIToken).setRaw("toolbarTestUnrelated", true);
        await new Promise((resolve) => setTimeout(resolve, 0));
        t.lines();
        expect(t.h.testApp.backend.getBgAt(over)).not.toBe(widgetBg);
    });

    it("a narrow group gets glyphs only", async () => {
        t.h.container.get(LayoutServiceDIToken).nudgeSidebarWidth(20);
        await t.startStopped();

        const glyphs = t.find(GLYPHS);
        expect(glyphs.y).toBe(tabRow() + 2);
        expect(has("Continue")).toBe(false);
    });

    it("a group that narrows during the session drops the labels, widened again gets them back", async () => {
        await t.startStopped();
        const layout = t.h.container.get(LayoutServiceDIToken);

        layout.nudgeSidebarWidth(20);
        // The toolbar sees the new width after the frame that laid it out.
        t.lines();
        await vi.waitFor(() => {
            expect(has(GLYPHS)).toBe(true);
        });
        expect(t.find(GLYPHS).x + GLYPHS.length).toBe(SCREEN_WIDTH - 3);

        layout.nudgeSidebarWidth(-20);
        t.lines();
        await vi.waitFor(() => {
            expect(has(BUTTONS)).toBe(true);
        });
        expect(t.find(BUTTONS).x + BUTTONS.length).toBe(SCREEN_WIDTH - 3);
    });

    it("follows the active group", async () => {
        await t.startStopped();
        const single = t.find(BUTTONS);

        // Two groups of 30 columns: glyphs only, at the right edge of the new (active) group.
        t.h.commands.execute("workbench.action.splitEditor");
        t.lines();
        await vi.waitFor(() => {
            expect(has(GLYPHS)).toBe(true);
        });
        const right = t.find(GLYPHS);
        expect(right.y).toBe(single.y);
        expect(right.x + GLYPHS.length).toBe(SCREEN_WIDTH - 3);

        t.h.commands.execute("workbench.action.focusFirstEditorGroup");
        const left = t.find(GLYPHS);
        expect(left.y).toBe(single.y);
        expect(left.x).toBeLessThan(right.x);
        expect(t.lines().join("\n").split("▶  ↷")).toHaveLength(2);
    });

    it("find in the group the toolbar leaves moves up", async () => {
        await t.startStopped();
        t.h.commands.execute("workbench.action.splitEditor");
        t.h.commands.execute("workbench.action.focusFirstEditorGroup");
        openFind("zzz");
        t.lines();
        await vi.waitFor(() => {
            expect(has(GLYPHS)).toBe(true);
        });
        const toolbarRow = t.find(GLYPHS).y;
        expect(t.find("No results").y).toBe(toolbarRow + 3);

        t.h.commands.execute("workbench.action.focusSecondEditorGroup");

        expect(t.find("No results").y).toBe(toolbarRow);
    });

    it("debug.toolBarLocation: docked puts the buttons in the Run and Debug title, hidden shows none", async () => {
        const configuration = t.h.container.get(IConfigurationServiceDIToken);
        await t.startStopped();

        await configuration.updateValue("debug.toolBarLocation", "docked");
        expect(has("Continue")).toBe(false);
        const title = t.lines().find((line) => line.includes("RUN AND DEBUG"));
        expect(title).toContain("▶");
        expect(title).toContain("■");

        await configuration.updateValue("debug.toolBarLocation", "hidden");
        expect(has("Continue")).toBe(false);
        expect(t.lines().find((line) => line.includes("RUN AND DEBUG"))).not.toContain("■");

        await configuration.updateValue("debug.toolBarLocation", "commandCenter");
        expect(has(BUTTONS)).toBe(true);
    });

    it("the status bar takes the debugging colors while a session is on (debug.enableStatusBarColor)", async () => {
        const vars = t.vars();
        expect(statusBarBg()).toBe(vars["statusBar.background"]);

        await t.startStopped();
        expect(statusBarBg()).toBe(vars["statusBar.debuggingBackground"]);

        const configuration = t.h.container.get(IConfigurationServiceDIToken);
        await configuration.updateValue("debug.enableStatusBarColor", false);
        expect(statusBarBg()).toBe(vars["statusBar.background"]);
        await configuration.updateValue("debug.enableStatusBarColor", true);
        expect(statusBarBg()).toBe(vars["statusBar.debuggingBackground"]);

        await t.h.container.get(DebugServiceDIToken).stopSession(undefined);
        await vi.waitFor(() => {
            expect(statusBarBg()).toBe(vars["statusBar.background"]);
        });
    });

    it("a click beside the toolbar on its rows reaches the editor", async () => {
        t.h.container.get(LayoutServiceDIToken).nudgeSidebarWidth(20);
        await t.startStopped();
        const glyphs = t.find(GLYPHS);
        const alpha = t.find("alpha");
        expect(alpha.y).toBe(glyphs.y - 1);

        click(new Point(alpha.x + 1, glyphs.y));

        expect(t.screen()).toContain("Ln 2, Col 2");
    });

    it("a session that suppresses the toolbar has none", async () => {
        t.registerDebugger();
        await t.h.container
            .get(DebugServiceDIToken)
            .startDebugging(undefined, { ...SYNTHETIC_LAUNCH_CONFIG }, { suppressDebugToolbar: true });
        await vi.waitFor(() => {
            expect(t.h.container.get(ContextKeyServiceDIToken).getRaw("debugState")).toBe("stopped");
        });

        expect(has("Continue")).toBe(false);
    });
});
