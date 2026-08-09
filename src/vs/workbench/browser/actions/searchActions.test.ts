import { describe, expect, it, vi } from "vitest";

import { registerAction } from "../../../platform/actions/common/commandAction.ts";
import { CommandRegistry } from "../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../platform/contextkey/common/contextKeyService.ts";
import { Container, type ServiceAccessor } from "../../../platform/instantiation/common/diContainer.ts";
import { formatKeybinding, KeybindingRegistry } from "../../../platform/keybinding/common/keybindingRegistry.ts";
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

    // Ctrl+Shift+F теряется дважды: на legacy-терминале он неотличим от Ctrl+F, а на
    // «полном» его перехватывает сам эмулятор. Поэтому аккорд обязан работать всегда,
    // а подсказка — показывать то, что в этом терминале действительно нажимается.
    function registerSearch(): { keybindings: KeybindingRegistry; commands: CommandRegistry } {
        const commands = new CommandRegistry();
        const keybindings = new KeybindingRegistry();
        const accessor = new Container();
        accessor.bind(SidebarServiceDIToken, () => ({ showViewlet: vi.fn() }) as never);
        registerAction(commands, keybindings, accessor, showSearchAction);
        return { keybindings, commands };
    }

    it("подсказка следует за терминалом: аккорд на legacy, Ctrl+Shift+F на kitty", () => {
        const { keybindings } = registerSearch();
        const ctx = new ContextKeyService();

        ctx.set("tier", "legacy");
        const legacy = keybindings.getKeybindingForCommand("workbench.view.search", ctx);
        expect(legacy && formatKeybinding(legacy)).toBe("Ctrl+K F");

        ctx.set("tier", "kitty");
        const modern = keybindings.getKeybindingForCommand("workbench.view.search", ctx);
        expect(modern && formatKeybinding(modern)).toBe("Ctrl+Shift+F");
    });

    it("аккорд Ctrl+K F резолвится и на терминале с расширенными клавишами", () => {
        const { keybindings } = registerSearch();
        const ctx = new ContextKeyService();
        ctx.set("tier", "kitty");

        expect(keybindings.resolveKey({ key: "k", ctrlKey: true, shiftKey: false, altKey: false, metaKey: false }, ctx).kind).toBe(
            "chord",
        );
        expect(
            keybindings.resolveKey({ key: "f", ctrlKey: false, shiftKey: false, altKey: false, metaKey: false }, ctx),
        ).toEqual({ kind: "command", commandId: "workbench.view.search" });
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
