import type { MenuBarItem } from "@tuidom/all/ui/menu/menuBarElement";
import { MenuBarElement } from "@tuidom/all/ui/menu/menuBarElement";
import { MenuId } from "../../platform/actions/common/menuId.ts";
import type { IMenu, MenuService } from "../../platform/actions/common/menuService.ts";
import { MenuServiceDIToken } from "../../platform/actions/common/menuService.ts";
import { token } from "../../platform/instantiation/common/diContainer.ts";

import { Component } from "./component.ts";

export const MenuBarComponentDIToken = token<MenuBarComponent>("MenuBarComponent");

/**
 * Компонент главного меню: владеет {@link MenuBarElement} и строит его items из
 * `MenuRegistry` через живые меню {@link MenuService.createMenu}: top-уровень —
 * submenu-записи `MenuId.MenubarMainMenu`, пункты каждого меню резолвятся
 * ЛЕНИВО при открытии (геттер `entries`), поэтому шорткаты и динамические
 * пункты всегда актуальны — порядок резолва компонента относительно user
 * keybindings не важен.
 */
export class MenuBarComponent extends Component {
    public static dependencies = [MenuServiceDIToken] as const;

    public readonly view: MenuBarElement;

    public constructor(menuService: MenuService) {
        super();
        const mainMenu = this.register(menuService.createMenu(MenuId.MenubarMainMenu));
        this.view = new MenuBarElement(mainMenu.getSubmenus().map((sub) => this.buildItem(menuService, sub)));
        this.view.id = "menuBar";
    }

    private buildItem(
        menuService: MenuService,
        sub: { title: string; mnemonic?: string; submenu: MenuId },
    ): MenuBarItem {
        const menu: IMenu = this.register(menuService.createMenu(sub.submenu));
        return {
            label: sub.title,
            mnemonic: sub.mnemonic,
            // Ленивый резолв: MenuBarElement читает entries при открытии попапа.
            get entries() {
                return menu.getEntries();
            },
        };
    }
}
