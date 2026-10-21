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

describe("SidebarService — вьюлет на экране", () => {
    it("isViewletVisible: активен и сайдбар виден", () => {
        const { service, layout } = setup();
        expect(service.isViewletVisible("a")).toBe(true);
        expect(service.isViewletVisible("b")).toBe(false);
        layout.visible = false;
        expect(service.isViewletVisible("a")).toBe(false);
    });

    it("hideViewlet прячет сайдбар только для активного вьюлета", () => {
        const { service, layout } = setup();
        service.hideViewlet("b");
        expect(layout.visible).toBe(true);
        service.hideViewlet("a");
        expect(layout.visible).toBe(false);
    });

    it("hideViewlet скрытого сайдбара не показывает", () => {
        const { service, layout } = setup();
        layout.visible = false;
        service.hideViewlet("a");
        expect(layout.visible).toBe(false);
    });
});
