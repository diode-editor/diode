import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { describe, expect, it, vi } from "vitest";

import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { LayoutService } from "../../../services/layout/browser/layoutService.ts";

import { SidebarService } from "./sidebarService.ts";

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
    it("showViewlet swaps the content, reveals the sidebar and focuses the viewlet", () => {
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

    it("reveal=false sets the content but leaves visibility and focus alone (startup setup)", () => {
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

    it("focus=false reveals the sidebar but leaves the keyboard where it is", () => {
        const { layout, content, visibleCalls } = fakeLayout();
        const service = new SidebarService(layout);
        const focus = vi.fn();
        service.registerViewlet("explorer", viewA, focus);

        service.showViewlet("explorer", true, false);

        expect(content).toEqual([viewA]);
        expect(visibleCalls).toEqual([true]);
        expect(focus).not.toHaveBeenCalled();
    });

    it("switches the active viewlet", () => {
        const { layout, content } = fakeLayout();
        const service = new SidebarService(layout);
        service.registerViewlet("explorer", viewA, () => undefined);
        service.registerViewlet("scm", viewB, () => undefined);

        service.showViewlet("explorer");
        service.showViewlet("scm");

        expect(content).toEqual([viewA, viewB]);
        expect(service.getActiveViewletId()).toBe("scm");
    });

    it("unknown id is a no-op", () => {
        const { layout, content } = fakeLayout();
        const service = new SidebarService(layout);

        service.showViewlet("nope");

        expect(content).toEqual([]);
        expect(service.getActiveViewletId()).toBeNull();
    });

    it("the 'viewlet visible' key is true for the active viewlet while the sidebar is visible", () => {
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

        // No active viewlet: the keys are false but still set.
        expect(visibleKeys()).toEqual([false, false]);
        service.showViewlet("search");
        expect(visibleKeys()).toEqual([true, false]);
        service.showViewlet("scm");
        expect(visibleKeys()).toEqual([false, true]);
        // Sidebar hidden bypassing the service (Ctrl+B): polling sees it.
        setSidebarShown(false);
        expect(visibleKeys()).toEqual([false, false]);
        // A viewlet without a key (Explorer) leaves the keys alone.
        setSidebarShown(true);
        service.showViewlet("explorer");
        expect(visibleKeys()).toEqual([false, false]);
        expect(set.mock.calls.map(([key]) => key)).not.toContain(undefined);
    });

    it("onDidChangeActiveViewlet fires only on an active viewlet change, including the startup setup", () => {
        const { layout } = fakeLayout();
        const service = new SidebarService(layout);
        service.registerViewlet("explorer", viewA, vi.fn());
        service.registerViewlet("scm", viewB, vi.fn());
        const fired: string[] = [];
        service.onDidChangeActiveViewlet((id) => fired.push(id));

        service.showViewlet("explorer", false);
        service.showViewlet("explorer");
        service.showViewlet("ghost");
        service.showViewlet("scm");

        expect(fired).toEqual(["explorer", "scm"]);
    });
});
