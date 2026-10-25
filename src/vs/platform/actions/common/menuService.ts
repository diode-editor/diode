import type { MenuEntry } from "@tuidom/elements/menu/popupMenuElement";

import { Emitter } from "../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../base/common/lifecycle.ts";
import { token } from "../../instantiation/common/diContainer.ts";

import type { MenuContribution } from "./iMenuContribution.ts";
import type { MenuId } from "./menuId.ts";
import type { IMenuEntryGroup, ISubmenuEntry, MenuContextKeys, MenuRegistry, SubmenuResolver } from "./menuRegistry.ts";
import { joinMenuGroups, MenuRegistryDIToken } from "./menuRegistry.ts";

export const MenuServiceDIToken = token<MenuService>("MenuService");

/**
 * `onDidChange` fires only when the registry contents change; `when` and `enablement` are evaluated
 * on every `getEntries`; persistent UI re-resolves on `ContextKeyService.onDidChange`.
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

    /** One-off resolve without a subscription: submenus expand immediately, `when` is evaluated at call time. */
    public getEntries(menuId: MenuId, context?: unknown): MenuEntry[] {
        return joinMenuGroups(this.getEntryGroups(menuId, context));
    }

    public hasItems(menuId: MenuId, context?: unknown, predicate?: (item: MenuContribution) => boolean): boolean {
        return this.registry.hasItems(menuId, context, predicate);
    }

    /** `keys` — the owner's context keys on top of the global ones ({@link MenuRegistry.getMenuItemGroups}). */
    public getEntryGroups(menuId: MenuId, context?: unknown, keys?: MenuContextKeys): IMenuEntryGroup[] {
        const seen = new Set<MenuId>([menuId]);
        return this.registry.getMenuItemGroups(menuId, context, this.submenuResolver(context, seen, keys), keys);
    }

    /** Empty submenus are dropped; `seen` breaks `MenuId` cycles (like `submenuIds` in vscode `menu.ts`). */
    private submenuResolver(context: unknown, seen: Set<MenuId>, keys?: MenuContextKeys): SubmenuResolver {
        return (submenu) => {
            if (seen.has(submenu.submenu)) return null;
            seen.add(submenu.submenu);
            const entries = this.registry.getMenuItems(
                submenu.submenu,
                context,
                this.submenuResolver(context, seen, keys),
                keys,
            );
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
