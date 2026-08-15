import { Disposable, type IDisposable } from "@tuidom/core/common/disposable";
import type { MenuEntry } from "@tuidom/elements/menu/popupMenuElement";
import { token } from "../../instantiation/common/diContainer.ts";

import type { MenuContribution } from "./iMenuContribution.ts";
import type { MenuId } from "./menuId.ts";
import type { IMenuEntryGroup, ISubmenuEntry, MenuRegistry, SubmenuResolver } from "./menuRegistry.ts";
import { joinMenuGroups, MenuRegistryDIToken } from "./menuRegistry.ts";

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

    /**
     * Пункты точки, готовые к показу в попапе: submenu-записи резолвятся во
     * вложенные попапы (eager, на момент вызова — `when` учитывается сейчас).
     * Разовый резолв без подписки — для тех, кто собирает меню при открытии.
     */
    public getEntries(menuId: MenuId, context?: unknown): MenuEntry[] {
        return joinMenuGroups(this.getEntryGroups(menuId, context));
    }

    /** Есть ли у точки пункты без учёта `when` (см. `MenuRegistry.hasItems`). */
    public hasItems(menuId: MenuId, context?: unknown, predicate?: (item: MenuContribution) => boolean): boolean {
        return this.registry.hasItems(menuId, context, predicate);
    }

    /** То же, но с сохранением групп (см. `MenuRegistry.getMenuItemGroups`). */
    public getEntryGroups(menuId: MenuId, context?: unknown): IMenuEntryGroup[] {
        const seen = new Set<MenuId>([menuId]);
        return this.registry.getMenuItemGroups(menuId, context, this.submenuResolver(context, seen));
    }

    /** Пустые подменю выбрасываются; `seen` рвёт циклы `MenuId` (как `submenuIds` в vscode `menu.ts`). */
    private submenuResolver(context: unknown, seen: Set<MenuId>): SubmenuResolver {
        return (submenu) => {
            if (seen.has(submenu.submenu)) return null;
            seen.add(submenu.submenu);
            const entries = this.registry.getMenuItems(submenu.submenu, context, this.submenuResolver(context, seen));
            if (entries.length === 0) return null;
            return { type: "submenu", label: submenu.title, entries };
        };
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
