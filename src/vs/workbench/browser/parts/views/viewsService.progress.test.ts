import { describe, expect, it } from "vitest";

import type { PaneViewElement } from "./paneViewElement.ts";
import type { IViewsHarness } from "./viewsService.testUtils.ts";
import { makeViewsHarness, testView } from "./viewsService.testUtils.ts";

const PANEL = "workbench.panel.output";

/** Whether the section header is busy — the same path e2e reads it by. */
function paneBusy(paneView: PaneViewElement, id: string): boolean {
    const header = paneView.querySelector(`#paneHeader-${id.replaceAll(".", "-")}`);
    return header?.inspectState()?.busy === true;
}

function scmHarness(views: string[]): IViewsHarness {
    const h = makeViewsHarness();
    h.service.registerContainer({ id: "scm", title: "SOURCE CONTROL", location: "sidebar" });
    views.forEach((id, index) => {
        h.service.registerView(testView(id, "scm", (index + 1) * 10));
    });
    h.service.attachContainer("scm");
    return h;
}

describe("ViewsService — busy spinner", () => {
    it("the frame reaches its section header and is removed", () => {
        const h = scmHarness(["scm.changes", "scm.graph"]);

        h.service.setViewSpinner("scm.changes", "⠋");
        expect(paneBusy(h.paneView("scm"), "scm.changes")).toBe(true);
        expect(paneBusy(h.paneView("scm"), "scm.graph")).toBe(false);

        h.service.setViewSpinner("scm.changes", "⠋");
        expect(paneBusy(h.paneView("scm"), "scm.changes")).toBe(true);

        h.service.setViewSpinner("scm.changes", null);
        expect(paneBusy(h.paneView("scm"), "scm.changes")).toBe(false);
    });

    it("the frame survives a section rebuild", () => {
        const h = scmHarness(["scm.changes", "scm.graph"]);
        h.service.setViewSpinner("scm.changes", "⠋");

        // Hiding the neighbor recreates the container's panes.
        h.service.setViewVisible("scm.graph", false);
        expect(paneBusy(h.paneView("scm"), "scm.changes")).toBe(true);

        h.service.setViewVisible("scm.graph", true);
        expect(paneBusy(h.paneView("scm"), "scm.changes")).toBe(true);
    });

    it("a hidden section remembers the frame and shows it when it returns", () => {
        const h = scmHarness(["scm.changes", "scm.graph"]);
        h.service.setViewVisible("scm.graph", false);

        h.service.setViewSpinner("scm.graph", "⠋");
        h.service.setViewVisible("scm.graph", true);
        expect(paneBusy(h.paneView("scm"), "scm.graph")).toBe(true);
    });

    it("for a merged panel section the frame goes into the tab row controls strip", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: PANEL, title: "OUTPUT", location: "panel" });
        h.service.registerView(testView("panel.output", PANEL, 10));
        h.service.attachContainer(PANEL);
        expect(h.header(PANEL)).toBeNull();

        h.service.setViewSpinner("panel.output", "⠋");
        expect(h.header(PANEL)?.inspectState()).toEqual({ title: "", busy: true });

        // The frame changed — the strip stays and is not rebuilt needlessly.
        h.service.setViewSpinner("panel.output", "⠙");
        expect(h.header(PANEL)?.inspectState()).toEqual({ title: "", busy: true });

        h.service.setViewSpinner("panel.output", null);
        expect(h.header(PANEL)).toBeNull();
    });

    it("in a panel with several sections the frame goes into its section header", () => {
        // Non-merged panel: the container has no header target, and the "hand the frame
        // to the tab bar strip" path must not even try to read it here.
        const h = makeViewsHarness();
        h.service.registerContainer({ id: PANEL, title: "PANEL", location: "panel" });
        h.service.registerView(testView("panel.output", PANEL, 10));
        h.service.registerView(testView("panel.problems", PANEL, 20));
        h.service.attachContainer(PANEL);

        expect(() => {
            h.service.setViewSpinner("panel.problems", "⠋");
        }).not.toThrow();
        const header = h.paneView(PANEL).querySelector("#paneHeader-panel-problems");
        expect(header?.inspectState()?.busy).toBe(true);
    });

    it("progress for an unregistered view is a silent no-op", () => {
        const h = scmHarness(["scm.changes"]);
        expect(() => {
            h.service.setViewSpinner("search", "⠋");
        }).not.toThrow();
    });

    it("a frame before attachContainer is remembered and arrives when the container shows", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "scm", title: "SOURCE CONTROL", location: "sidebar" });
        h.service.registerView(testView("scm.changes", "scm", 10));

        h.service.setViewSpinner("scm.changes", "⠋");
        h.service.attachContainer("scm");
        expect(paneBusy(h.paneView("scm"), "scm.changes")).toBe(true);
    });
});
