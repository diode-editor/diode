// Run and Debug on the whole workbench with the synthetic debugger: what the user sees in the sidebar — the
// welcome without a session, VARIABLES of the stop with the chunks of `nums`, the highlight of a value changed by
// the next stop, and WATCH with the division by zero; keys through the real keybinding dispatcher.

import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { typeText } from "../../../../../TestUtils/domQueries.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_LAUNCH_CONFIG,
    type SyntheticDebugAdapterFactory,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { MenuRegistryDIToken } from "../../../../platform/actions/common/menuRegistry.ts";
import { ClipboardDIToken } from "../../../../platform/clipboard/common/iClipboard.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { computeThemeVars } from "../../../../platform/theme/browser/themeStyleVars.ts";
import { ProductIconServiceDIToken } from "../../../../platform/theme/common/productIconService.ts";
import { SidebarServiceDIToken } from "../../../browser/parts/sidebar/sidebarService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { WorkbenchContextKeysDIToken } from "../../../browser/workbenchContextKeys.ts";
import { LayoutServiceDIToken } from "../../../services/layout/browser/layoutService.ts";
import { ThemeServiceDIToken } from "../../../services/themes/common/themeTokens.ts";
import {
    BREAKPOINTS_VIEW_ID,
    CALLSTACK_VIEW_ID,
    VARIABLES_VIEW_ID,
    VIEWLET_ID,
    WATCH_VIEW_ID,
} from "../common/debug.ts";

import { DebugServiceDIToken } from "./debugService.ts";
import { DebugViewletComponentDIToken } from "./debugViewlet.ts";

