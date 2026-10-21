import { describe, expect, it } from "vitest";

import type { MenuContribution } from "../../../../platform/actions/common/iMenuContribution.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";

import type { IViewsHarness } from "./viewsService.testUtils.ts";
import { makeViewsHarness, testView } from "./viewsService.testUtils.ts";

const AUX = "test.auxiliary.container";
const PANEL = "test.panel.container";
const REFRESH: MenuContribution = {
    menuId: MenuId.ViewTitle,
    command: "aux.refresh",
    title: "Refresh",
    icon: "R",
    group: "navigation",
};

/** Same model as the bottom panel (upstream both are `AbstractPaneCompositePart`); registry: `AuxiliaryBarService`. */
function auxiliaryHarness(views: string[], contributions: MenuContribution[] = []): IViewsHarness {
    const h = makeViewsHarness(contributions);
    h.service.registerContainer({ id: AUX, title: "AUX", location: "auxiliarybar" });
    views.forEach((id, index) => {
        h.service.registerView(testView(id, AUX, (index + 1) * 10));
    });
    h.service.attachContainer(AUX);
    return h;
}

describe("ViewsService — container in the secondary side bar", () => {
    it("registers as a secondary side bar tab, not a bottom panel tab or a viewlet", () => {
        const h = auxiliaryHarness(["aux.view"]);
        const tab = h.auxiliaryBarService.getViews().find((v) => v.id === AUX);
        expect(tab?.title).toBe("AUX");
        expect(tab?.content).toBe(h.paneView(AUX));
        expect(h.panelService.getViews()).toEqual([]);
        expect(h.viewlets).toEqual([]);
    });

    it("single section has no header row of its own: the tab is the header", () => {
        const h = auxiliaryHarness(["aux.view"]);
        expect(h.paneView(AUX).querySelector("#paneHeader-aux-view")!.hidden).toBe(true);
    });

    it("tab order follows order and only among containers of this part", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: PANEL, title: "P", location: "panel", order: 0 });
        h.service.registerContainer({ id: "aux.b", title: "B", location: "auxiliarybar", order: 2 });
        h.service.registerContainer({ id: "aux.a", title: "A", location: "auxiliarybar", order: 1 });
        for (const id of [PANEL, "aux.b", "aux.a"]) h.service.registerView(testView(`${id}.view`, id, 10));
        h.service.attachContainer(PANEL);
        h.service.attachContainer("aux.b");
        h.service.attachContainer("aux.a");
        expect(h.auxiliaryBarService.getViews().map((v) => v.id)).toEqual(["aux.a", "aux.b"]);
        expect(h.panelService.getViews().map((v) => v.id)).toEqual([PANEL]);
    });

    it("the only section's buttons move into the secondary side bar tab row", () => {
        const h = auxiliaryHarness(["aux.view"], [REFRESH]);
        expect(h.tabActions(AUX)).not.toBeNull();
    });

    it("without buttons there is no strip in the tab row", () => {
        const h = auxiliaryHarness(["aux.view"]);
        expect(h.tabActions(AUX)).toBeNull();
    });

    it("a container that becomes the active secondary side bar tab computes its buttons", () => {
        const h = makeViewsHarness([REFRESH]);
        h.service.registerContainer({ id: "aux.a", title: "A", location: "auxiliarybar", order: 1 });
        h.service.registerContainer({ id: "aux.b", title: "B", location: "auxiliarybar", order: 2 });
        h.service.registerView(testView("aux.a.view", "aux.a", 10));
        h.service.registerView(testView("aux.b.view", "aux.b", 10));
        h.service.attachContainer("aux.a");
        h.service.attachContainer("aux.b");
        // Hidden tab B catches up when shown (like a bottom panel tab).
        h.auxiliaryBarService.setActiveView("aux.b");
        expect(h.tabActions("aux.b")).not.toBeNull();
    });
});
