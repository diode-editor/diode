import { describe, expect, it } from "vitest";

import { makeViewsHarness, paneTitles, testView } from "./viewsService.testUtils.ts";

function harness() {
    const h = makeViewsHarness();
    h.service.registerContainer({ id: "sb", title: "SB", location: "sidebar", order: 0, isDefault: true });
    h.service.registerView(testView("sb.a", "sb", 0));
    h.service.registerView(testView("sb.b", "sb", 1));
    h.service.registerView(testView("sb.c", "sb", 2, { canMoveView: true }));
    h.service.registerContainer({ id: "solo", title: "SOLO", location: "sidebar", order: 1 });
    h.service.registerView(testView("solo.only", "solo", 0));
    h.service.attachRegisteredContainers();
    return h;
}

describe("ViewsService.unregisterView", () => {
    it("the section leaves its container; an unknown id is a no-op", () => {
        const h = harness();
        h.service.unregisterView("sb.b");
        h.service.unregisterView("nope");
        expect(paneTitles(h.paneView("sb"))).toEqual(["SB.A", "SB.C"]);
        expect(h.service.getViewContainerByViewId("sb.b")).toBeNull();
    });

    it("the last section takes its container out of the sidebar; registering again brings both back", () => {
        const h = harness();
        h.service.unregisterView("solo.only");
        expect(h.viewlets).not.toContain("solo");
        expect(h.service.getViewContainers().map((c) => c.id)).toEqual(["sb"]);

        h.service.registerView(testView("solo.only", "solo", 0));
        expect(h.viewlets).toContain("solo");
    });

    it("the remaining sections never end up all hidden", () => {
        const h = harness();
        h.service.setViewVisible("sb.b", false);
        h.service.setViewVisible("sb.c", false);
        h.service.unregisterView("sb.a");
        // sb.b is shown again: a container of only hidden sections would look empty.
        expect(h.service.isViewVisible("sb.b")).toBe(true);
        expect(h.service.isViewVisible("sb.c")).toBe(false);
    });

    it("a view moved into its own container takes that generated container with it", () => {
        const h = harness();
        h.service.moveViewToLocation("sb.c", "panel");
        const generated = h.service.getViewContainerByViewId("sb.c");
        expect(generated).toMatch(/^workbench\.views\.service\.panel\./);
        h.service.unregisterView("sb.c");
        expect(h.service.getViewContainerLocation(generated ?? "")).toBeNull();
    });
});