describe("Run and Debug viewlet in the workbench", () => {
    let h: IAppHarness;
    let registration: (IDisposable & { factory: SyntheticDebugAdapterFactory }) | undefined;

    beforeEach(async () => {
        // The sidebar's frame, its container line and the lines around the four section headers take 10 rows:
        // the sections keep the heights they had in 50.
        h = createAppTestHarness({ size: new Size(120, 60) });
        await h.workbench.activate();
        // The frame also takes a column on each side: the rows keep the width the texts below are cut at.
        h.container.get(LayoutServiceDIToken).nudgeSidebarWidth(2);
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

    function at(point: Point, dx: number): Point {
        return new Point(point.x + dx, point.y);
    }

    /** Where `text` starts on screen. */
    function find(text: string): Point {
        const rows = lines();
        const y = rows.findIndex((row) => row.includes(text));
        expect(y, `"${text}" on screen`).toBeGreaterThanOrEqual(0);
        return new Point(rows[y].indexOf(text), y);
    }

    function vars(): Record<string, number> {
        return computeThemeVars(h.container.get(ThemeServiceDIToken).theme);
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

    it("without a session: the full-width Run and Debug button over the launch.json hint, and an empty WATCH", () => {
        h.testApp.sendKey("Ctrl+k");
        h.testApp.sendKey("b");

        const text = screen();
        expect(text).toContain("RUN AND DEBUG");
        expect(text).toContain("VARIABLES");
        expect(text).toContain("WATCH");
        // Wrapped to the width of the sidebar.
        expect(find("launch.json file.").y).toBe(find("To customize Run and Debug").y + 1);
        const button = find("Run and Debug");
        // A blank row above and below the button, then the hint.
        const left = find("To customize").x;
        const sidebar = (y: number): string => {
            const row = lines()[y];
            return row.slice(left, left + 26).trim();
        };
        expect(sidebar(button.y - 1)).toBe("");
        expect(sidebar(button.y + 1)).toBe("");
        expect(find("To customize Run and Debug").y).toBe(button.y + 2);
        // The section's focus goes to the button: Enter would start debugging.
        expect(h.container.get(DebugViewletComponentDIToken).runButton.isFocused).toBe(true);
        // Full width: from the column of the text under it, the padding column before it keeps the sidebar's color.
        const hint = find("To customize");
        const background = vars()["button.hoverBackground"];
        expect(h.testApp.backend.getBgAt(new Point(hint.x, button.y))).toBe(background);
        expect(h.testApp.backend.getBgAt(button)).toBe(background);
        expect(h.testApp.backend.getBgAt(new Point(hint.x - 1, button.y))).not.toBe(background);

        h.container.get(DebugViewletComponentDIToken).watch.focus();
        h.testApp.render();
        expect(h.testApp.backend.getBgAt(find("Run and Debug"))).toBe(vars()["button.background"]);
    });

    it("the switcher on the title lists it as Run and Debug; its views can be moved", () => {
        h.testApp.sendKey("Ctrl+k");
        h.testApp.sendKey("b");
        const title = find("RUN AND DEBUG");
        for (const action of ["press", "release"] as const) {
            h.testApp.backend.simulateMouse({
                kind: "mouse",
                button: "left",
                action,
                x: title.x + 1,
                y: title.y + 1,
                shiftKey: false,
                altKey: false,
                ctrlKey: false,
                raw: "",
            });
        }

        expect(screen()).toContain("│● Run and Debug  │");
        const views = h.container.get(ViewsServiceDIToken);
        expect(views.canMoveView(VARIABLES_VIEW_ID)).toBe(true);
        expect(views.canMoveView(WATCH_VIEW_ID)).toBe(true);
        expect(views.canMoveView(CALLSTACK_VIEW_ID)).toBe(true);
        expect(views.canMoveView(BREAKPOINTS_VIEW_ID)).toBe(true);
    });

    it("Add Expression asks for the expression; without a session it is not available", async () => {
        await h.commands.execute("workbench.view.debug");
        await h.commands.execute("workbench.debug.viewlet.action.addWatchExpression");
        typeText(h.testApp, "total / count");
        h.testApp.sendKey("Enter");

        await vi.waitFor(() => {
            expect(screen()).toContain("total / count: not available");
        });
        // Not an error: the plain value color, italic.
        const value = find("not available");
        expect(h.testApp.backend.getFgAt(value)).not.toBe(vars()["debugTokenExpression.error"]);
        expect(h.testApp.backend.getFgAt(value)).not.toBe(h.testApp.backend.getFgAt(find("total / count")));
        expect(h.container.get(ContextKeyServiceDIToken).getRaw("watchExpressionsExist")).toBe(true);
    });

    it("Escape on a new expression takes its row away", async () => {
        await h.commands.execute("workbench.view.debug");
        await h.commands.execute("workbench.debug.viewlet.action.addWatchExpression");
        await vi.waitFor(() => {
            expect(h.container.get(DebugServiceDIToken).getModel().getWatchExpressions()).toHaveLength(1);
        });

        h.testApp.sendKey("Escape");

        await vi.waitFor(() => {
            expect(h.container.get(DebugServiceDIToken).getModel().getWatchExpressions()).toHaveLength(0);
        });
        expect(h.container.get(ContextKeyServiceDIToken).getRaw("watchExpressionsExist")).toBe(false);
    });

    it("a stop on a breakpoint opens the viewlet with the first scope expanded; nums → [0..99] → [5]: 67", async () => {
        await startStopped();

        expect(h.container.get(SidebarServiceDIToken).isViewletVisible(VIEWLET_ID)).toBe(true);
        await vi.waitFor(() => {
            const text = screen();
            expect(text).toContain("Locals");
            expect(text).toContain("nums: size=1000");
            expect(text).toContain('name: "accumulator"');
        });
        expect(h.testApp.backend.getFgAt(find("nums:"))).toBe(vars()["debugTokenExpression.name"]);
        expect(h.testApp.backend.getFgAt(find('"accumulator"'))).toBe(vars()["debugTokenExpression.string"]);
        expect(h.testApp.backend.getFgAt(at(find("ok: "), 4))).toBe(vars()["debugTokenExpression.boolean"]);

        const component = h.container.get(DebugViewletComponentDIToken);
        component.variables.focus();
        // Locals, then nums: open it, then the first chunk.
        h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("ArrowRight");
        await vi.waitFor(() => {
            expect(screen()).toContain("[0..99]");
        });
        h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("ArrowRight");
        await vi.waitFor(() => {
            expect(screen()).toContain("[5]: 67");
        });
        expect(h.testApp.backend.getFgAt(at(find("[5]: 67"), 5))).toBe(vars()["debugTokenExpression.number"]);
        expect(h.container.get(ContextKeyServiceDIToken).getRaw("variablesFocused")).toBe(true);
    });

    it("a value changed since the last stop is highlighted for a second", async () => {
        await startStopped();
        await vi.waitFor(() => {
            expect(screen()).toContain("sum: ");
        });
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], shouldAdvanceTime: true });
        try {
            // The synthetic program's first steps stay inside the loop body; the next stop at the breakpoint is 100
            // iterations later.
            h.testApp.sendKey("F5");
            await vi.waitFor(() => {
                expect(screen()).not.toContain("sum: 0");
                const sum = at(find("sum: "), 5);
                expect(h.testApp.backend.getBgAt(sum)).toBe(vars()["debugView.valueChangedHighlight"]);
            });
            // `name` did not change: no highlight.
            expect(h.testApp.backend.getBgAt(find('"accumulator"'))).not.toBe(
                vars()["debugView.valueChangedHighlight"],
            );
            await vi.advanceTimersByTimeAsync(1100);
            await vi.waitFor(() => {
                const sum = at(find("sum: "), 5);
                expect(h.testApp.backend.getBgAt(sum)).not.toBe(vars()["debugView.valueChangedHighlight"]);
                expect(h.testApp.backend.getFgAt(sum)).toBe(vars()["debugTokenExpression.number"]);
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it("WATCH evaluates in the focused frame: the division by zero is an error; F2 edits, Delete removes", async () => {
        await startStopped();
        await h.commands.execute("workbench.debug.viewlet.action.addWatchExpression");
        typeText(h.testApp, "total / count");
        h.testApp.sendKey("Enter");

        // The sidebar cuts the row; the model holds the whole message.
        await vi.waitFor(() => {
            expect(screen()).toContain("total / count: error: divisi");
        });
        expect(h.container.get(DebugServiceDIToken).getModel().getWatchExpressions()[0].value).toBe(
            "error: division by zero",
        );
        const error = find("error: divisi");
        expect(h.testApp.backend.getFgAt(error)).toBe(vars()["debugTokenExpression.error"]);

        const component = h.container.get(DebugViewletComponentDIToken);
        component.watch.focus();
        h.testApp.render();
        expect(h.container.get(ContextKeyServiceDIToken).getRaw("watchExpressionsFocused")).toBe(true);
        expect(h.container.get(ContextKeyServiceDIToken).getRaw("watchItemType")).toBe("expression");

        h.testApp.sendKey("F2");
        await vi.waitFor(() => {
            expect(h.container.get(ContextKeyServiceDIToken).getRaw("expressionSelected")).toBe(true);
        });
        typeText(h.testApp, " + 1");
        h.testApp.sendKey("Enter");
        // The input starts with the whole expression selected: typing replaced it.
        await vi.waitFor(() => {
            expect(screen()).toContain(" + 1: error: expected exp");
        });

        await h.container.get(ClipboardDIToken).writeText("");
        await h.commands.execute("workbench.debug.viewlet.action.copyAllWatchExpressions");
        expect(await h.container.get(ClipboardDIToken).readText()).toBe(" + 1: error: expected expression");

        component.watch.focus();
        h.testApp.render();
        h.testApp.sendKey("Delete");
        await vi.waitFor(() => {
            expect(h.container.get(DebugServiceDIToken).getModel().getWatchExpressions()).toHaveLength(0);
        });
        expect(screen()).not.toContain("expected expression");
    });

    it("the title buttons: VARIABLES Collapse All; WATCH Add, Remove All and Collapse All, the last two need a watch", () => {
        const menus = h.container.get(MenuRegistryDIToken);
        const titleOf = (view: string): { id: string | undefined; enabled: boolean }[] =>
            menus
                .getMenuItemGroups(MenuId.ViewTitle, { view })
                .flatMap((group) => group.entries)
                .flatMap((entry) => ("enabled" in entry ? [{ id: entry.id, enabled: entry.enabled }] : []));

        expect(titleOf(VARIABLES_VIEW_ID)).toEqual([{ id: "variables.collapse", enabled: true }]);
        expect(titleOf(WATCH_VIEW_ID)).toEqual([
            { id: "workbench.debug.viewlet.action.addWatchExpression", enabled: true },
            { id: "workbench.debug.viewlet.action.removeAllWatchExpressions", enabled: false },
            { id: "watch.collapse", enabled: false },
        ]);
        h.container.get(DebugServiceDIToken).addWatchExpression("sum");
        expect(titleOf(WATCH_VIEW_ID).map((item) => item.enabled)).toEqual([true, true, true]);
        // None of them is in the palette.
        for (const id of ["variables.collapse", "watch.collapse", "debug.removeWatchExpression"]) {
            expect(menus.isInCommandPalette(id)).toBe(false);
        }
        expect(menus.isInCommandPalette("workbench.view.debug")).toBe(true);
        expect(h.commands.getTitle("workbench.view.debug")).toBe("View: Show Run and Debug");
    });

    it("Collapse All closes the expanded nodes of each view; Remove All empties WATCH", async () => {
        h.container.get(DebugServiceDIToken).addWatchExpression("p");
        await startStopped();
        await vi.waitFor(() => {
            expect(screen()).toContain("count: 0");
            expect(screen()).toContain("p: {x:1.5, y:-2}");
        });
        const component = h.container.get(DebugViewletComponentDIToken);
        component.watch.focus();
        h.testApp.sendKey("ArrowRight");
        await vi.waitFor(() => {
            expect(screen()).toContain("x: 1.5");
        });
        h.testApp.sendKey("ArrowDown");
        // The keys are read before the next key is resolved.
        h.container.get(WorkbenchContextKeysDIToken).update();
        expect(h.container.get(ContextKeyServiceDIToken).getRaw("watchItemType")).toBe("variable");

        await h.commands.execute("watch.collapse");
        await vi.waitFor(() => {
            expect(screen()).not.toContain("x: 1.5");
        });
        expect(screen()).toContain("count: 0");
        await h.commands.execute("variables.collapse");
        await vi.waitFor(() => {
            expect(screen()).not.toContain("count: 0");
        });
        expect(screen()).toContain("Locals");

        await h.commands.execute("workbench.debug.viewlet.action.removeAllWatchExpressions");
        await vi.waitFor(() => {
            expect(screen()).not.toContain("p: {x:1.5");
        });
        // Focus elsewhere: no watch row type.
        component.variables.focus();
        h.testApp.render();
        expect(h.container.get(ContextKeyServiceDIToken).getRaw("watchItemType")).toBe("");
        expect(h.container.get(ContextKeyServiceDIToken).getRaw("watchExpressionsFocused")).toBe(false);
    });

    it("debug.showVariableTypes shows the types at once; the end of the session brings the welcome back", async () => {
        await startStopped();
        await vi.waitFor(() => {
            expect(screen()).toContain("count: 0");
        });

        await h.container.get(IConfigurationServiceDIToken).updateValue("debug.showVariableTypes", true);
        await vi.waitFor(() => {
            expect(screen()).toContain("count: int = 0");
        });
        // The section's focus goes to the tree while debugging.
        h.container.get(ViewsServiceDIToken).openView(VARIABLES_VIEW_ID, true);
        expect(h.container.get(ContextKeyServiceDIToken).getRaw("variablesFocused")).toBe(true);

        await h.container.get(DebugServiceDIToken).stopSession(undefined);
        await vi.waitFor(() => {
            expect(screen()).toContain("To customize Run and Debug");
        });
        expect(screen()).not.toContain("count: int = 0");
    });

    it("debug.autoExpandLazyVariables reaches the session", async () => {
        await startStopped();
        const session = (): boolean | undefined =>
            h.container.get(DebugServiceDIToken).getViewModel().focusedSession?.autoExpandLazyVariables;
        expect(session()).toBe(false);

        await h.container.get(IConfigurationServiceDIToken).updateValue("debug.autoExpandLazyVariables", "on");

        expect(session()).toBe(true);
    });

    it("Enter on the Run and Debug button runs Start Debugging; the WATCH section takes the focus into its tree", async () => {
        const execute = vi.spyOn(h.commands, "execute");
        h.testApp.sendKey("Ctrl+k");
        h.testApp.sendKey("b");

        h.testApp.sendKey("Enter");

        // Without a launch.json the start asks for the configuration, as F5 does.
        expect(execute).toHaveBeenCalledWith("workbench.action.debug.start");
        h.container.get(ViewsServiceDIToken).openView(WATCH_VIEW_ID, true);
        h.container.get(WorkbenchContextKeysDIToken).update();
        expect(h.container.get(ContextKeyServiceDIToken).getRaw("watchExpressionsFocused")).toBe(true);
    });

    it("Copy All puts one watch expression per line", async () => {
        const debugService = h.container.get(DebugServiceDIToken);
        debugService.addWatchExpression("a");
        debugService.addWatchExpression("b");

        await h.commands.execute("workbench.debug.viewlet.action.copyAllWatchExpressions");

        expect(await h.container.get(ClipboardDIToken).readText()).toBe("a: not available\nb: not available");
    });

    it("Edit and Remove Expression act on the expression they are given, and leave a child variable alone", async () => {
        const debugService = h.container.get(DebugServiceDIToken);
        debugService.addWatchExpression("a");
        debugService.addWatchExpression("p");
        const [a] = debugService.getModel().getWatchExpressions();

        await h.commands.execute("debug.renameWatchExpression", a);
        await vi.waitFor(() => {
            expect(h.container.get(ContextKeyServiceDIToken).getRaw("expressionSelected")).toBe(true);
        });
        h.testApp.sendKey("Escape");
        await h.commands.execute("debug.removeWatchExpression", a);
        expect(
            debugService
                .getModel()
                .getWatchExpressions()
                .map((we) => we.name),
        ).toEqual(["p"]);

        // The focused row is a child of `p`: not an expression, nothing to do.
        await startStopped();
        const component = h.container.get(DebugViewletComponentDIToken);
        component.watch.focus();
        await vi.waitFor(() => {
            expect(screen()).toContain("p: {x:1.5");
        });
        h.testApp.sendKey("Home");
        h.testApp.sendKey("ArrowRight");
        await vi.waitFor(() => {
            expect(screen()).toContain("x: 1.5");
        });
        h.testApp.sendKey("ArrowDown");
        expect(component.watch.tree.focused?.name).toBe("x");
        await h.commands.execute("debug.removeWatchExpression");
        await h.commands.execute("debug.renameWatchExpression");
        expect(
            debugService
                .getModel()
                .getWatchExpressions()
                .map((we) => we.name),
        ).toEqual(["p"]);
        expect(h.container.get(ContextKeyServiceDIToken).getRaw("expressionSelected")).toBe(false);

        // Nor does it cancel an edit under way.
        await h.commands.execute("debug.renameWatchExpression", debugService.getModel().getWatchExpressions()[0]);
        expect(component.watch.tree.focused?.name).toBe("x");
        await h.commands.execute("debug.renameWatchExpression");
        expect(h.container.get(ContextKeyServiceDIToken).getRaw("expressionSelected")).toBe(true);
    });

    it("BREAKPOINTS reads its rows anew on a change of its presentation, not of another setting", async () => {
        const component = h.container.get(DebugViewletComponentDIToken);
        // A refresh drops the source lines the tree presentation shows: they are read again.
        const refresh = vi.spyOn(component.breakpoints, "refresh");
        const configuration = h.container.get(IConfigurationServiceDIToken);

        await configuration.updateValue("debug.showVariableTypes", true);
        expect(refresh).not.toHaveBeenCalled();

        await configuration.updateValue("debug.breakpointsView.presentation", "tree");
        expect(refresh).toHaveBeenCalledOnce();
    });

    it("a change of the glyph set redraws the rows", async () => {
        const component = h.container.get(DebugViewletComponentDIToken);
        const refresh = vi.spyOn(component.watch.tree, "rerender");
        const variables = vi.spyOn(component.variables.tree, "rerender");
        const callStack = vi.spyOn(component.callStack.tree, "rerender");
        const breakpoints = vi.spyOn(component.breakpoints.tree, "rerender");

        const nerdFont = h.container.get(ProductIconServiceDIToken).nerdFont;
        await h.container
            .get(IConfigurationServiceDIToken)
            .updateValue("diode.icons.nerdFont", nerdFont ? "off" : "on");

        await vi.waitFor(() => {
            expect(refresh).toHaveBeenCalled();
            expect(variables).toHaveBeenCalled();
            expect(callStack).toHaveBeenCalled();
            expect(breakpoints).toHaveBeenCalled();
        });
    });
});
