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
            toggled: "searchViewMode == 'flat'",
        },
    ],
    run(accessor) {
        accessor.get(SearchComponentDIToken).setViewMode("flat");
    },
};
