import type {
    MenuEntry,
    MenuItemEntry,
    MenuSeparatorEntry,
    MenuSubmenuEntry,
} from "@tuidom/elements/menu/popupMenuElement";

import { Emitter } from "../../../base/common/event.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { CommandRegistry } from "../../commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../commands/common/commandRegistry.ts";
import type { ContextKeyService } from "../../contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../contextkey/common/contextKeyService.ts";
import { token } from "../../instantiation/common/diContainer.ts";
import type { KeybindingRegistry } from "../../keybinding/common/keybindingRegistry.ts";
import {
    formatKeybinding,
    keybindingLabelStyle,
    KeybindingRegistryDIToken,
} from "../../keybinding/common/keybindingRegistry.ts";

import type { IMenuContribution, ISubmenuContribution, MenuContribution } from "./iMenuContribution.ts";
import { isSubmenuContribution, MenuContributionsDIToken } from "./iMenuContribution.ts";
import type { MenuId } from "./menuId.ts";

export interface ISubmenuEntry {
    readonly title: string;
    readonly mnemonic?: string;
    readonly submenu: MenuId;
    /** Рендерится выпадающим списком, а не вложенным попапом (`SelectBox` тулбара VS Code). */
    readonly isSelection?: boolean;
}

export const CHECKED_ICON = "\u2713"; // ✓

export const MenuRegistryDIToken = token<MenuRegistry>("MenuRegistry");

/** `enabled` читает заголовок view (кнопка приглушена), `disabled` движка — попап. */
export interface IResolvedMenuItemEntry extends MenuItemEntry {
    readonly enabled: boolean;
}

export type ResolvedMenuEntry = IResolvedMenuItemEntry | MenuSeparatorEntry | IResolvedSubmenuEntry;

export interface IResolvedSubmenuEntry extends MenuSubmenuEntry {
    readonly isSelection?: boolean;
}

export interface IMenuEntryGroup {
    readonly group: string;
    readonly entries: readonly ResolvedMenuEntry[];
}

export function joinMenuGroups(groups: readonly IMenuEntryGroup[]): MenuEntry[] {
    const result: MenuEntry[] = [];
    for (const group of groups) {
        if (result.length > 0) result.push({ type: "separator" });
        result.push(...group.entries);
    }
    return result;
}

/** `null` — подменю выбрасывается (пустое или цикл `MenuId`). */
export type SubmenuResolver = (submenu: ISubmenuEntry) => MenuSubmenuEntry | null;

/**
 * `navigation` всегда первая, как в `_compareMenuItems` VS Code. Ключи в пределах
 * меню уникальны, поэтому ветки равенства нет.
 */
function compareGroups(a: string, b: string): number {
    if (a === "navigation") return -1;
    if (b === "navigation") return 1;
    return a < b ? -1 : 1;
}

/** Пункты внутри группы — по order, при равенстве стабильно по индексу вставки. */
function collectSorted<T extends { group?: string; order?: number }>(items: readonly T[]): T[][] {
    const groups = new Map<string, { item: T; index: number }[]>();
    items.forEach((item, index) => {
        const key = item.group ?? "";
        const bucket = groups.get(key);
        if (bucket) bucket.push({ item, index });
        else groups.set(key, [{ item, index }]);
    });
    return [...groups.entries()]
        .sort(([left], [right]) => compareGroups(left, right))
        .map(([, bucket]) => {
            bucket.sort((a, b) => (a.item.order ?? 0) - (b.item.order ?? 0) || a.index - b.index);
            return bucket.map((entry) => entry.item);
        });
}

/** Состояние открытия (напр. буфер обмена) приходит параметром `context`, не через DI. */
export class MenuRegistry {
    public static dependencies = [
        CommandRegistryDIToken,
        KeybindingRegistryDIToken,
        ContextKeyServiceDIToken,
        MenuContributionsDIToken,
    ] as const;

    private readonly items: MenuContribution[];
    private readonly onDidChangeMenuEmitter = new Emitter<MenuId>();

    public constructor(
        private readonly commands: CommandRegistry,
        private readonly keybindings: KeybindingRegistry,
        private readonly contextKeys: ContextKeyService,
        contributions: readonly MenuContribution[],
    ) {
        this.items = [...contributions];
    }

    public appendMenuItem(item: MenuContribution): IDisposable {
        this.items.push(item);
        this.fireDidChangeMenu(item.menuId);
        return {
            dispose: () => {
                const index = this.items.indexOf(item);
                if (index >= 0) {
                    this.items.splice(index, 1);
                    this.fireDidChangeMenu(item.menuId);
                }
            },
        };
    }

    public readonly onDidChangeMenu = this.onDidChangeMenuEmitter.event;

