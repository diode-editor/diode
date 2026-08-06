import { describe, expect, it, vi } from "vitest";

import type { ServiceAccessor } from "../../../platform/instantiation/common/diContainer.ts";
import { SEARCH_VIEWLET_ID } from "../../contrib/search/browser/searchComponent.ts";
import { SearchComponentDIToken } from "../../contrib/search/browser/searchComponent.ts";
import { SidebarServiceDIToken } from "../parts/sidebar/sidebarService.ts";

import {
    collapseSearchResultsAction,
    expandSearchResultsAction,
    focusNextInputBoxAction,
    focusPreviousInputBoxAction,
    focusSearchFromResultsAction,
    searchViewAsListAction,
    searchViewAsTreeAction,
    showSearchAction,
    toggleSearchDetailsAction,
} from "./searchActions.ts";

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
        expect(component.setViewMode).toHaveBeenCalledWith("list");
    });
});

describe("collapse/expand, кольцо фокуса и детали — делегируют в SearchComponent", () => {
    function accessorWith(component: object): ServiceAccessor {
        return {
            get(token: unknown) {
                if (token === SearchComponentDIToken) return component;
                throw new Error("unexpected token");
            },
        } as unknown as ServiceAccessor;
    }

    it("collapseSearchResults → collapseDeepestLevel, expandSearchResults → expandAll", () => {
        const component = { collapseDeepestLevel: vi.fn(), expandAll: vi.fn() };
        collapseSearchResultsAction.run(accessorWith(component));
        expect(component.collapseDeepestLevel).toHaveBeenCalledOnce();
        expandSearchResultsAction.run(accessorWith(component));
        expect(component.expandAll).toHaveBeenCalledOnce();
    });

    it("пара Collapse/Expand в «⋯»-меню сменяется по viewHasSomeCollapsibleResult", () => {
        expect(collapseSearchResultsAction.menus?.[0].when).toBe("!hasSearchResult || viewHasSomeCollapsibleResult");
        expect(expandSearchResultsAction.menus?.[0].when).toBe("hasSearchResult && !viewHasSomeCollapsibleResult");
    });

    it("кольцо фокуса: next/previous из инпутов, возврат с первой строки результатов", () => {
        const component = {
            focusNextInputBox: vi.fn(),
            focusPreviousInputBox: vi.fn(),
            focusSearchFromResults: vi.fn(),
        };
        focusNextInputBoxAction.run(accessorWith(component));
        expect(component.focusNextInputBox).toHaveBeenCalledOnce();
        focusPreviousInputBoxAction.run(accessorWith(component));
        expect(component.focusPreviousInputBox).toHaveBeenCalledOnce();
        focusSearchFromResultsAction.run(accessorWith(component));
        expect(component.focusSearchFromResults).toHaveBeenCalledOnce();

        expect(focusNextInputBoxAction.when).toBe("searchViewletVisible && searchInputBoxFocus");
        expect(focusSearchFromResultsAction.when).toBe("searchViewletVisible && firstMatchFocus");
    });

    it("toggleQueryDetails зовёт тумблер деталей (Ctrl+Shift+J, when searchViewletFocus)", () => {
        const component = { toggleQueryDetails: vi.fn() };
        toggleSearchDetailsAction.run(accessorWith(component));
        expect(component.toggleQueryDetails).toHaveBeenCalledOnce();
        expect(toggleSearchDetailsAction.when).toBe("searchViewletFocus");
    });
});
