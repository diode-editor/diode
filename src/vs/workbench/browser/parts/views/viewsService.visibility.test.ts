import { describe, expect, it } from "vitest";

import { SIDEBAR_VIEWS_STATE } from "../../../common/stateKeys.ts";

import type { IViewsHarness } from "./viewsService.testUtils.ts";
import { makeViewsHarness, testView } from "./viewsService.testUtils.ts";

function view(id: string, order: number, extra?: Parameters<typeof testView>[3]) {
    return testView(id, "scm", order, extra);
}

/** A three-section container — with two you can't tell "hidden" from "became merged". */
function threeSectionContainer(): IViewsHarness {
    const harness = makeViewsHarness();
    harness.service.registerContainer({ id: "scm", title: "SOURCE CONTROL", location: "sidebar" });
    harness.service.registerView(view("scm.changes", 10));
    harness.service.registerView(view("scm.graph", 20));
    harness.service.registerView(view("scm.stashes", 30));
    harness.service.attachContainer("scm");
    return harness;
}

describe("ViewsService — section visibility", () => {
    it("a hidden section leaves the container, a shown one returns to its place", () => {
        const h = threeSectionContainer();

        h.service.setViewVisible("scm.graph", false);
        expect(h.paneView("scm").getPaneIds()).toEqual(["scm.changes", "scm.stashes"]);
        expect(h.service.isViewVisible("scm.graph")).toBe(false);

        h.service.setViewVisible("scm.graph", true);
        expect(h.paneView("scm").getPaneIds()).toEqual(["scm.changes", "scm.graph", "scm.stashes"]);
        expect(h.service.isViewVisible("scm.graph")).toBe(true);
    });

    it("neighbors' collapsed state and weights survive hiding and restoring a section", () => {
        const h = threeSectionContainer();
        h.paneView("scm").setCollapsed("scm.changes", true);
        h.paneView("scm").setWeights({ "scm.stashes": 6 });

        h.service.setViewVisible("scm.graph", false);
        h.service.setViewVisible("scm.graph", true);

        expect(h.paneView("scm").isCollapsed("scm.changes")).toBe(true);
        expect(h.paneView("scm").getWeights()["scm.stashes"]).toBe(6);
    });

    it("the last visible section cannot be hidden: an empty container has nothing to show", () => {
        const h = threeSectionContainer();
        h.service.setViewVisible("scm.graph", false);
        h.service.setViewVisible("scm.stashes", false);

        h.service.setViewVisible("scm.changes", false);

        expect(h.paneView("scm").getPaneIds()).toEqual(["scm.changes"]);
        expect(h.service.isViewVisible("scm.changes")).toBe(true);
    });

    it("hiding the second-to-last section merges headers, restoring splits them", () => {
        const h = threeSectionContainer();
        h.service.setViewVisible("scm.stashes", false);
        h.service.setViewVisible("scm.graph", false);

        expect(h.header("scm")).toBeNull();
        expect(h.paneView("scm").querySelector("#paneHeader-scm-changes")!.inspectState()).toMatchObject({
            title: "SCM.CHANGES",
            collapsible: false,
        });

        h.service.setViewVisible("scm.graph", true);
        expect(h.header("scm")!.inspectState()).toEqual({ title: "SOURCE CONTROL", busy: false });
        expect(h.paneView("scm").querySelector("#paneHeader-scm-changes")!.inspectState()).toMatchObject({
            title: "SCM.CHANGES",
            collapsible: true,
        });
    });

    it("canToggleVisibility: false: the section does not hide", () => {
        const harness = makeViewsHarness();
        harness.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        harness.service.registerView(view("scm.changes", 10, { canToggleVisibility: false }));
        harness.service.registerView(view("scm.graph", 20));
        harness.service.attachContainer("scm");

        harness.service.setViewVisible("scm.changes", false);
        expect(harness.paneView("scm").getPaneIds()).toEqual(["scm.changes", "scm.graph"]);
    });

    it("getContainerViews returns a snapshot for the toggle", () => {
        const h = threeSectionContainer();
        h.service.setViewVisible("scm.graph", false);
        expect(h.service.getContainerViews("scm")).toEqual([
            { id: "scm.changes", title: "SCM.CHANGES", visible: true, canToggleVisibility: true },
            { id: "scm.graph", title: "SCM.GRAPH", visible: false, canToggleVisibility: true },
            { id: "scm.stashes", title: "SCM.STASHES", visible: true, canToggleVisibility: true },
        ]);
    });

    it("hiding is a user action: it is stored together with collapsed state", () => {
        const h = threeSectionContainer();
        h.service.setViewVisible("scm.graph", false);
        expect(h.stored.get(SIDEBAR_VIEWS_STATE.key)).toMatchObject({ scm: { hidden: ["scm.graph"] } });
    });

    it("hiding an already hidden section is a no-op without a storage write", () => {
        const h = threeSectionContainer();
        h.service.setViewVisible("scm.graph", false);
        h.stored.delete(SIDEBAR_VIEWS_STATE.key);
        h.service.setViewVisible("scm.graph", false);
        expect(h.stored.has(SIDEBAR_VIEWS_STATE.key)).toBe(false);
    });

    it("before attach hiding is only remembered: the container builds without the section", () => {
        const harness = makeViewsHarness();
        harness.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        harness.service.registerView(view("scm.changes", 10));
        harness.service.registerView(view("scm.graph", 20));
        harness.service.setViewVisible("scm.graph", false);
        harness.service.attachContainer("scm");
        expect(harness.paneView("scm").getPaneIds()).toEqual(["scm.changes"]);
    });
});

