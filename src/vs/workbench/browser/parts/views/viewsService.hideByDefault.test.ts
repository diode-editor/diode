import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { SIDEBAR_VIEWS_STATE } from "../../../common/stateKeys.ts";

import type { IViewsHarness } from "./viewsService.testUtils.ts";
import { makeViewsHarness, testView } from "./viewsService.testUtils.ts";

/** Upstream's Explorer shape: Open Editors (hidden by default) above the file tree. */
function explorer(options: { attach?: boolean; editorsFirst?: boolean } = {}): IViewsHarness {
    const h = makeViewsHarness();
    h.service.registerContainer({ id: "explorer", title: "EXPLORER", location: "sidebar" });
    const editors = testView("openEditors", "explorer", 0, { hideByDefault: true });
    const files = testView("files", "explorer", 10);
    for (const view of options.editorsFirst === true ? [editors, files] : [files, editors]) {
        h.service.registerView(view);
    }
    if (options.attach !== false) h.service.attachContainer("explorer");
    return h;
}

describe("ViewsService — hideByDefault", () => {
    it("the section starts hidden: the container is merged and the menu lists it unchecked", () => {
        const h = explorer();

        expect(h.paneView("explorer").getPaneIds()).toEqual(["files"]);
        expect(h.service.isViewVisible("openEditors")).toBe(false);
        expect(h.service.getContainerViews("explorer")).toEqual([
            { id: "openEditors", title: "OPENEDITORS", visible: false, canToggleVisibility: true },
            { id: "files", title: "FILES", visible: true, canToggleVisibility: true },
        ]);
    });

    it("registered alone first, it still yields to the other section once that one arrives", () => {
        const h = explorer({ editorsFirst: true });

        expect(h.paneView("explorer").getPaneIds()).toEqual(["files"]);
    });

    it("alone in its container it is shown: a container never has zero sections", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "explorer", title: "EXPLORER", location: "sidebar" });
        h.service.registerView(testView("openEditors", "explorer", 0, { hideByDefault: true }));
        h.service.attachContainer("explorer");

        expect(h.paneView("explorer").getPaneIds()).toEqual(["openEditors"]);
    });

    it("showing it is stored, and the stored choice beats the default on the next start", () => {
        const first = explorer();
        first.service.setViewVisible("openEditors", true);
        expect(first.paneView("explorer").getPaneIds()).toEqual(["openEditors", "files"]);
        const saved = first.stored.get(SIDEBAR_VIEWS_STATE.key);
        expect(saved).toMatchObject({ explorer: { hidden: [], visible: ["openEditors"] } });

        const next = explorer();
        next.stored.set(SIDEBAR_VIEWS_STATE.key, saved);
        next.service.restoreViewsState();
        expect(next.paneView("explorer").getPaneIds()).toEqual(["openEditors", "files"]);
    });

    it("hiding it again is stored too: the next start keeps it hidden", () => {
        const first = explorer();
        first.service.setViewVisible("openEditors", true);
        first.service.setViewVisible("openEditors", false);
        const saved = first.stored.get(SIDEBAR_VIEWS_STATE.key) as Record<string, object>;
        expect(saved.explorer).not.toHaveProperty("visible");

        const next = explorer();
        next.service.setViewVisible("openEditors", true);
        next.stored.set(SIDEBAR_VIEWS_STATE.key, saved);
        next.service.restoreViewsState();
        expect(next.paneView("explorer").getPaneIds()).toEqual(["files"]);
    });

    it("a store from before the section existed (no visible list) keeps it hidden", () => {
        const h = explorer();
        h.stored.set(SIDEBAR_VIEWS_STATE.key, { explorer: { collapsed: {}, weights: {}, hidden: [] } });

        h.service.restoreViewsState();

        expect(h.paneView("explorer").getPaneIds()).toEqual(["files"]);
    });

    it("a store hiding everything brings back the regular section, not the hidden-by-default one", () => {
        const h = explorer();
        h.stored.set(SIDEBAR_VIEWS_STATE.key, { explorer: { collapsed: {}, weights: {}, hidden: ["files"] } });

        h.service.restoreViewsState();

        expect(h.paneView("explorer").getPaneIds()).toEqual(["files"]);
    });

    it("re-registering the view keeps the user's choice", () => {
        const h = explorer();
        h.service.setViewVisible("openEditors", true);

        h.service.registerView(testView("openEditors", "explorer", 0, { hideByDefault: true }));

        expect(h.service.isViewVisible("openEditors")).toBe(true);
    });

    it("content bounds set while the section is hidden apply once it is shown", () => {
        const h = explorer();
        h.service.setViewContentBounds("openEditors", { min: 4, max: 4 });
        h.service.setViewVisible("openEditors", true);

        const view = h.paneView("explorer");
        view.layout(BoxConstraints.tight(new Size(30, 22)));
        const state = view.inspectState() as { panes: { id: string; bodyHeight: number }[] };
        expect(state.panes.map((pane) => [pane.id, pane.bodyHeight])).toEqual([
            ["openEditors", 4],
            ["files", 16],
        ]);
    });

    it("content bounds set before the container is attached apply once it is", () => {
        const h = explorer({ attach: false });
        h.service.setViewVisible("openEditors", true);
        h.service.setViewContentBounds("openEditors", { min: 4, max: 4 });
        h.service.attachContainer("explorer");

        const view = h.paneView("explorer");
        view.layout(BoxConstraints.tight(new Size(30, 22)));
        const state = view.inspectState() as { panes: { id: string; bodyHeight: number }[] };
        expect(state.panes.map((pane) => [pane.id, pane.bodyHeight])).toEqual([
            ["openEditors", 4],
            ["files", 16],
        ]);
    });

    it("a regular section registered later is shown", () => {
        const h = explorer();

        h.service.registerView(testView("outline", "explorer", 20));

        expect(h.service.isViewVisible("outline")).toBe(true);
    });

    it("a hidden file tree stays hidden while another regular section shows", () => {
        const h = explorer();
        h.service.registerView(testView("outline", "explorer", 20));
        h.stored.set(SIDEBAR_VIEWS_STATE.key, { explorer: { collapsed: {}, weights: {}, hidden: ["files"] } });

        h.service.restoreViewsState();

        expect(h.paneView("explorer").getPaneIds()).toEqual(["outline"]);
    });

    it("a section without the flag is not affected by the visible list", () => {
        const h = explorer();
        h.stored.set(SIDEBAR_VIEWS_STATE.key, {
            explorer: { collapsed: {}, weights: {}, hidden: [], visible: [] },
        });

        h.service.restoreViewsState();

        expect(h.service.isViewVisible("files")).toBe(true);
    });
});
