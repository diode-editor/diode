import type { MenuEntry } from "@tuidom/elements/menu/popupMenuElement";

import { Emitter } from "../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../base/common/lifecycle.ts";
import { token } from "../../instantiation/common/diContainer.ts";

import type { MenuContribution } from "./iMenuContribution.ts";
import type { MenuId } from "./menuId.ts";
import type { IMenuEntryGroup, ISubmenuEntry, MenuRegistry, SubmenuResolver } from "./menuRegistry.ts";
import { joinMenuGroups, MenuRegistryDIToken } from "./menuRegistry.ts";

export const MenuServiceDIToken = token<MenuService>("MenuService");

/**
 * `onDidChange` — только смена состава реестра; `when` и `enablement` учитываются
 * при каждом `getEntries`, постоянный UI пере-резолвится по `ContextKeyService.onDidChange`.
 */
export interface IMenu extends IDisposable {
    getEntries(context?: unknown, resolveSubmenu?: SubmenuResolver): MenuEntry[];
    getSubmenus(): ISubmenuEntry[];
    onDidChange(listener: () => void): IDisposable;
}

export class MenuService {
    public static dependencies = [MenuRegistryDIToken] as const;

    public constructor(private readonly registry: MenuRegistry) {}

    public createMenu(menuId: MenuId): IMenu {
        return new Menu(this.registry, menuId);
    }

    /** Разовый резолв без подписки: подменю раскрываются сразу, `when` — на момент вызова. */
    public getEntries(menuId: MenuId, context?: unknown): MenuEntry[] {
        return joinMenuGroups(this.getEntryGroups(menuId, context));
    }

    public hasItems(menuId: MenuId, context?: unknown, predicate?: (item: MenuContribution) => boolean): boolean {
        return this.registry.hasItems(menuId, context, predicate);
    }

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
    private readonly onDidChangeEmitter = this.register(new Emitter<void>());
    public readonly onDidChange = this.onDidChangeEmitter.event;

    public constructor(
        private readonly registry: MenuRegistry,
        private readonly menuId: MenuId,
    ) {
        super();
        this.register(
            this.registry.onDidChangeMenu((changed) => {
                if (changed !== this.menuId) return;
                this.onDidChangeEmitter.fire();
            }),
        );
    }

    public getEntries(context?: unknown, resolveSubmenu?: SubmenuResolver): MenuEntry[] {
        return this.registry.getMenuItems(this.menuId, context, resolveSubmenu);
    }

    public getSubmenus(): ISubmenuEntry[] {
        return this.registry.getSubmenus(this.menuId);
    }
}