describe("ViewsService — restoring hidden state", () => {
    it("saved hidden state applies together with weights and collapsed state", () => {
        const harness = makeViewsHarness();
        harness.stored.set(SIDEBAR_VIEWS_STATE.key, {
            scm: { collapsed: ["scm.stashes"], weights: { "scm.changes": 5 }, hidden: ["scm.graph"] },
        });
        harness.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        harness.service.registerView(view("scm.changes", 10));
        harness.service.registerView(view("scm.graph", 20));
        harness.service.registerView(view("scm.stashes", 30));
        harness.service.attachContainer("scm");

        harness.service.restoreViewsState();

        expect(harness.paneView("scm").getPaneIds()).toEqual(["scm.changes", "scm.stashes"]);
        expect(harness.paneView("scm").isCollapsed("scm.stashes")).toBe(true);
        expect(harness.paneView("scm").getWeights()["scm.changes"]).toBe(5);
    });

    it("opening the workspace storage (Open Folder) applies it to built containers by itself", () => {
        const harness = makeViewsHarness();
        harness.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        harness.service.registerView(view("scm.changes", 10));
        harness.service.registerView(view("scm.graph", 20));
        harness.service.attachContainer("scm");
        harness.stored.set(SIDEBAR_VIEWS_STATE.key, { scm: { collapsed: [], weights: {}, hidden: ["scm.graph"] } });

        harness.openWorkspace();

        expect(harness.paneView("scm").getPaneIds()).toEqual(["scm.changes"]);
    });

    it("storage without a hidden field reads as 'nothing hidden'", () => {
        const harness = makeViewsHarness();
        harness.stored.set(SIDEBAR_VIEWS_STATE.key, { scm: { collapsed: [], weights: {} } });
        harness.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        harness.service.registerView(view("scm.changes", 10));
        harness.service.registerView(view("scm.graph", 20));
        harness.service.attachContainer("scm");

        harness.service.restoreViewsState();
        expect(harness.paneView("scm").getPaneIds()).toEqual(["scm.changes", "scm.graph"]);
    });

    it("stale storage hiding everything keeps the first section visible", () => {
        const harness = makeViewsHarness();
        harness.stored.set(SIDEBAR_VIEWS_STATE.key, {
            scm: { collapsed: [], weights: {}, hidden: ["scm.changes", "scm.graph"] },
        });
        harness.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        harness.service.registerView(view("scm.changes", 10));
        harness.service.registerView(view("scm.graph", 20));
        harness.service.attachContainer("scm");

        harness.service.restoreViewsState();
        expect(harness.paneView("scm").getPaneIds()).toEqual(["scm.changes"]);
    });

    it("storage cannot hide a section that forbids it and ignores unknown ids", () => {
        const harness = makeViewsHarness();
        harness.stored.set(SIDEBAR_VIEWS_STATE.key, {
            scm: { collapsed: [], weights: {}, hidden: ["scm.changes", "scm.ghost"] },
        });
        harness.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        harness.service.registerView(view("scm.changes", 10, { canToggleVisibility: false }));
        harness.service.registerView(view("scm.graph", 20));
        harness.service.attachContainer("scm");

        harness.service.restoreViewsState();
        expect(harness.paneView("scm").getPaneIds()).toEqual(["scm.changes", "scm.graph"]);
    });
});
