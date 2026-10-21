import { describe, expect, it, vi } from "vitest";

import { SIDEBAR_VIEWS_STATE } from "../../../common/stateKeys.ts";

import { makeViewsHarness, testView as view } from "./viewsService.testUtils.ts";

/** A two-section container — the minimum at which sections can collapse. */
function makeScm(): ReturnType<typeof makeViewsHarness> {
    const h = makeViewsHarness();
    h.service.registerContainer({ id: "scm", title: "SOURCE CONTROL", location: "sidebar" });
    h.service.registerView(view("scm.changes", "scm", 10));
    h.service.registerView(view("scm.graph", "scm", 20));
    return h;
}

describe("ViewsService: section expanded state", () => {
    it("before attachContainer a section is not expanded: its body is not in any tree yet", () => {
        const h = makeScm();
        expect(h.service.isViewExpanded("scm.graph")).toBe(false);

        h.service.attachContainer("scm");
        expect(h.service.isViewExpanded("scm.graph")).toBe(true);
    });

    it("a section collapsed by the chevron is not expanded, its neighbor is", () => {
        const h = makeScm();
        h.service.attachContainer("scm");

        h.paneView("scm").toggleCollapsed("scm.graph");
        expect(h.service.isViewExpanded("scm.graph")).toBe(false);
        expect(h.service.isViewExpanded("scm.changes")).toBe(true);
    });

    it("a section hidden via 'Views' is not expanded", () => {
        const h = makeScm();
        h.service.attachContainer("scm");

        h.service.setViewVisible("scm.graph", false);
        expect(h.service.isViewExpanded("scm.graph")).toBe(false);
    });

    it("a merged section is always expanded: the only visible one does not collapse", () => {
        const h = makeScm();
        h.service.attachContainer("scm");
        h.paneView("scm").toggleCollapsed("scm.graph");
        expect(h.service.isViewExpanded("scm.graph")).toBe(false);

        // The neighbor is hidden — GRAPH is left alone and takes over the container header.
        h.service.setViewVisible("scm.changes", false);
        expect(h.service.isViewExpanded("scm.graph")).toBe(true);
    });

    it("restoreViewsState notifies about restored collapsed state", () => {
        const h = makeScm();
        h.service.attachContainer("scm");
        const seen: [string, boolean][] = [];
        h.service.onDidChangeViewExpanded(({ viewId, expanded }) => seen.push([viewId, expanded]));
        h.stored.set(SIDEBAR_VIEWS_STATE.key, {
            scm: { collapsed: ["scm.graph"], weights: {}, hidden: [] },
        });

        h.service.restoreViewsState();
        expect(seen).toEqual([["scm.graph", false]]);
        expect(h.service.isViewExpanded("scm.graph")).toBe(false);
    });

    it("the event fires on every change and only on a change", () => {
        const h = makeScm();
        const seen: [string, boolean][] = [];
        h.service.onDidChangeViewExpanded(({ viewId, expanded }) => seen.push([viewId, expanded]));

        h.service.attachContainer("scm");
        expect(seen).toEqual([
            ["scm.changes", true],
            ["scm.graph", true],
        ]);

        seen.length = 0;
        h.paneView("scm").toggleCollapsed("scm.graph");
        expect(seen).toEqual([["scm.graph", false]]);

        // A container rebuild keeps the collapsed state, so it is not announced again.
        seen.length = 0;
        h.service.registerView(view("scm.stashes", "scm", 30));
        expect(seen).toEqual([["scm.stashes", true]]);
    });

    it("the subscription can be disposed", () => {
        const h = makeScm();
        const listener = vi.fn();
        h.service.onDidChangeViewExpanded(listener).dispose();

        h.service.attachContainer("scm");
        expect(listener).not.toHaveBeenCalled();
    });
});
