import { describe, expect, it, vi } from "vitest";

import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { Container, type ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { formatKeybinding, KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { SidebarServiceDIToken } from "../../../browser/parts/sidebar/sidebarService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { nextReferenceAction, previousReferenceAction } from "../../references/browser/referencesActions.ts";

import {
    collapseSearchResultsAction,
    expandSearchResultsAction,
    focusNextInputBoxAction,
    focusNextSearchResultAction,
    focusPreviousInputBoxAction,
    focusPreviousSearchResultAction,
    focusSearchFromResultsAction,
    searchViewAsListAction,
    searchViewAsTreeAction,
    showSearchAction,
    toggleSearchDetailsAction,
} from "./searchActions.ts";
import { SEARCH_VIEW_ID, SEARCH_VIEWLET_ID } from "./searchComponent.ts";
import { SearchComponentDIToken } from "./searchComponent.ts";

describe("showSearchAction", () => {
    it("is bound to the Search view id, the View menu, and Ctrl+Shift+F", () => {
        expect(showSearchAction.id).toBe("workbench.view.search");
        expect(showSearchAction.keybinding).toBeDefined();
        expect(showSearchAction.menus?.[0]).toMatchObject({ group: "3_views" });
    });

    // Ctrl+Shift+F gets lost twice: on a legacy terminal it is indistinguishable from Ctrl+F, and on
    // a "full" one the emulator itself intercepts it. So the chord must always work,
    // and the hint must show what can actually be pressed in this terminal.
    function registerSearch(): { keybindings: KeybindingRegistry; commands: CommandRegistry } {
        const commands = new CommandRegistry();
        const keybindings = new KeybindingRegistry();
        const accessor = new Container();
        accessor.bind(SidebarServiceDIToken, () => ({ showViewlet: vi.fn() }) as never);
        registerAction(commands, keybindings, accessor, showSearchAction);
        return { keybindings, commands };
    }

    it("the hint follows the terminal: chord on legacy, Ctrl+Shift+F on kitty", () => {
        const { keybindings } = registerSearch();
        const ctx = new ContextKeyService();

        ctx.set("tier", "legacy");
        const legacy = keybindings.getKeybindingForCommand("workbench.view.search", ctx);
        expect(legacy && formatKeybinding(legacy)).toBe("Ctrl+K F");

        ctx.set("tier", "kitty");
        const modern = keybindings.getKeybindingForCommand("workbench.view.search", ctx);
        expect(modern && formatKeybinding(modern)).toBe("Ctrl+Shift+F");
    });

    it("the Ctrl+K F chord also resolves on a terminal with extended keys", () => {
        const { keybindings } = registerSearch();
        const ctx = new ContextKeyService();
        ctx.set("tier", "kitty");

        expect(
            keybindings.resolveKey({ key: "k", ctrlKey: true, shiftKey: false, altKey: false, metaKey: false }, ctx)
                .kind,
        ).toBe("chord");
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

describe("collapse/expand, focus ring and details delegate to SearchComponent", () => {
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

    it("the Collapse/Expand pair in the '⋯' menu switches on viewHasSomeCollapsibleResult", () => {
        expect(collapseSearchResultsAction.menus?.[0].when).toBe("!hasSearchResult || viewHasSomeCollapsibleResult");
        expect(expandSearchResultsAction.menus?.[0].when).toBe("hasSearchResult && !viewHasSomeCollapsibleResult");
    });

    it("focus ring: next/previous from inputs, return from the first result row", () => {
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

    it("toggleQueryDetails calls the details toggle (Ctrl+Shift+J, when searchViewletFocus)", () => {
        const component = { toggleQueryDetails: vi.fn() };
        toggleSearchDetailsAction.run(accessorWith(component));
        expect(component.toggleQueryDetails).toHaveBeenCalledOnce();
        expect(toggleSearchDetailsAction.when).toBe("searchViewletFocus");
    });
});

describe("F4/Shift+F4: next/previous search result", () => {
    const F4 = { key: "F4", ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
    const SHIFT_F4 = { ...F4, shiftKey: true };

    function registerAll(): KeybindingRegistry {
        const commands = new CommandRegistry();
        const keybindings = new KeybindingRegistry();
        for (const action of [
            nextReferenceAction,
            previousReferenceAction,
            focusNextSearchResultAction,
            focusPreviousSearchResultAction,
        ]) {
            registerAction(commands, keybindings, new Container(), action);
        }
        return keybindings;
    }

    function resolve(
        keybindings: KeybindingRegistry,
        event: typeof F4,
        keys: { hasSearchResult?: boolean; hasReferenceResult?: boolean },
    ): string {
        const ctx = new ContextKeyService();
        ctx.set("hasSearchResult", keys.hasSearchResult ?? false);
        ctx.set("hasReferenceResult", keys.hasReferenceResult ?? false);
        const resolution = keybindings.resolveKey(event, ctx);
        keybindings.resetPending();
        return resolution.kind === "command" ? resolution.commandId : resolution.kind;
    }

    it("command ids, titles and keys are VS Code's", () => {
        expect(focusNextSearchResultAction.id).toBe("search.action.focusNextSearchResult");
        expect(focusNextSearchResultAction.title).toBe("Search: Focus Next Search Result");
        expect(focusPreviousSearchResultAction.id).toBe("search.action.focusPreviousSearchResult");
        expect(focusPreviousSearchResultAction.title).toBe("Search: Focus Previous Search Result");
    });

    it("search results alone: F4 and Shift+F4 walk the search", () => {
        const keybindings = registerAll();
        expect(resolve(keybindings, F4, { hasSearchResult: true })).toBe("search.action.focusNextSearchResult");
        expect(resolve(keybindings, SHIFT_F4, { hasSearchResult: true })).toBe(
            "search.action.focusPreviousSearchResult",
        );
    });

    it("a references result outranks the search, as references-view (built-in extension) does upstream", () => {
        const keybindings = registerAll();
        const both = { hasSearchResult: true, hasReferenceResult: true };
        expect(resolve(keybindings, F4, both)).toBe("references-view.next");
        expect(resolve(keybindings, SHIFT_F4, both)).toBe("references-view.prev");
    });

    it("without any result F4 is not bound", () => {
        expect(resolve(registerAll(), F4, {})).toBe("none");
    });

    it("reveals the Search view, then steps the result", () => {
        const calls: string[] = [];
        const accessor = {
            get(token: unknown) {
                if (token === ViewsServiceDIToken) return { openView: (id: string) => calls.push(`open:${id}`) };
                if (token === SearchComponentDIToken) {
                    return {
                        focusNextResult: () => calls.push("next"),
                        focusPreviousResult: () => calls.push("prev"),
                    };
                }
                throw new Error("unexpected token");
            },
        } as unknown as ServiceAccessor;

        focusNextSearchResultAction.run(accessor);
        focusPreviousSearchResultAction.run(accessor);

        expect(calls).toEqual([`open:${SEARCH_VIEW_ID}`, "next", `open:${SEARCH_VIEW_ID}`, "prev"]);
    });
});
