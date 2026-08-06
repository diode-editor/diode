import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import { parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import {
    SEARCH_VIEW_ID,
    SEARCH_VIEWLET_ID,
    SearchComponentDIToken,
} from "../../contrib/search/browser/searchComponent.ts";
import { SidebarServiceDIToken } from "../parts/sidebar/sidebarService.ts";
import { viewMenuVisible } from "./menuContexts.ts";

/**
 * Показать вьюлет Search в сайдбаре (Ctrl+Shift+F) — сделать его активным, раскрыть
 * сайдбар и сфокусировать строку запроса. Как и Explorer/SCM, переключение идёт
 * через команду (`workbench.view.search`), activity bar у нас нет. Между Explorer
 * (order 10) и Source Control (15), как в VS Code.
 */
export const showSearchAction: CommandAction = {
    id: "workbench.view.search",
    title: "View: Show Search",
    shortTitle: "Search",
    menus: [{ menuId: MenuId.MenubarViewMenu, group: "3_views", order: 12 }],
    keybinding: parseKeybinding("ctrl+shift+f"),
    run(accessor) {
        accessor.get(SidebarServiceDIToken).showViewlet(SEARCH_VIEWLET_ID);
    },
};

/**
 * Режим отображения результатов: дерево (сворачиваемые файл-группы) или плоский
 * список. Пара команд вместо тоггла — как у VS Code (`search.action.viewAsTree`/
 * `viewAsList`); выбор персистится по-проектно. Живут и в меню «⋯» заголовка
 * Search (`MenuId.ViewMoreActions`) с галочкой активного режима (`toggled`).
 */
export const searchViewAsTreeAction: CommandAction = {
    id: "search.action.viewAsTree",
    title: "Search: View as Tree",
    shortTitle: "View as Tree",
    when: "searchViewletVisible",
    menus: [
        {
            menuId: MenuId.ViewMoreActions,
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

/**
 * Collapse All / Expand All результатов — пара в «⋯»-меню, один слот
 * (group/order): сменяются по viewHasSomeCollapsibleResult, как в VS Code.
 * Collapse — поэтапный CollapseDeepestExpandedLevel (сначала матчи под
 * файлами, потом всё дерево).
 */
export const collapseSearchResultsAction: CommandAction = {
    id: "search.action.collapseSearchResults",
    title: "Search: Collapse All",
    shortTitle: "Collapse All",
    when: "searchViewletVisible",
    menus: [
        {
            menuId: MenuId.ViewMoreActions,
            group: "2_collapse",
            order: 10,
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
            menuId: MenuId.ViewMoreActions,
            group: "2_collapse",
            order: 10,
            visible: viewMenuVisible(SEARCH_VIEW_ID),
            when: "hasSearchResult && !viewHasSomeCollapsibleResult",
        },
    ],
    run(accessor) {
        accessor.get(SearchComponentDIToken).expandAll();
    },
};

/**
 * Кольцо фокуса панели поиска: Down/Up (и Ctrl+Down/Ctrl+Up, как в VS Code)
 * ходят query → include → exclude → список и обратно; скрытые за «···» инпуты
 * пропускаются. Плоские стрелки свободны: инпуты однострочные, а
 * searchInputBoxFocus не задевает ни редактор (textInputFocus), ни Find-виджет.
 */
export const focusNextInputBoxAction: CommandAction = {
    id: "search.focus.nextInputBox",
    title: "Search: Focus Next Input Box",
    when: "searchViewletVisible && searchInputBoxFocus",
    keybinding: parseKeybinding("down"),
    keybindings: [parseKeybinding("ctrl+down")],
    run(accessor) {
        accessor.get(SearchComponentDIToken).focusNextInputBox();
    },
};

export const focusPreviousInputBoxAction: CommandAction = {
    id: "search.focus.previousInputBox",
    title: "Search: Focus Previous Input Box",
    when: "searchViewletVisible && searchInputBoxFocus",
    keybinding: parseKeybinding("up"),
    keybindings: [parseKeybinding("ctrl+up")],
    run(accessor) {
        accessor.get(SearchComponentDIToken).focusPreviousInputBox();
    },
};

/** Up с первой строки результатов — назад в инпуты (VS Code: focusSearchFromResults). */
export const focusSearchFromResultsAction: CommandAction = {
    id: "search.action.focusSearchFromResults",
    title: "Search: Focus Search From Results",
    when: "searchViewletVisible && firstMatchFocus",
    keybinding: parseKeybinding("up"),
    keybindings: [parseKeybinding("ctrl+up")],
    run(accessor) {
        accessor.get(SearchComponentDIToken).focusSearchFromResults();
    },
};

/**
 * Тумблер блока «files to include/exclude» под строкой запроса (VS Code:
 * Toggle Search Details, та же Ctrl+Shift+J). Кнопка «···» в панели — та же
 * команда мышью.
 */
export const toggleSearchDetailsAction: CommandAction = {
    id: "workbench.action.search.toggleQueryDetails",
    title: "Search: Toggle Search Details",
    when: "searchViewletFocus",
    keybinding: parseKeybinding("ctrl+shift+j"),
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
            menuId: MenuId.ViewMoreActions,
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
