import { describe, expect, it, vi } from "vitest";

import type { TUIElement } from "../../../../../../tuidom/dom/tuiElement.ts";
import type { LayoutService } from "../../../services/layout/browser/layoutService.ts";

import { SidebarService } from "./sidebarService.ts";

/** Заглушка LayoutService: считает вызовы подмены контента и видимости. */
function fakeLayout(): {
    layout: LayoutService;
    content: TUIElement[];
    visibleCalls: boolean[];
} {
    const content: TUIElement[] = [];
    const visibleCalls: boolean[] = [];
    const layout = {
        setSidebarContent: (el: TUIElement | null) => content.push(el!),
        setSidebarVisible: (v: boolean) => visibleCalls.push(v),
    } as unknown as LayoutService;
    return { layout, content, visibleCalls };
}

const viewA = { id: "a" } as unknown as TUIElement;
const viewB = { id: "b" } as unknown as TUIElement;

describe("SidebarService", () => {
    it("showViewlet подменяет контент, раскрывает сайдбар и фокусирует вьюлет", () => {
        const { layout, content, visibleCalls } = fakeLayout();
        const service = new SidebarService(layout);
        const focus = vi.fn();
        service.registerViewlet("explorer", viewA, focus);

        service.showViewlet("explorer");

        expect(content).toEqual([viewA]);
        expect(visibleCalls).toEqual([true]);
        expect(focus).toHaveBeenCalledTimes(1);
        expect(service.getActiveViewletId()).toBe("explorer");
    });

    it("reveal=false ставит контент, но не трогает видимость и фокус (стартовая установка)", () => {
        const { layout, content, visibleCalls } = fakeLayout();
        const service = new SidebarService(layout);
        const focus = vi.fn();
        service.registerViewlet("explorer", viewA, focus);

        service.showViewlet("explorer", false);

        expect(content).toEqual([viewA]);
        expect(visibleCalls).toEqual([]);
        expect(focus).not.toHaveBeenCalled();
        expect(service.getActiveViewletId()).toBe("explorer");
    });

    it("переключает активный вьюлет", () => {
        const { layout, content } = fakeLayout();
        const service = new SidebarService(layout);
        service.registerViewlet("explorer", viewA, () => undefined);
        service.registerViewlet("scm", viewB, () => undefined);

        service.showViewlet("explorer");
        service.showViewlet("scm");

        expect(content).toEqual([viewA, viewB]);
        expect(service.getActiveViewletId()).toBe("scm");
    });

    it("неизвестный id — no-op", () => {
        const { layout, content } = fakeLayout();
        const service = new SidebarService(layout);

        service.showViewlet("nope");

        expect(content).toEqual([]);
        expect(service.getActiveViewletId()).toBeNull();
    });
});
