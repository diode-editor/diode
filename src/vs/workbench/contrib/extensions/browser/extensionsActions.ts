import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { ProgressServiceDIToken } from "../../../../platform/progress/common/progressService.ts";
import { viewMenuVisible } from "../../../browser/actions/menuContexts.ts";
import { SidebarServiceDIToken } from "../../../browser/parts/sidebar/sidebarService.ts";

import { EXTENSIONS_VIEW_ID, EXTENSIONS_VIEWLET_ID, ExtensionsComponentDIToken } from "./extensionsComponent.ts";

/** nf-cod-refresh */
const REFRESH_ICON = "\ueb37";

/** Leader-аккорд рядом с каноничным биндом: на legacy-терминале Ctrl+Shift+X неотличим от Ctrl+X (как у Search). */
export const showExtensionsAction: CommandAction = {
    id: "workbench.view.extensions",
    title: "View: Show Extensions",
    shortTitle: "Extensions",
    menus: [{ menuId: MenuId.MenubarViewMenu, group: "3_views", order: 16 }],
    keybinding: parseChord("ctrl+k x"),
    keybindings: [{ keys: parseKeybinding("mod+shift+x"), when: "tier != 'legacy'" }],
    run(accessor) {
        accessor.get(SidebarServiceDIToken).showViewlet(EXTENSIONS_VIEWLET_ID);
    },
};

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
        await accessor
            .get(ProgressServiceDIToken)
            .withProgress({ location: "view", viewId: EXTENSIONS_VIEW_ID, title: "Refreshing extensions" }, () =>
                component.refresh(),
            );
    },
};

export const EXTENSIONS_ACTIONS: readonly CommandAction[] = [showExtensionsAction, refreshExtensionsAction];
