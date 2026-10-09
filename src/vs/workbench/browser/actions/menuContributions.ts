import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { combineWhen } from "../../../platform/actions/common/commandAction.ts";
import type { IMenuContribution, ISubmenuContribution } from "../../../platform/actions/common/iMenuContribution.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";

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
        // Доступность наследуется от экшена; своя у размещения — сужает (AND).
        enablement: combineWhen(action.enablement, placement.enablement),
    }));
}

/**
 * Структура меню-бара: submenu-записи корневой точки `MenubarMainMenu`
 * (аналог `ISubmenuItem` VS Code). Пункты самих меню (File/Edit/…) приходят из
 * co-located размещений экшенов (`CommandAction.menus`).
 */
export const MENUBAR_SUBMENUS: readonly ISubmenuContribution[] = [
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
    {
        menuId: MenuId.MenubarMainMenu,
        submenu: MenuId.MenubarTerminalMenu,
        title: "Terminal",
        mnemonic: "t",
        order: 55,
    },
    { menuId: MenuId.MenubarMainMenu, submenu: MenuId.MenubarHelpMenu, title: "Help", mnemonic: "h", order: 60 },
];
