import { codicon } from "../../../../base/common/codicons.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";
import { viewMenuVisible } from "../../../browser/actions/menuContexts.ts";
import { SidebarServiceDIToken } from "../../../browser/parts/sidebar/sidebarService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";

import { SEARCH_VIEW_ID, SEARCH_VIEWLET_ID, SearchComponentDIToken } from "./searchComponent.ts";

const COLLAPSE_ALL_ICON = codicon("collapse-all");
const EXPAND_ALL_ICON = codicon("expand-all");

export const showSearchAction: CommandAction = {
    id: "workbench.view.search",
    title: "View: Show Search",
    shortTitle: "Search",
    menus: [{ menuId: MenuId.MenubarViewMenu, group: "3_views", order: 12 }],
    // The chord is unconditional: on a legacy terminal Ctrl+Shift+F is indistinguishable from Ctrl+F, and kitty
    // intercepts Ctrl+Shift+*. The canonical binding is only where the terminal can deliver it.
    keybinding: parseChord("ctrl+k f"),
    keybindings: [{ keys: parseKeybinding("mod+shift+f"), when: "tier != 'legacy'" }],
    run(accessor) {
        accessor.get(SidebarServiceDIToken).showViewlet(SEARCH_VIEWLET_ID);
    },
};

/** A pair of commands instead of a toggle — like VS Code; the active mode's check mark in "⋯" comes via `toggled`. */
export const searchViewAsTreeAction: CommandAction = {
    id: "search.action.viewAsTree",
    title: "Search: View as Tree",
    shortTitle: "View as Tree",
    when: "searchViewletVisible",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "1_view",
            order: 20,
            visible: viewMenuVisible(SEARCH_VIEW_ID),
            toggled: "searchViewMode == 'tree'",
        },
    ],
    run(accessor) {
        accessor.get(SearchComponentDIToken).setViewMode("tree");
    },
};

/** Collapse/Expand share a slot (group/order) and swap on viewHasSomeCollapsibleResult — one button in the title, like VS Code. */
export const collapseSearchResultsAction: CommandAction = {
    id: "search.action.collapseSearchResults",
    title: "Search: Collapse All",
    shortTitle: "Collapse All",
    when: "searchViewletVisible",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 10,
            icon: COLLAPSE_ALL_ICON,
            visible: viewMenuVisible(SEARCH_VIEW_ID),
            when: "!hasSearchResult || viewHasSomeCollapsibleResult",
        },
    ],
    run(accessor) {
        accessor.get(SearchComponentDIToken).collapseDeepestLevel();
    },
};

export const expandSearchResultsAction: CommandAction = {
    id: "search.action.expandSearchResults",
    title: "Search: Expand All",
    shortTitle: "Expand All",
    when: "searchViewletVisible",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 10,
            icon: EXPAND_ALL_ICON,
            visible: viewMenuVisible(SEARCH_VIEW_ID),
            when: "hasSearchResult && !viewHasSomeCollapsibleResult",
        },
    ],
    run(accessor) {
        accessor.get(SearchComponentDIToken).expandAll();
    },
};

/** Plain arrows are free: the inputs are single-line, and searchInputBoxFocus touches neither the editor nor the Find widget. */
export const focusNextInputBoxAction: CommandAction = {
    id: "search.focus.nextInputBox",
    title: "Search: Focus Next Input Box",
    when: "searchViewletVisible && searchInputBoxFocus",
    keybinding: parseKeybinding("down"),
    keybindings: [parseKeybinding("mod+down")],
    run(accessor) {
        accessor.get(SearchComponentDIToken).focusNextInputBox();
    },
};

export const focusPreviousInputBoxAction: CommandAction = {
    id: "search.focus.previousInputBox",
    title: "Search: Focus Previous Input Box",
    when: "searchViewletVisible && searchInputBoxFocus",
    keybinding: parseKeybinding("up"),
    keybindings: [parseKeybinding("mod+up")],
    run(accessor) {
        accessor.get(SearchComponentDIToken).focusPreviousInputBox();
    },
};

export const focusSearchFromResultsAction: CommandAction = {
    id: "search.action.focusSearchFromResults",
    title: "Search: Focus Search From Results",
    when: "searchViewletVisible && firstMatchFocus",
    keybinding: parseKeybinding("up"),
    keybindings: [parseKeybinding("mod+up")],
    run(accessor) {
        accessor.get(SearchComponentDIToken).focusSearchFromResults();
    },
};

/**
 * VS Code: F4/Shift+F4 at `WorkbenchContrib` weight, global (no focus condition). The shared key is split by weight:
 * references-view (built-in extension) outranks it while it has a result, peek references would sit below.
 * Like upstream, the view is revealed and the match opens in the editor.
 */
export const focusNextSearchResultAction: CommandAction = {
    id: "search.action.focusNextSearchResult",
    title: "Search: Focus Next Search Result",
    when: "hasSearchResult",
    keybinding: parseKeybinding("f4"),
    weight: KeybindingWeight.WorkbenchContrib,
    run(accessor) {
        accessor.get(ViewsServiceDIToken).openView(SEARCH_VIEW_ID);
        accessor.get(SearchComponentDIToken).focusNextResult();
    },
};

export const focusPreviousSearchResultAction: CommandAction = {
    id: "search.action.focusPreviousSearchResult",
    title: "Search: Focus Previous Search Result",
    when: "hasSearchResult",
    keybinding: parseKeybinding("shift+f4"),
    weight: KeybindingWeight.WorkbenchContrib,
    run(accessor) {
        accessor.get(ViewsServiceDIToken).openView(SEARCH_VIEW_ID);
        accessor.get(SearchComponentDIToken).focusPreviousResult();
    },
};

export const toggleSearchDetailsAction: CommandAction = {
    id: "workbench.action.search.toggleQueryDetails",
    title: "Search: Toggle Search Details",
    when: "searchViewletFocus",
    // Like Search/SCM above: an unconditional chord + the canonical one behind the tier gate.
    keybinding: parseChord("ctrl+k alt+j"),
    keybindings: [{ keys: parseKeybinding("mod+shift+j"), when: "tier != 'legacy'" }],
    run(accessor) {
        accessor.get(SearchComponentDIToken).toggleQueryDetails();
    },
};

export const searchViewAsListAction: CommandAction = {
    id: "search.action.viewAsList",
    title: "Search: View as List",
    shortTitle: "View as List",
    when: "searchViewletVisible",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "1_view",
            order: 10,
            visible: viewMenuVisible(SEARCH_VIEW_ID),
            toggled: "searchViewMode == 'list'",
        },
    ],
    run(accessor) {
        accessor.get(SearchComponentDIToken).setViewMode("list");
    },
};

export const SEARCH_ACTIONS: readonly CommandAction[] = [
    showSearchAction,
    searchViewAsTreeAction,
    searchViewAsListAction,
    toggleSearchDetailsAction,
    collapseSearchResultsAction,
    expandSearchResultsAction,
    focusNextInputBoxAction,
    focusPreviousInputBoxAction,
    focusSearchFromResultsAction,
    focusNextSearchResultAction,
    focusPreviousSearchResultAction,
];
