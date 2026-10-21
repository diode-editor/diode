import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { describe, expect, it } from "vitest";

import type { LayoutService } from "../../../services/layout/browser/layoutService.ts";

import { SidebarService } from "./sidebarService.ts";

function setup(): { service: SidebarService; layout: { visible: boolean } } {
    const layout = { visible: true };
    const fake = {
        setSidebarContent: () => undefined,
        setSidebarVisible: (visible: boolean) => {
            layout.visible = visible;
        },
        isSidebarVisible: () => layout.visible,
    } as unknown as LayoutService;
    const service = new SidebarService(fake);
    service.registerViewlet("a", { id: "a" } as unknown as TUIElement, () => undefined);
    service.registerViewlet("b", { id: "b" } as unknown as TUIElement, () => undefined);
    service.showViewlet("a", false);
    return { service, layout };
}

describe("SidebarService — viewlet on screen", () => {
    it("isViewletVisible: active and the sidebar is visible", () => {
        const { service, layout } = setup();
        expect(service.isViewletVisible("a")).toBe(true);
        expect(service.isViewletVisible("b")).toBe(false);
        layout.visible = false;
        expect(service.isViewletVisible("a")).toBe(false);
    });

    it("hideViewlet hides the sidebar only for the active viewlet", () => {
        const { service, layout } = setup();
        service.hideViewlet("b");
        expect(layout.visible).toBe(true);
        service.hideViewlet("a");
        expect(layout.visible).toBe(false);
    });

    it("hideViewlet does not show a hidden sidebar", () => {
        const { service, layout } = setup();
        layout.visible = false;
        service.hideViewlet("a");
        expect(layout.visible).toBe(false);
    });
});
