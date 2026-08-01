import { describe, expect, it, vi } from "vitest";

import type { ServiceAccessor } from "../../../platform/instantiation/common/diContainer.ts";
import { SEARCH_VIEWLET_ID } from "../../contrib/search/browser/searchComponent.ts";
import { SearchComponentDIToken } from "../../contrib/search/browser/searchComponent.ts";
import { SidebarServiceDIToken } from "../parts/sidebar/sidebarService.ts";

import { searchViewAsListAction, searchViewAsTreeAction, showSearchAction } from "./searchActions.ts";

describe("showSearchAction", () => {
    it("is bound to the Search view id, the View menu, and Ctrl+Shift+F", () => {
        expect(showSearchAction.id).toBe("workbench.view.search");
        expect(showSearchAction.keybinding).toBeDefined();
        expect(showSearchAction.menus?.[0]).toMatchObject({ group: "3_views" });
    });

    it("reveals the Search viewlet in the sidebar", () => {
        const sidebar = { showViewlet: vi.fn() };
        const accessor = {
            get(token: unknown) {
                if (token === SidebarServiceDIToken) return sidebar;
                throw new Error("unexpected token");
            },
        } as unknown as ServiceAccessor;

        showSearchAction.run(accessor);

        expect(sidebar.showViewlet).toHaveBeenCalledWith(SEARCH_VIEWLET_ID);
    });
});

describe("search view-mode actions", () => {
    function accessorWithComponent(component: { setViewMode: unknown }): ServiceAccessor {
        return {
            get(token: unknown) {
                if (token === SearchComponentDIToken) return component;
                throw new Error("unexpected token");
            },
        } as unknown as ServiceAccessor;
    }

    it("are available only while the Search viewlet is visible", () => {
        expect(searchViewAsTreeAction.when).toBe("searchViewletVisible");
        expect(searchViewAsListAction.when).toBe("searchViewletVisible");
    });

    it("switch the results view mode on SearchComponent", () => {
        const component = { setViewMode: vi.fn() };
        searchViewAsTreeAction.run(accessorWithComponent(component));
        expect(component.setViewMode).toHaveBeenCalledWith("tree");

        searchViewAsListAction.run(accessorWithComponent(component));
        expect(component.setViewMode).toHaveBeenCalledWith("flat");
    });
});
