import { describe, expect, it } from "vitest";

import { SIDEBAR_VIEWS_STATE } from "../../../common/stateKeys.ts";

import { makeViewsHarness, testView as view } from "./viewsService.testUtils.ts";

/** Source Control in miniature: CHANGES expanded by default, GRAPH collapsed, as in the live editor. */
function makeScm(): ReturnType<typeof makeViewsHarness> {
    const h = makeViewsHarness();
    h.service.registerContainer({ id: "scm", title: "SOURCE CONTROL", location: "sidebar" });
    h.service.registerView(view("scm.changes", "scm", 10));
    h.service.registerView(view("scm.graph", "scm", 20, { collapsed: true }));
    return h;
}

function collapsedMap(h: ReturnType<typeof makeViewsHarness>): Record<string, boolean> {
    const paneView = h.paneView("scm");
    return Object.fromEntries(paneView.getPaneIds().map((id) => [id, paneView.isCollapsed(id)]));
}

describe("ViewsService: descriptor default collapsed state", () => {
    it("collapsed: true: the section appears collapsed, its neighbor expanded", () => {
        const h = makeScm();
        h.service.attachContainer("scm");

        expect(collapsedMap(h)).toEqual({ "scm.changes": false, "scm.graph": true });
        expect(h.service.isViewExpanded("scm.graph")).toBe(false);
        expect(h.service.isViewExpanded("scm.changes")).toBe(true);
    });

    it("without collapsed the section is expanded: the default default is unchanged", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        h.service.registerView(view("scm.changes", "scm", 10));
        h.service.registerView(view("scm.graph", "scm", 20));
        h.service.attachContainer("scm");

        expect(collapsedMap(h)).toEqual({ "scm.changes": false, "scm.graph": false });
    });

    it("saved expanded state OVERRIDES the default: expanded stays expanded", () => {
        const h = makeScm();
        h.stored.set(SIDEBAR_VIEWS_STATE.key, {
            scm: { collapsed: { "scm.changes": false, "scm.graph": false }, weights: {}, hidden: [] },
        });
        h.service.attachContainer("scm");
        h.service.restoreViewsState();

        expect(collapsedMap(h)).toEqual({ "scm.changes": false, "scm.graph": false });
    });

    it("saved collapsed state also applies to a section without a default", () => {
        const h = makeScm();
        h.stored.set(SIDEBAR_VIEWS_STATE.key, {
            scm: { collapsed: { "scm.changes": true, "scm.graph": false }, weights: {}, hidden: [] },
        });
        h.service.attachContainer("scm");
        h.service.restoreViewsState();

        expect(collapsedMap(h)).toEqual({ "scm.changes": true, "scm.graph": false });
    });

    it("a section missing from storage gets its default, not its neighbors' state", () => {
        const h = makeScm();
        // The store only knows CHANGES: GRAPH appeared in a newer editor version.
        h.stored.set(SIDEBAR_VIEWS_STATE.key, {
            scm: { collapsed: { "scm.changes": false }, weights: {}, hidden: [] },
        });
        h.service.attachContainer("scm");
        h.service.restoreViewsState();

        expect(collapsedMap(h)).toEqual({ "scm.changes": false, "scm.graph": true });
    });

    it("legacy storage (an id array) is read: listed ones are collapsed, the rest get their default", () => {
        const h = makeScm();
        h.stored.set(SIDEBAR_VIEWS_STATE.key, {
            scm: { collapsed: ["scm.changes"], weights: {}, hidden: [] },
        });
        h.service.attachContainer("scm");
        h.service.restoreViewsState();

        expect(collapsedMap(h)).toEqual({ "scm.changes": true, "scm.graph": true });
    });

    it("an empty legacy array collapses nothing: each keeps its default", () => {
        const h = makeScm();
        h.stored.set(SIDEBAR_VIEWS_STATE.key, { scm: { collapsed: [], weights: {}, hidden: [] } });
        h.service.attachContainer("scm");
        h.service.restoreViewsState();

        expect(collapsedMap(h)).toEqual({ "scm.changes": false, "scm.graph": true });
    });

    it("expanding a section collapsed by default is stored as an explicit false", () => {
        const h = makeScm();
        h.service.attachContainer("scm");

        h.paneView("scm").toggleCollapsed("scm.graph");
        expect(h.stored.get(SIDEBAR_VIEWS_STATE.key)).toMatchObject({
            scm: { collapsed: { "scm.changes": false, "scm.graph": false } },
        });
    });

    it("rebuilding the container does not restore the default of a section the user expanded", () => {
        const h = makeScm();
        h.service.attachContainer("scm");
        h.paneView("scm").toggleCollapsed("scm.graph");

        h.service.registerView(view("scm.stashes", "scm", 30, { collapsed: true }));
        expect(collapsedMap(h)).toEqual({
            "scm.changes": false,
            "scm.graph": false,
            "scm.stashes": true,
        });
    });

    it("a merged container ignores the default: the only visible section does not collapse", () => {
        const h = makeScm();
        h.service.attachContainer("scm");

        h.service.setViewVisible("scm.changes", false);
        expect(collapsedMap(h)).toEqual({ "scm.graph": false });
        expect(h.service.isViewExpanded("scm.graph")).toBe(true);
    });

    it("a section returned from hiding comes back with its default", () => {
        const h = makeScm();
        h.service.attachContainer("scm");

        h.service.setViewVisible("scm.graph", false);
        h.service.setViewVisible("scm.graph", true);
        expect(collapsedMap(h)).toEqual({ "scm.changes": false, "scm.graph": true });
    });
});
