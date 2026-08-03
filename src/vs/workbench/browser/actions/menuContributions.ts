import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import type {
    IMenuContribution,
    ISubmenuContribution,
    MenuContribution,
} from "../../../platform/actions/common/iMenuContribution.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import { GIT_MENU_SUBMENUS } from "../../contrib/scm/browser/gitMenus.ts";

import { builtinActions } from "./builtinActions.ts";

/**
 * Деривация menu-contributions из co-located размещений экшена
 * (`CommandAction.menus`, аналог `registerAction2` VS Code): каждое размещение
 * становится `IMenuContribution` с `command = id` экшена и label по цепочке
 * «title размещения → shortTitle → title» (label фиксируется здесь, чтобы меню
 * не зависело от наполнения `CommandRegistry`).
 */
export function menuItemsOfAction(action: CommandAction): IMenuContribution[] {
    return (action.menus ?? []).map((placement) => ({
        ...placement,
        command: action.id,
        title: placement.title ?? action.shortTitle ?? action.title,
    }));
}

/**
 * Структура меню-бара: submenu-записи корневой точки `MenubarMainMenu`
 * (аналог `ISubmenuItem` VS Code). Пункты самих меню (File/Edit/…) приходят из
 * co-located размещений экшенов (`CommandAction.menus`).
 */
const MENUBAR_SUBMENUS: readonly ISubmenuContribution[] = [
    { menuId: MenuId.MenubarMainMenu, submenu: MenuId.MenubarFileMenu, title: "File", mnemonic: "f", order: 10 },
    { menuId: MenuId.MenubarMainMenu, submenu: MenuId.MenubarEditMenu, title: "Edit", mnemonic: "e", order: 20 },
    {
        menuId: MenuId.MenubarMainMenu,
        submenu: MenuId.MenubarSelectionMenu,
        title: "Selection",
        mnemonic: "s",
        order: 30,
    },
    { menuId: MenuId.MenubarMainMenu, submenu: MenuId.MenubarViewMenu, title: "View", mnemonic: "v", order: 40 },
    { menuId: MenuId.MenubarMainMenu, submenu: MenuId.MenubarGoMenu, title: "Go", mnemonic: "g", order: 50 },
    { menuId: MenuId.MenubarMainMenu, submenu: MenuId.MenubarHelpMenu, title: "Help", mnemonic: "h", order: 60 },
];

/**
 * Явный полный список menu-contributions (зеркало `builtinActions`/
 * `WORKBENCH_CONTRIBUTIONS`): структура меню-бара + деривация из размещений
 * встроенных экшенов. Пункты резолвит {@link MenuRegistry.getMenuItems}:
 * порядок — group/order с авто-разделителями, шорткат — из `KeybindingRegistry`.
 */
export const MENU_CONTRIBUTIONS: readonly MenuContribution[] = [
    ...MENUBAR_SUBMENUS,
    ...GIT_MENU_SUBMENUS,
    ...builtinActions.flatMap(menuItemsOfAction),
];
