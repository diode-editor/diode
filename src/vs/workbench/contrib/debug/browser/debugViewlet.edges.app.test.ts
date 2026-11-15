// Run and Debug on the whole workbench, the edges seen by the user: WATCH after the session ends, the highlight of
// a watch value changed by the next stop, `debug.openDebug`, Delete and F2/Escape among several expressions, the
// last chunk of a large array.

import { Point, Size } from "@tuidom/core/common/geometryPromitives";
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
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { computeThemeVars } from "../../../../platform/theme/browser/themeStyleVars.ts";
import { SidebarServiceDIToken } from "../../../browser/parts/sidebar/sidebarService.ts";
import { ThemeServiceDIToken } from "../../../services/themes/common/themeTokens.ts";
import { VIEWLET_ID } from "../common/debug.ts";

import { DebugServiceDIToken } from "./debugService.ts";
import { DebugViewletComponentDIToken } from "./debugViewlet.ts";

describe("Run and Debug viewlet: edges", () => {
    let h: IAppHarness;
    let registration: (IDisposable & { factory: SyntheticDebugAdapterFactory }) | undefined;

    beforeEach(async () => {
        h = createAppTestHarness({ size: new Size(120, 50) });
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

    function find(text: string): Point {
        const rows = lines();
        const y = rows.findIndex((row) => row.includes(text));
        expect(y, `"${text}" on screen`).toBeGreaterThanOrEqual(0);
        return new Point(rows[y].indexOf(text), y);
    }

    function highlight(): number {
        return computeThemeVars(h.container.get(ThemeServiceDIToken).theme)["debugView.valueChangedHighlight"];
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

    async function addWatch(expression: string): Promise<void> {
        await h.commands.execute("workbench.debug.viewlet.action.addWatchExpression");
        typeText(h.testApp, expression);
        h.testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(screen()).toContain(`${expression}:`);
        });
    }

    it("the end of the session turns the watch values back to not available", async () => {
        h.container.get(DebugServiceDIToken).addWatchExpression("count");
        await startStopped();
        await vi.waitFor(() => {
            expect(screen()).toContain("count: 0");
        });

        await h.container.get(DebugServiceDIToken).stopSession(undefined);

        await vi.waitFor(() => {
            expect(screen()).toContain("count: not available");
        });
        expect(screen()).not.toContain("count: 0");
    });

    it("a watch value changed by the next stop is highlighted, as upstream's WATCH", async () => {
        h.container.get(DebugServiceDIToken).addWatchExpression("total");
        h.container.get(DebugServiceDIToken).addWatchExpression("count");
        await startStopped();
        await vi.waitFor(() => {
            expect(screen()).toContain("total: 0");
        });

        h.testApp.sendKey("F5");

        await vi.waitFor(() => {
            expect(screen()).not.toContain("total: 0");
            const total = find("total: ");
            expect(h.testApp.backend.getBgAt(new Point(total.x + 7, total.y))).toBe(highlight());
        });
        // `count` stayed 0: no highlight.
        const count = find("count: 0");
        expect(h.testApp.backend.getBgAt(new Point(count.x + 7, count.y))).not.toBe(highlight());
    });

    it("debug.openDebug neverOpen: a stop on a breakpoint leaves the sidebar alone", async () => {
        await h.container.get(IConfigurationServiceDIToken).updateValue("debug.openDebug", "neverOpen");

        await startStopped();

        expect(h.container.get(SidebarServiceDIToken).isViewletVisible(VIEWLET_ID)).toBe(false);
    });

    it("debug.openDebug openOnDebugBreak (default): a stop on an exception does not bring the viewlet back", async () => {
        await startStopped();
        expect(h.container.get(SidebarServiceDIToken).isViewletVisible(VIEWLET_ID)).toBe(true);
        await h.commands.execute("workbench.view.explorer");
        expect(h.container.get(SidebarServiceDIToken).isViewletVisible(VIEWLET_ID)).toBe(false);

        // The third step over of the synthetic program throws.
        for (let i = 0; i < 3; i++) {
            h.testApp.sendKey("F10");
            await vi.waitFor(() => {
                expect(h.container.get(ContextKeyServiceDIToken).getRaw("debugState")).toBe("stopped");
            });
        }
        await vi.waitFor(() => {
            expect(h.container.get(DebugServiceDIToken).getViewModel().focusedThread?.stoppedDetails?.reason).toBe(
                "exception",
            );
        });

        expect(h.container.get(SidebarServiceDIToken).isViewletVisible(VIEWLET_ID)).toBe(false);
    });

    it("Delete removes only the focused expression of several", async () => {
        await h.commands.execute("workbench.view.debug");
        await addWatch("alpha");
        await addWatch("beta");
        await addWatch("gamma");

        const component = h.container.get(DebugViewletComponentDIToken);
        component.watch.focus();
        h.testApp.render();
        h.testApp.sendKey("Home");
        h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("Delete");

        await vi.waitFor(() => {
            expect(
                h.container
                    .get(DebugServiceDIToken)
                    .getModel()
                    .getWatchExpressions()
                    .map((e) => e.name),
            ).toEqual(["alpha", "gamma"]);
        });
        await vi.waitFor(() => {
            const text = screen();
            expect(text).toContain("alpha: not available");
            expect(text).not.toContain("beta:");
            expect(text).toContain("gamma: not available");
        });
    });

    it("Escape in F2 keeps the expression as it was", async () => {
        await h.commands.execute("workbench.view.debug");
        await addWatch("alpha");
        const component = h.container.get(DebugViewletComponentDIToken);
        component.watch.focus();
        h.testApp.render();

        h.testApp.sendKey("F2");
        await vi.waitFor(() => {
            expect(h.container.get(ContextKeyServiceDIToken).getRaw("expressionSelected")).toBe(true);
        });
        typeText(h.testApp, "omega");
        h.testApp.sendKey("Escape");

        await vi.waitFor(() => {
            expect(h.container.get(ContextKeyServiceDIToken).getRaw("expressionSelected")).toBe(false);
        });
        expect(
            h.container
                .get(DebugServiceDIToken)
                .getModel()
                .getWatchExpressions()
                .map((e) => e.name),
        ).toEqual(["alpha"]);
        expect(screen()).toContain("alpha: not available");
    });

    it("the last chunk of nums opens to its last element", async () => {
        await startStopped();
        await vi.waitFor(() => {
            expect(screen()).toContain("nums: size=1000");
        });
        const component = h.container.get(DebugViewletComponentDIToken);
        component.variables.focus();
        h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("ArrowRight");
        await vi.waitFor(() => {
            expect(screen()).toContain("[900..999]");
        });
        const rows = lines();
        const target = rows.findIndex((row) => row.includes("[900..999]"));
        const from = rows.findIndex((row) => row.includes("nums: size=1000"));
        for (let i = from; i < target; i++) h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("ArrowRight");

        await vi.waitFor(() => {
            expect(screen()).toContain("[900]:");
        });
    });
});
