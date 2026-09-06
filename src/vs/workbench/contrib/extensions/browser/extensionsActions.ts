import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { ProgressServiceDIToken } from "../../../../platform/progress/common/progressService.ts";
import { viewMenuVisible } from "../../../browser/actions/menuContexts.ts";
import { SidebarServiceDIToken } from "../../../browser/parts/sidebar/sidebarService.ts";

import {
    EXTENSIONS_VIEW_ID,
    EXTENSIONS_VIEWLET_ID,
    ExtensionsComponentDIToken,
} from "./extensionsComponent.ts";

/** nf-cod-refresh — inline-кнопка заголовка Extensions. */
const REFRESH_ICON = "\ueb37";

/**
 * Показать вьюлет Extensions (Ctrl+Shift+X, как в VS Code) — сделать активным,
 * раскрыть сайдбар и сфокусировать строку поиска. Activity bar у нас нет,
 * поэтому переключение вьюлетов — команды `workbench.view.*`. Порядок в меню
 * View — после Source Control, как в VS Code.
 *
 * Рядом с каноничным биндом — leader-аккорд: на legacy-терминале Ctrl+Shift+X
 * неотличим от Ctrl+X, а «полный» терминал может забрать Ctrl+Shift+* себе
 * (та же причина, что у Search).
 */
export const showExtensionsAction: CommandAction = {
    id: "workbench.view.extensions",
    title: "View: Show Extensions",
    shortTitle: "Extensions",
    menus: [{ menuId: MenuId.MenubarViewMenu, group: "3_views", order: 16 }],
    keybinding: parseChord("ctrl+k x"),
    keybindings: [{ keys: parseKeybinding("ctrl+shift+x"), when: "tier != 'legacy'" }],
    run(accessor) {
        accessor.get(SidebarServiceDIToken).showViewlet(EXTENSIONS_VIEWLET_ID);
    },
};

/**
 * Перечитать каталог магазина: кнопка в заголовке секции и команда палитры.
 * Индекс кэширован на сессию, поэтому обновление — явное действие
 * пользователя, а не фоновый опрос реестра.
 */
export const refreshExtensionsAction: CommandAction = {
    id: "extensions.refresh",
    title: "Extensions: Refresh",
    shortTitle: "Refresh",
    when: "extensionsViewletVisible",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 10,
            icon: REFRESH_ICON,
            visible: viewMenuVisible(EXTENSIONS_VIEW_ID),
        },
    ],
    async run(accessor) {
        const component = accessor.get(ExtensionsComponentDIToken);
        await accessor.get(ProgressServiceDIToken).withProgress(
            { location: "view", viewId: EXTENSIONS_VIEW_ID, title: "Refreshing extensions" },
            () => component.refresh(),
        );
    },
};
