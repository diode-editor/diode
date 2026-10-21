import { describe, expect, it } from "vitest";

import type { IViewsHarness } from "./viewsService.testUtils.ts";
import { makeViewsHarness, testView } from "./viewsService.testUtils.ts";
import type { IViewContainerDescriptor } from "./viewsService.ts";

function register(h: IViewsHarness, descriptor: Omit<IViewContainerDescriptor, "title">): void {
    h.service.registerContainer({ title: descriptor.id.toUpperCase(), ...descriptor });
    h.service.registerView(testView(`${descriptor.id}.view`, descriptor.id, 10));
}

function tabs(h: IViewsHarness): string[] {
    return h.panelService.getViews().map((v) => v.id);
}

/**
 * Container order comes from the descriptor's `order`, not from the order in which features
 * were created and registered them: reordering resolution at the workbench root must not
 * silently reorder panel tabs and sidebar viewlets.
 */
describe("ViewsService — container order and the default viewlet", () => {
    it("attachRegisteredContainers builds panel tabs by order, the first becomes active", () => {
        const h = makeViewsHarness();
        register(h, { id: "terminal", location: "panel", order: 2 });
        register(h, { id: "problems", location: "panel", order: 0 });
        register(h, { id: "output", location: "panel", order: 1 });

        h.service.attachRegisteredContainers();

        expect(tabs(h)).toEqual(["problems", "output", "terminal"]);
        expect(h.panelService.getActiveViewId()).toBe("problems");
    });

    it("sidebar viewlets register by order", () => {
        const h = makeViewsHarness();
        register(h, { id: "search", location: "sidebar", order: 1 });
        register(h, { id: "explorer", location: "sidebar", order: 0 });

        h.service.attachRegisteredContainers();

        expect(h.viewlets).toEqual(["explorer", "search"]);
    });

    it("a container without order goes after ordered ones, equal order keeps registration order", () => {
        const h = makeViewsHarness();
        register(h, { id: "late", location: "panel" });
        register(h, { id: "first", location: "panel", order: 1 });
        register(h, { id: "second", location: "panel", order: 1 });
        register(h, { id: "zero", location: "panel", order: 0 });

        h.service.attachRegisteredContainers();

        expect(tabs(h)).toEqual(["zero", "first", "second", "late"]);
    });

    it("a late attachContainer inserts the tab at its order position", () => {
        const h = makeViewsHarness();
        register(h, { id: "a", location: "panel", order: 0 });
        register(h, { id: "c", location: "panel", order: 2 });
        h.service.attachRegisteredContainers();

        register(h, { id: "b", location: "panel", order: 1 });
        h.service.attachContainer("b");
        register(h, { id: "c2", location: "panel", order: 2 });
        h.service.attachContainer("c2");

        expect(tabs(h)).toEqual(["a", "b", "c", "c2"]);
    });

    it("sidebar containers and not yet built ones do not shift the tab position", () => {
        const h = makeViewsHarness();
        register(h, { id: "explorer", location: "sidebar", order: 0 });
        register(h, { id: "pending", location: "panel", order: 0 });
        register(h, { id: "y", location: "panel", order: 5 });
        h.service.attachContainer("explorer");
        h.service.attachContainer("y");

        register(h, { id: "x", location: "panel", order: 1 });
        h.service.attachContainer("x");

        expect(tabs(h)).toEqual(["x", "y"]);
    });

    it("shows the default viewlet without reveal: sidebar visibility is untouched", () => {
        const h = makeViewsHarness();
        register(h, { id: "search", location: "sidebar", order: 1 });
        register(h, { id: "explorer", location: "sidebar", order: 0, isDefault: true });

        h.service.attachRegisteredContainers();

        expect(h.shownViewlets).toEqual([{ id: "explorer", reveal: false }]);
    });

    it("without a default container no viewlet is shown", () => {
        const h = makeViewsHarness();
        register(h, { id: "search", location: "sidebar", order: 1 });

        h.service.attachRegisteredContainers();

        expect(h.shownViewlets).toEqual([]);
    });

    it("skips containers that only had views registered into them, and already built ones", () => {
        const h = makeViewsHarness();
        h.service.registerView(testView("orphan.view", "orphan", 10));
        register(h, { id: "output", location: "panel", order: 1 });
        h.service.attachRegisteredContainers();

        h.service.attachRegisteredContainers();

        expect(tabs(h)).toEqual(["output"]);
        expect(() => h.root("orphan")).toThrow(/is not attached anywhere/);
    });
});
