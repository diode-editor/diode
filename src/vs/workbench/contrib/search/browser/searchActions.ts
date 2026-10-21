import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { viewMenuVisible } from "../../../browser/actions/menuContexts.ts";
import { SidebarServiceDIToken } from "../../../browser/parts/sidebar/sidebarService.ts";

import { SEARCH_VIEW_ID, SEARCH_VIEWLET_ID, SearchComponentDIToken } from "./searchComponent.ts";

/** nf-cod-collapse_all */
const COLLAPSE_ALL_ICON = "\ueac5";
/** nf-cod-expand_all */
const EXPAND_ALL_ICON = "\ueb95";

export const showSearchAction: CommandAction = {
    id: "workbench.view.search",
    title: "View: Show Search",
    shortTitle: "Search",
    menus: [{ menuId: MenuId.MenubarViewMenu, group: "3_views", order: 12 }],
    // Аккорд безусловен: на legacy-терминале Ctrl+Shift+F неотличим от Ctrl+F, а kitty перехватывает
    // Ctrl+Shift+*. Канонический бинд — только там, где терминал способен его передать.
    keybinding: parseChord("ctrl+k f"),
    keybindings: [{ keys: parseKeybinding("mod+shift+f"), when: "tier != 'legacy'" }],
    run(accessor) {
        accessor.get(SidebarServiceDIToken).showViewlet(SEARCH_VIEWLET_ID);
    },
};

/** Пара команд вместо тоггла — как у VS Code; галочка активного режима в «⋯» — через `toggled`. */
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

/** Collapse/Expand делят слот (group/order) и сменяются по viewHasSomeCollapsibleResult — в заголовке одна кнопка, как в VS Code. */
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

/** Плоские стрелки свободны: инпуты однострочные, а searchInputBoxFocus не задевает ни редактор, ни Find-виджет. */
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

export const toggleSearchDetailsAction: CommandAction = {
    id: "workbench.action.search.toggleQueryDetails",
    title: "Search: Toggle Search Details",
    when: "searchViewletFocus",
    // Как у Search/SCM выше: безусловный аккорд + канонический под tier-гейтом.
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
];
