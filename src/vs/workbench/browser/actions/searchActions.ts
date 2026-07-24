import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import { parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { SEARCH_VIEWLET_ID } from "../../contrib/search/browser/searchComponent.ts";
import { SidebarServiceDIToken } from "../parts/sidebar/sidebarService.ts";

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
