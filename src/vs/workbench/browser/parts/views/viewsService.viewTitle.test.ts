import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { describe, expect, it } from "vitest";

import { makeViewsHarness, paneTitles, testView } from "./viewsService.testUtils.ts";

function harness() {
    const h = makeViewsHarness();
    h.service.registerContainer({ id: "sb", title: "SB", location: "sidebar", order: 0, isDefault: true });
    h.service.registerView(testView("sb.a", "sb", 0));
    h.service.registerView(testView("sb.b", "sb", 1, { body: null, placeholder: "empty" }));
    h.service.attachRegisteredContainers();
    h.showViewlet("sb");
    return h;
}

function headerState(h: ReturnType<typeof harness>, viewId: string): Record<string, unknown> | undefined {
    return h
        .paneView("sb")
        .querySelector(`#paneHeader-${viewId.replaceAll(".", "-")}`)
        ?.inspectState();
}

// An extension's `TreeView.title`/`description` and a tree that arrives for a view whose `when` is false.
describe("ViewsService.setViewTitle", () => {
    it("renames the section and dims the description next to it; undefined returns the registered title", () => {
        const h = harness();
        h.service.setViewTitle("sb.b", "TARGETS", "3 found");
        expect(paneTitles(h.paneView("sb"))).toEqual(["SB.A", "TARGETS"]);
        expect(headerState(h, "sb.b")).toMatchObject({ description: "3 found" });
        expect(h.service.getContainerViews("sb").map((view) => view.title)).toEqual(["SB.A", "TARGETS"]);

        h.service.setViewTitle("sb.b", undefined, null);
        expect(paneTitles(h.paneView("sb"))).toEqual(["SB.A", "SB.B"]);
        expect(headerState(h, "sb.b")).toMatchObject({ description: null });
    });

    it("a new description under the same title is shown", () => {
        const h = harness();
        h.service.setViewTitle("sb.b", "TARGETS", "one");
        h.service.setViewTitle("sb.b", "TARGETS", "two");
        expect(headerState(h, "sb.b")).toMatchObject({ description: "two" });
    });

    it("the same title and description again doesn't rebuild the sections", () => {
        const h = harness();
        h.service.setViewTitle("sb.b", "TARGETS", null);
        const header = h.paneView("sb").querySelector("#paneHeader-sb-b");
        h.service.setViewTitle("sb.b", "TARGETS", null);
        expect(h.paneView("sb").querySelector("#paneHeader-sb-b")).toBe(header);
    });

    it("a hidden section keeps the title for when it shows", () => {
        const h = harness();
        h.service.setViewVisible("sb.b", false);
        h.service.setViewTitle("sb.b", "TARGETS", "x");
        h.service.setViewVisible("sb.b", true);
        expect(paneTitles(h.paneView("sb"))).toEqual(["SB.A", "TARGETS"]);
    });

    it("a view that is not registered gets its title, description and body when it is", () => {
        const h = harness();
        const body = new FillerElement();
        h.service.setViewBody("sb.late", body);
        h.service.setViewTitle("sb.late", "LATE TREE", "desc");
        h.service.registerView(testView("sb.late", "sb", 2, { body: null }));
        expect(paneTitles(h.paneView("sb"))).toEqual(["SB.A", "SB.B", "LATE TREE"]);
        expect(headerState(h, "sb.late")).toMatchObject({ description: "desc" });
        expect(body.getParent()).not.toBeNull();
    });

    it("a title reset while unregistered gives back the registered one", () => {
        const h = harness();
        h.service.setViewTitle("sb.late", "LATE TREE", null);
        h.service.setViewTitle("sb.late", undefined, null);
        h.service.registerView(testView("sb.late", "sb", 2, { body: null }));
        expect(paneTitles(h.paneView("sb"))).toEqual(["SB.A", "SB.B", "SB.LATE"]);
    });

    it("unregistering keeps what the owner gave the view; registering again restores it", () => {
        const h = harness();
        const body = new FillerElement();
        h.service.setViewBody("sb.b", body);
        h.service.setViewTitle("sb.b", "TARGETS", "d");
        h.service.unregisterView("sb.b");
        h.service.registerView(testView("sb.b", "sb", 1, { body: null }));
        expect(paneTitles(h.paneView("sb"))).toEqual(["SB.A", "TARGETS"]);
        expect(headerState(h, "sb.b")).toMatchObject({ description: "d" });
        expect(body.getParent()).not.toBeNull();
    });

    it("a view with only its registered state leaves nothing behind when unregistered", () => {
        const h = harness();
        h.service.unregisterView("sb.b");
        h.service.registerView(testView("sb.b", "sb", 1, { body: null, placeholder: "back" }));
        expect(h.paneView("sb").querySelector("#viewPlaceholder-sb-b")).not.toBeNull();
    });

    it("a body reset to null while unregistered registers the view empty", () => {
        const h = harness();
        h.service.setViewBody("sb.late", new FillerElement());
        h.service.setViewBody("sb.late", null);
        h.service.registerView(testView("sb.late", "sb", 2, { body: null, placeholder: "none" }));
        expect(h.paneView("sb").querySelector("#viewPlaceholder-sb-late")).not.toBeNull();
    });

    it("a section of a container that isn't built yet takes the title when it is", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "sb", title: "SB", location: "sidebar", order: 0, isDefault: true });
        h.service.registerView(testView("sb.a", "sb", 0));
        h.service.registerView(testView("sb.b", "sb", 1));
        h.service.setViewTitle("sb.b", "LATER", null);
        h.service.attachRegisteredContainers();
        expect(paneTitles(h.paneView("sb"))).toEqual(["SB.A", "LATER"]);
    });
});

// Upstream `ViewPaneContainer.openView` expands the section it opens (TreeView.reveal goes through it).
describe("ViewsService.openView — a collapsed section", () => {
    it("is expanded, persisted and reported like a user expand", () => {
        const h = harness();
        h.paneView("sb").toggleCollapsed("sb.b");
        const events: string[] = [];
        h.service.onDidChangeViewExpanded(({ viewId, expanded }) => events.push(`${viewId}:${expanded}`));
        h.service.openView("sb.b");
        expect(h.paneView("sb").isCollapsed("sb.b")).toBe(false);
        expect(h.service.isViewExpanded("sb.b")).toBe(true);
        expect(events).toEqual(["sb.b:true"]);
        h.service.openView("sb.b");
        expect(events).toEqual(["sb.b:true"]);
    });
});
