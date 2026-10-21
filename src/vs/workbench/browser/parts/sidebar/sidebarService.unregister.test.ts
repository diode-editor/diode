import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { describe, expect, it } from "vitest";

import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { LayoutService } from "../../../services/layout/browser/layoutService.ts";

import { SidebarService } from "./sidebarService.ts";

function setup(): { service: SidebarService; content: (TUIElement | null)[] } {
    const content: (TUIElement | null)[] = [];
    const layout = {
        setSidebarContent: (element: TUIElement | null) => content.push(element),
        setSidebarVisible: () => undefined,
        isSidebarVisible: () => true,
    } as unknown as LayoutService;
    return { service: new SidebarService(layout), content };
}

const viewA = { id: "a" } as unknown as TUIElement;
const viewB = { id: "b" } as unknown as TUIElement;

describe("SidebarService.unregisterViewlet", () => {
    it("an unregistered active viewlet frees the sidebar", () => {
        const { service, content } = setup();
        service.registerViewlet("a", viewA, () => undefined);
        service.showViewlet("a", false);
        service.unregisterViewlet("a");
        expect(service.getActiveViewletId()).toBeNull();
        expect(content.at(-1)).toBeNull();
        service.showViewlet("a", false);
        expect(service.getActiveViewletId()).toBeNull();
    });

    it("unregistering an inactive viewlet leaves the active one alone", () => {
        const { service, content } = setup();
        service.registerViewlet("a", viewA, () => undefined);
        service.registerViewlet("b", viewB, () => undefined);
        service.showViewlet("a", false);
        service.unregisterViewlet("b");
        expect(service.getActiveViewletId()).toBe("a");
        expect(content).toEqual([viewA]);
    });

    it("an unregistered viewlet no longer sets its visibility key", () => {
        const { service } = setup();
        const keys = new ContextKeyService();
        service.registerViewlet("a", viewA, () => undefined, "searchViewletVisible");
        service.showViewlet("a", false);
        service.unregisterViewlet("a");
        keys.set("searchViewletVisible", true);
        service.updateContextKeys(keys);
        expect(keys.get("searchViewletVisible")).toBe(true);
    });

    it("unknown id is a no-op", () => {
        const { service, content } = setup();
        service.unregisterViewlet("ghost");
        expect(content).toEqual([]);
    });
});
