import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { describe, expect, it, vi } from "vitest";

import { SIDEBAR_VIEWS_STATE } from "../../../common/stateKeys.ts";

import { ViewContainerHeaderElement } from "./viewContainerHeaderElement.ts";
import { makeViewsHarness, paneTitles, testView as view } from "./viewsService.testUtils.ts";

describe("ViewsService", () => {
    it("attachContainer builds a header above the sections and registers the container", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "scm", title: "SOURCE CONTROL", location: "sidebar" });
        h.service.registerView(view("scm.changes", "scm", 10));
        h.service.registerView(view("scm.graph", "scm", 20));
        h.service.attachContainer("scm");

        const header = h.header("scm");
        expect(header).toBeInstanceOf(ViewContainerHeaderElement);
        expect(header?.inspectState()).toEqual({ title: "SOURCE CONTROL", busy: false });
        expect(h.paneView("scm").getPaneIds()).toEqual(["scm.changes", "scm.graph"]);
    });

    it("sections follow order, not registration order", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        h.service.registerView(view("scm.graph", "scm", 20));
        h.service.registerView(view("scm.changes", "scm", 10));
        h.service.attachContainer("scm");
        expect(h.paneView("scm").getPaneIds()).toEqual(["scm.changes", "scm.graph"]);
    });

    it("late view registration rebuilds an already built container", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        h.service.registerView(view("scm.graph", "scm", 20));
        h.service.attachContainer("scm");
        h.service.registerView(view("scm.changes", "scm", 10));
        expect(h.paneView("scm").getPaneIds()).toEqual(["scm.changes", "scm.graph"]);
    });

    it("repeated attachContainer is a no-op", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        h.service.registerView(view("scm.changes", "scm", 10));
        h.service.attachContainer("scm");
        const first = h.root("scm");
        h.service.attachContainer("scm");
        expect(h.root("scm")).toBe(first);
    });

    it("a user action writes collapsed state and weights through to storage", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        h.service.registerView(view("scm.changes", "scm", 10));
        h.service.registerView(view("scm.graph", "scm", 20));
        h.service.attachContainer("scm");

        h.paneView("scm").toggleCollapsed("scm.graph");
        expect(h.stored.get(SIDEBAR_VIEWS_STATE.key)).toEqual({
            scm: {
                // BOTH states are written: being expanded is also the user's choice.
                collapsed: { "scm.changes": false, "scm.graph": true },
                weights: { "scm.changes": 1, "scm.graph": 1 },
                hidden: [],
            },
        });
    });

    it("restoreViewsState applies saved state without write-through", () => {
        const h = makeViewsHarness();
        h.stored.set(SIDEBAR_VIEWS_STATE.key, {
            scm: { collapsed: ["scm.graph"], weights: { "scm.changes": 7, "scm.graph": 3 } },
        });
        h.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        h.service.registerView(view("scm.changes", "scm", 10));
        h.service.registerView(view("scm.graph", "scm", 20));
        h.service.attachContainer("scm");
        // A container without saved state and an unattached one are skipped.
        h.service.registerContainer({ id: "explorer", title: "EXPLORER", location: "sidebar" });
        h.service.registerView(view("files", "explorer", 10));
        h.service.attachContainer("explorer");
        h.service.registerContainer({ id: "detached", title: "DETACHED", location: "sidebar" });
        const before = h.stored.get(SIDEBAR_VIEWS_STATE.key);

        h.service.restoreViewsState();
        const paneView = h.paneView("scm");
        expect(paneView.isCollapsed("scm.graph")).toBe(true);
        expect(paneView.getWeights()).toEqual({ "scm.changes": 7, "scm.graph": 3 });
        expect(h.stored.get(SIDEBAR_VIEWS_STATE.key)).toBe(before);
    });

    it("revealing a container focuses its first expanded view", () => {
        const h = makeViewsHarness();
        const focusChanges = vi.fn();
        const focusGraph = vi.fn();
        h.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        h.service.registerView(view("scm.changes", "scm", 10, { focus: focusChanges }));
        h.service.registerView(view("scm.graph", "scm", 20, { focus: focusGraph }));
        h.service.attachContainer("scm");
        h.paneView("scm").setCollapsed("scm.changes", true);

        h.focus("scm");
        expect(focusChanges).not.toHaveBeenCalled();
        expect(focusGraph).toHaveBeenCalledOnce();

        // The harness doesn't stay silent on a typo in the container id.
        expect(() => {
            h.focus("nope");
        }).toThrow(/is not registered/);
    });

    it("a view can be registered before its container (components are created before the workbench)", () => {
        const h = makeViewsHarness();
        h.service.registerView(view("scm.changes", "scm", 10));
        h.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        h.service.attachContainer("scm");
        expect(h.paneView("scm").getPaneIds()).toEqual(["scm.changes"]);
    });

    it("re-registering a view replaces the descriptor (setWorkspaceFolder idempotency)", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        h.service.registerView(view("scm.changes", "scm", 10));
        h.service.attachContainer("scm");
        h.service.registerView(view("scm.changes", "scm", 10));
        expect(h.paneView("scm").getPaneIds()).toEqual(["scm.changes"]);
    });

    it("sections with equal order are sorted by id", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        h.service.registerView(view("scm.zeta", "scm", 10));
        h.service.registerView(view("scm.alpha", "scm", 10));
        h.service.attachContainer("scm");
        expect(h.paneView("scm").getPaneIds()).toEqual(["scm.alpha", "scm.zeta"]);
    });

    it("focusContainer before attach and on a container without views is a silent no-op", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        expect(() => {
            h.service.focusContainer("scm");
        }).not.toThrow();
        h.service.attachContainer("scm");
        expect(() => {
            h.service.focusContainer("scm");
        }).not.toThrow();
    });

    it("all sections collapsed: focus goes to the container's first view", () => {
        const h = makeViewsHarness();
        const focusChanges = vi.fn();
        const focusGraph = vi.fn();
        h.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        h.service.registerView(view("scm.changes", "scm", 10, { focus: focusChanges }));
        h.service.registerView(view("scm.graph", "scm", 20, { focus: focusGraph }));
        h.service.attachContainer("scm");
        h.paneView("scm").setCollapsed("scm.changes", true);
        h.paneView("scm").setCollapsed("scm.graph", true);
        h.service.focusContainer("scm");
        expect(focusChanges).toHaveBeenCalledOnce();
        expect(focusGraph).not.toHaveBeenCalled();
    });

    it("attaching an unregistered container throws", () => {
        const h = makeViewsHarness();
        h.service.registerView(view("x", "ghost", 1));
        expect(() => {
            h.service.attachContainer("ghost");
        }).toThrow(/is not registered/);
        expect(() => {
            h.service.attachContainer("missing");
        }).toThrow(/unknown container id/);
    });

    it("accessing an unknown view throws", () => {
        const h = makeViewsHarness();
        expect(() => h.service.isViewVisible("nope")).toThrow(/unknown view id/);
    });
});

