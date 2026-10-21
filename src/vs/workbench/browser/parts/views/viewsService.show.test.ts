import { describe, expect, it, vi } from "vitest";

import type { IViewsHarness } from "./viewsService.testUtils.ts";
import { makeViewsHarness, testView } from "./viewsService.testUtils.ts";

const PROBLEMS = "workbench.panel.markers";
const TERMINAL = "workbench.panel.terminal";
const SEARCH = "workbench.view.search";

/** Panel (PROBLEMS, TERMINAL) and sidebar (SEARCH); show and activate events go to logs. */
function scene(): { h: IViewsHarness; shown: string[]; activated: string[] } {
    const h = makeViewsHarness();
    h.service.registerContainer({ id: SEARCH, title: "SEARCH", location: "sidebar", order: 0 });
    h.service.registerContainer({ id: PROBLEMS, title: "PROBLEMS", location: "panel", order: 0 });
    h.service.registerContainer({ id: TERMINAL, title: "TERMINAL", location: "panel", order: 1 });
    h.service.registerView(testView("search", SEARCH, 10, { canMoveView: true }));
    h.service.registerView(testView("problems", PROBLEMS, 10, { canMoveView: true }));
    h.service.registerView(testView("terminal", TERMINAL, 10, { canMoveView: true }));
    const shown: string[] = [];
    const activated: string[] = [];
    h.service.onDidShowView((id) => shown.push(id));
    h.service.onDidActivateView((id) => activated.push(id));
    h.service.attachRegisteredContainers();
    return { h, shown, activated };
}

describe("ViewsService — view on screen (isViewShown / closeView)", () => {
    it("a view is on screen: its container is active in its part and the part is visible", () => {
        const { h } = scene();
        expect(h.service.isViewShown("problems")).toBe(false);
        h.panelService.setVisible(true);
        expect(h.service.isViewShown("problems")).toBe(true);
        expect(h.service.isViewShown("terminal")).toBe(false);
    });

    it("after a move it is in the new location", () => {
        const { h } = scene();
        h.service.moveViewToLocation("terminal", "auxiliarybar");
        h.auxiliaryBarService.setVisible(true);
        expect(h.service.isViewShown("terminal")).toBe(true);
        expect(h.panelService.visible).toBe(false);
    });

    it("a sidebar viewlet is on screen while it is active", () => {
        const { h } = scene();
        expect(h.service.isViewShown("search")).toBe(false);
        h.showViewlet(SEARCH);
        expect(h.service.isViewShown("search")).toBe(true);
    });

    it("a hidden section and an unknown view are not on screen", () => {
        const { h } = scene();
        h.service.registerView(testView("extra", PROBLEMS, 20));
        h.panelService.setVisible(true);
        h.service.setViewVisible("extra", false);
        expect(h.service.isViewShown("extra")).toBe(false);
        expect(h.service.isViewShown("ghost")).toBe(false);
    });

    it("closeView hides the part if the view is active in it and leaves it alone if the view is in the background", () => {
        const { h } = scene();
        h.panelService.setVisible(true);
        h.service.closeView("terminal");
        expect(h.panelService.visible).toBe(true);
        h.service.closeView("problems");
        expect(h.panelService.visible).toBe(false);
    });

    it("closeView of a viewlet hides the sidebar; an unknown view is a no-op", () => {
        const { h } = scene();
        h.showViewlet(SEARCH);
        h.service.closeView("search");
        h.service.closeView("ghost");
        expect(h.hiddenViewlets).toEqual([SEARCH]);
    });
});

describe("ViewsService — openView without activation", () => {
    it("shows the tab and the part but does not wake lazy features", () => {
        const { h, activated, shown } = scene();
        h.service.moveViewToLocation("terminal", "auxiliarybar");
        activated.length = 0;
        shown.length = 0;
        h.service.openView("terminal", false, false);
        expect(h.auxiliaryBarService.visible).toBe(true);
        expect(activated).toEqual([]);
    });

    it("with activation it wakes them", () => {
        const { h, activated } = scene();
        h.service.openView("terminal");
        expect(activated).toEqual(["terminal"]);
        expect(h.panelService.getActiveViewId()).toBe(TERMINAL);
    });

    it("focuses only on request", () => {
        const h = makeViewsHarness();
        const focus = vi.fn();
        h.service.registerContainer({ id: PROBLEMS, title: "PROBLEMS", location: "panel", order: 0 });
        h.service.registerView(testView("problems", PROBLEMS, 10, { focus }));
        h.service.attachRegisteredContainers();
        h.service.openView("problems");
        expect(focus).not.toHaveBeenCalled();
        h.service.openView("problems", true);
        expect(focus).toHaveBeenCalledTimes(1);
    });

    it("a sidebar viewlet shows even without activation", () => {
        const { h } = scene();
        h.service.openView("search", false, false);
        expect(h.shownViewlets.at(-1)).toEqual({ id: SEARCH, reveal: true });
    });
});

describe("ViewsService — view show and activation events", () => {
    it("the first tab of a part on build is 'shown'", () => {
        const { shown } = scene();
        expect(shown).toContain("problems");
        expect(shown).not.toContain("terminal");
    });

    it("switching the active tab is 'shown', a click is also 'activated'", () => {
        const { h, shown, activated } = scene();
        shown.length = 0;
        h.panelService.setActiveView(TERMINAL);
        expect(shown).toEqual(["terminal"]);
        expect(activated).toEqual([]);
        h.panelService.activateView(PROBLEMS);
        expect(activated).toEqual(["problems"]);
    });

    it("a moved view fires events from its new part", () => {
        const { h, shown, activated } = scene();
        h.service.moveViewToLocation("terminal", "auxiliarybar");
        // The auxiliary bar's only tab became active during the build.
        expect(shown.at(-1)).toBe("terminal");
        const container = h.service.getViewContainerByViewId("terminal")!;
        h.auxiliaryBarService.activateView(container);
        expect(activated).toEqual(["terminal"]);
    });

    it("showing a sidebar viewlet is 'shown'", () => {
        const { h, shown } = scene();
        shown.length = 0;
        h.showViewlet(SEARCH);
        expect(shown).toEqual(["search"]);
    });

    it("a hidden section gets no events", () => {
        const { h, shown } = scene();
        h.service.registerView(testView("extra", TERMINAL, 20));
        h.service.setViewVisible("extra", false);
        shown.length = 0;
        h.panelService.setActiveView(TERMINAL);
        expect(shown).toEqual(["terminal"]);
    });

    it("an event for an unknown tab is ignored", () => {
        const { h, shown } = scene();
        shown.length = 0;
        h.panelService.addView({ id: "foreign", title: "FOREIGN" });
        h.panelService.setActiveView("foreign");
        expect(shown).toEqual([]);
    });
});
