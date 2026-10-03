import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { describe, expect, it, vi } from "vitest";

import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { LayoutService } from "../../../services/layout/browser/layoutService.ts";

import { SidebarService } from "./sidebarService.ts";

/** Заглушка LayoutService: считает вызовы подмены контента и видимости. */
function fakeLayout(): {
    layout: LayoutService;
    content: TUIElement[];
    visibleCalls: boolean[];
    setSidebarShown: (shown: boolean) => void;
} {
    const content: TUIElement[] = [];
    const visibleCalls: boolean[] = [];
    let sidebarShown = true;
    const layout = {
        setSidebarContent: (el: TUIElement | null) => content.push(el!),
        setSidebarVisible: (v: boolean) => visibleCalls.push(v),
        isSidebarVisible: () => sidebarShown,
    } as unknown as LayoutService;
    return { layout, content, visibleCalls, setSidebarShown: (shown) => (sidebarShown = shown) };
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

    it("ключ «вьюлет показан» — истинен у активного вьюлета при видимом сайдбаре", () => {
        const { layout, setSidebarShown } = fakeLayout();
        const service = new SidebarService(layout);
        service.registerViewlet("explorer", viewA, () => undefined);
        service.registerViewlet("search", viewB, () => undefined, "searchViewletVisible");
        service.registerViewlet("scm", viewA, () => undefined, "scmViewletVisible");
        const keys = new ContextKeyService();
        const set = vi.spyOn(keys, "set");
        const visibleKeys = (): unknown[] => {
            service.updateContextKeys(keys);
            return [keys.get("searchViewletVisible"), keys.get("scmViewletVisible")];
        };

        // Активного вьюлета ещё нет — все ключи опущены, но выставлены.
        expect(visibleKeys()).toEqual([false, false]);
        service.showViewlet("search");
        expect(visibleKeys()).toEqual([true, false]);
        service.showViewlet("scm");
        expect(visibleKeys()).toEqual([false, true]);
        // Сайдбар спрятан мимо сервиса (Ctrl+B) — опрос это видит.
        setSidebarShown(false);
        expect(visibleKeys()).toEqual([false, false]);
        // Вьюлет без ключа (Explorer) ключей не трогает.
        setSidebarShown(true);
        service.showViewlet("explorer");
        expect(visibleKeys()).toEqual([false, false]);
        expect(set.mock.calls.map(([key]) => key)).not.toContain(undefined);
    });
});