describe("ViewsService — merged container derives from the number of visible sections", () => {
    it("single view: no container header, the section carries its title and does not collapse", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "search", title: "SEARCH", location: "sidebar" });
        h.service.registerView(view("search.results", "search", 10));
        h.service.attachContainer("search");

        expect(h.header("search")).toBeNull();
        const paneView = h.paneView("search");
        expect(paneView.getPaneIds()).toEqual(["search.results"]);

        const header = paneView.querySelector("#paneHeader-search-results")!;
        expect(header.inspectState()).toMatchObject({ title: "SEARCH", collapsible: false });

        // Not collapsible: both a stale persisted state and the programmatic path are no-ops.
        paneView.setCollapsed("search.results", true);
        expect(paneView.isCollapsed("search.results")).toBe(false);
    });

    it("a second view splits the headers: the container header appears, sections become collapsible", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "search", title: "SEARCH", location: "sidebar" });
        h.service.registerView(view("search.results", "search", 10));
        h.service.attachContainer("search");
        const rootBefore = h.root("search");

        h.service.registerView(view("search.extra", "search", 20));

        // The container root is stable — the location holds the same reference.
        expect(h.root("search")).toBe(rootBefore);
        expect(h.header("search")?.inspectState()).toEqual({ title: "SEARCH", busy: false });
        expect(paneTitles(h.paneView("search"))).toEqual(["SEARCH.RESULTS", "SEARCH.EXTRA"]);
        expect(h.paneView("search").querySelector("#paneHeader-search-results")!.inspectState()).toMatchObject({
            collapsible: true,
        });
    });

    it("leading spaces of a container title do not leak into the merged section", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "scm", title: "  SOURCE CONTROL", location: "sidebar" });
        h.service.registerView(view("scm.changes", "scm", 10));
        h.service.attachContainer("scm");
        expect(paneTitles(h.paneView("scm"))).toEqual(["SOURCE CONTROL"]);
    });

    it("restoreViewsState with stale collapsed state does not collapse the merged section", () => {
        const h = makeViewsHarness();
        h.stored.set(SIDEBAR_VIEWS_STATE.key, {
            search: { collapsed: ["search.results"], weights: { "search.results": 5 } },
        });
        h.service.registerContainer({ id: "search", title: "SEARCH", location: "sidebar" });
        h.service.registerView(view("search.results", "search", 10));
        h.service.attachContainer("search");

        h.service.restoreViewsState();
        expect(h.paneView("search").isCollapsed("search.results")).toBe(false);
    });
});