    private fireDidChangeMenu(menuId: MenuId): void {
        this.onDidChangeMenuEmitter.fire(menuId);
    }

    public getMenuItemGroups(menuId: MenuId, context?: unknown, resolveSubmenu?: SubmenuResolver): IMenuEntryGroup[] {
        const visible = this.items.filter((item) => {
            if (item.menuId !== menuId) return false;
            // Без резолвера submenu-записи потребляет только `getSubmenus` (меню-бар).
            if (isSubmenuContribution(item)) {
                if (resolveSubmenu === undefined) return false;
                if (item.when !== undefined && !this.contextKeys.evaluate(item.when)) return false;
                // Подменю секции сайдбара фильтруются по `menuContext.view`: when-ключ
                // не годится — в сайдбаре видно несколько секций.
                if (item.visible !== undefined && !item.visible(context)) return false;
                return true;
            }
            if (item.when !== undefined && !this.contextKeys.evaluate(item.when)) return false;
            if (item.visible !== undefined && !item.visible(context)) return false;
            return true;
        });

        const result: IMenuEntryGroup[] = [];
        for (const bucket of collectSorted(visible)) {
            const groupEntries: ResolvedMenuEntry[] = [];
            for (const item of bucket) {
                if (isSubmenuContribution(item)) {
                    // Резолвер здесь заведомо есть: без него submenu-записи отсеял фильтр выше.
                    const entry = resolveSubmenu?.(this.toSubmenuEntry(item)) ?? null;
                    if (entry !== null)
                        groupEntries.push(item.isSelection === true ? { ...entry, isSelection: true } : entry);
                } else {
                    groupEntries.push(this.toEntry(item, context));
                }
            }
            if (groupEntries.length === 0) continue;
            result.push({ group: bucket[0].group ?? "", entries: groupEntries });
        }
        return result;
    }

    /**
     * БЕЗ `when`: кнопка «⋯» живёт в заголовке всё время, а `when`-ключи меняются
     * без событий — «пусто ли сейчас» навсегда спрятало бы кнопку, если в момент
     * сборки ключ был ложным.
     */
    public hasItems(menuId: MenuId, context?: unknown, predicate?: (item: MenuContribution) => boolean): boolean {
        return this.items.some((item) => {
            if (item.menuId !== menuId) return false;
            if (item.visible !== undefined && !item.visible(context)) return false;
            return predicate?.(item) ?? true;
        });
    }

    public getMenuItems(menuId: MenuId, context?: unknown, resolveSubmenu?: SubmenuResolver): MenuEntry[] {
        return joinMenuGroups(this.getMenuItemGroups(menuId, context, resolveSubmenu));
    }

    public getSubmenus(menuId: MenuId): ISubmenuEntry[] {
        const visible = this.items.filter((item): item is ISubmenuContribution => {
            if (item.menuId !== menuId) return false;
            if (!isSubmenuContribution(item)) return false;
            if (item.when !== undefined && !this.contextKeys.evaluate(item.when)) return false;
            return true;
        });
        return collectSorted(visible)
            .flat()
            .map((item) => this.toSubmenuEntry(item));
    }

    private toSubmenuEntry(item: ISubmenuContribution): ISubmenuEntry {
        return {
            title: item.title,
            mnemonic: item.mnemonic,
            submenu: item.submenu,
            isSelection: item.isSelection,
        };
    }

    private toEntry(item: IMenuContribution, context: unknown): IResolvedMenuItemEntry {
        const label = item.title ?? this.commands.getTitle(item.command) ?? item.command;
        const resolvedArgs = item.args ? item.args(context) : [];
        // Фиксируется на момент резолва, как VS Code при открытии попапа; inline-кнопки
        // не протухают — их группы пере-резолвятся и на клике, и по смене контекста.
        const enabled = item.enablement === undefined || this.contextKeys.evaluate(item.enablement);
        return {
            label,
            id: item.command,
            enabled,
            disabled: !enabled,
            shortcut: this.resolveShortcut(item),
            icon: item.toggled !== undefined && this.contextKeys.evaluate(item.toggled) ? CHECKED_ICON : item.icon,
            onSelect: () => {
                // Контрибуция может ссылаться на команду расширения без своего guard'а.
                if (!enabled) return;
                this.commands.execute(item.command, ...resolvedArgs);
            },
        };
    }

    private resolveShortcut(item: IMenuContribution): string | undefined {
        if (item.shortcut === false) return undefined;
        if (typeof item.shortcut === "string") return item.shortcut;
        const chord = this.keybindings.getKeybindingForCommand(item.command, this.contextKeys);
        return chord ? formatKeybinding(chord, keybindingLabelStyle(this.contextKeys)) : undefined;
    }
}
