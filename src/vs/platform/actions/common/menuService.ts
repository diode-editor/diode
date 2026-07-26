import { Disposable, type IDisposable } from "../../../../../tuidom/common/disposable.ts";
import type { MenuEntry } from "../../../../../tuidom/ui/menu/popupMenuElement.ts";
import { token } from "../../instantiation/common/diContainer.ts";

import type { MenuId } from "./menuId.ts";
import type { ISubmenuEntry, MenuRegistry, SubmenuResolver } from "./menuRegistry.ts";
import { MenuRegistryDIToken } from "./menuRegistry.ts";

export const MenuServiceDIToken = token<MenuService>("MenuService");

/**
 * Живое меню одной точки `MenuId` (аналог `IMenu` VS Code): резолвит пункты на
 * момент вызова и уведомляет о смене состава реестра (`onDidChange`) — консюмер
 * пересобирает разметку когда захочет. `when`-контекст учитывается при каждом
 * `getEntries`; событий смены контекст-ключей у нас нет (осознанное подмножество
 * vscode — все наши меню пересобираются при открытии).
 */
export interface IMenu extends IDisposable {
    /**
     * Пункты меню на текущий момент (см. `MenuRegistry.getMenuItems`).
     * С `resolveSubmenu` submenu-записи встраиваются вложенными попапами.
     */
    getEntries(context?: unknown, resolveSubmenu?: SubmenuResolver): MenuEntry[];
    /** Submenu-записи меню (см. `MenuRegistry.getSubmenus`). */
    getSubmenus(): ISubmenuEntry[];
    /** Подписка на смену состава этой точки (append/снятие пункта в реестре). */
    onDidChange(listener: () => void): IDisposable;
}

/**
 * Фабрика живых меню (аналог `IMenuService` VS Code): отделяет данные
 * (`MenuRegistry`) от потребления — консюмеры (меню-бар, контекст-меню)
 * держат `IMenu` и не ходят в реестр напрямую.
 */
export class MenuService {
    public static dependencies = [MenuRegistryDIToken] as const;

    public constructor(private readonly registry: MenuRegistry) {}

    public createMenu(menuId: MenuId): IMenu {
        return new Menu(this.registry, menuId);
    }
}

class Menu extends Disposable implements IMenu {
    private readonly listeners = new Set<() => void>();

    public constructor(
        private readonly registry: MenuRegistry,
        private readonly menuId: MenuId,
    ) {
        super();
        this.register(
            this.registry.onDidChangeMenu((changed) => {
                if (changed !== this.menuId) return;
                for (const listener of [...this.listeners]) {
                    listener();
                }
            }),
        );
    }

    public getEntries(context?: unknown, resolveSubmenu?: SubmenuResolver): MenuEntry[] {
        return this.registry.getMenuItems(this.menuId, context, resolveSubmenu);
    }

    public getSubmenus(): ISubmenuEntry[] {
        return this.registry.getSubmenus(this.menuId);
    }

    public onDidChange(listener: () => void): IDisposable {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }
}
