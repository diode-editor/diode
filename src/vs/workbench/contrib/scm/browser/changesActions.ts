import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { SidebarServiceDIToken } from "../../../browser/parts/sidebar/sidebarService.ts";

import { SCM_VIEWLET_ID } from "./changesComponent.ts";

/**
 * Показать Source Control в сайдбаре (VS Code `workbench.view.scm`). У нас нет
 * activity bar, поэтому Explorer ↔ Source Control переключают команды: эта
 * подменяет контент сайдбара на список изменений (`SidebarService`) и отдаёт ему
 * фокус. Кейбинд — `ctrl+shift+g`, как у SCM-вьюлета в VS Code.
 */
export const showScmAction: CommandAction = {
    id: "workbench.view.scm",
    title: "View: Show Source Control",
    shortTitle: "Source Control",
    menus: [{ menuId: MenuId.MenubarViewMenu, group: "3_views", order: 15 }],
    keybinding: parseKeybinding("ctrl+shift+g"),
    run(accessor) {
        accessor.get(SidebarServiceDIToken).showViewlet(SCM_VIEWLET_ID);
    },
};