describe("ViewsService — view body and title widget", () => {
    it("setViewBody replaces the body in place, keeping collapsed state and weight", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        h.service.registerView(view("scm.changes", "scm", 10));
        h.service.registerView(view("scm.graph", "scm", 20));
        h.service.attachContainer("scm");
        const paneView = h.paneView("scm");
        paneView.setCollapsed("scm.graph", true);
        paneView.setWeights({ "scm.changes": 4 });

        const next = new FillerElement();
        next.id = "changes-next";
        h.service.setViewBody("scm.changes", next);

        expect(paneView.querySelector("#changes-next")).toBe(next);
        expect(paneView.querySelector("#scm.changes-body")).toBeNull();
        expect(paneView.isCollapsed("scm.graph")).toBe(true);
        expect(paneView.getWeights()["scm.changes"]).toBe(4);
    });

    it("body === null renders the placeholder, restoring the body removes it", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "panelish", title: "PROBLEMS", location: "sidebar" });
        h.service.registerView(
            view("problems.view", "panelish", 10, { body: null, placeholder: "No problems have been detected." }),
        );
        h.service.attachContainer("panelish");

        const paneView = h.paneView("panelish");
        const placeholder = paneView.querySelector("#viewPlaceholder-problems-view") as TextLabelElement;
        expect(placeholder.getText()).toBe("No problems have been detected.");

        const tree = new FillerElement();
        tree.id = "problems-tree";
        h.service.setViewBody("problems.view", tree);
        expect(paneView.querySelector("#problems-tree")).toBe(tree);
        expect(paneView.querySelector("#viewPlaceholder-problems-view")).toBeNull();
    });

    it("setViewBody with the same body is a no-op; on a hidden section it only remembers it", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        h.service.registerView(view("scm.changes", "scm", 10));
        h.service.registerView(view("scm.graph", "scm", 20));
        h.service.attachContainer("scm");
        h.service.setViewVisible("scm.graph", false);

        const next = new FillerElement();
        next.id = "graph-next";
        h.service.setViewBody("scm.graph", next);
        expect(h.paneView("scm").querySelector("#graph-next")).toBeNull();

        h.service.setViewVisible("scm.graph", true);
        expect(h.paneView("scm").querySelector("#graph-next")).toBe(next);
        expect(() => {
            h.service.setViewBody("scm.graph", next);
        }).not.toThrow();
    });

    it("the title widget goes into the section header", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        h.service.registerView(view("scm.changes", "scm", 10));
        h.service.registerView(view("scm.graph", "scm", 20));
        h.service.attachContainer("scm");
        expect(h.service.getViewTitleWidget("scm.changes")).toBeNull();

        const widget = new FillerElement();
        widget.id = "channel-picker";
        h.service.setViewTitleWidget("scm.changes", widget);
        expect(h.service.getViewTitleWidget("scm.changes")).toBe(widget);
        expect(h.paneView("scm").querySelector("#channel-picker")).toBe(widget);
    });
});
