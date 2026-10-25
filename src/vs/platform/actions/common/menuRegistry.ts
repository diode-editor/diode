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
import { deserializeWhen, whenKeys } from "../../contextkey/common/contextKeyExpr.ts";
import type { ContextKeyService, ContextKeySettableValue } from "../../contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../contextkey/common/contextKeyService.ts";
import { token } from "../../instantiation/common/diContainer.ts";
import type { KeybindingRegistry } from "../../keybinding/common/keybindingRegistry.ts";
import {
    formatKeybinding,
    keybindingLabelStyle,
    KeybindingRegistryDIToken,
} from "../../keybinding/common/keybindingRegistry.ts";
import type { IProductIconService } from "../../theme/common/productIconService.ts";
import { NERD_FONT_ICONS, ProductIconServiceDIToken } from "../../theme/common/productIconService.ts";

import type { IMenuContribution, ISubmenuContribution, MenuContribution } from "./iMenuContribution.ts";
import { isSubmenuContribution, MenuContributionsDIToken } from "./iMenuContribution.ts";
import type { MenuId } from "./menuId.ts";

export interface ISubmenuEntry {
    readonly title: string;
    readonly mnemonic?: string;
    readonly submenu: MenuId;
    /** Rendered as a dropdown instead of a nested popup (VS Code toolbar `SelectBox`). */
    readonly isSelection?: boolean;
}

export const CHECKED_ICON = "\u2713"; // ✓

export const MenuRegistryDIToken = token<MenuRegistry>("MenuRegistry");

/** `enabled` is read by the view title (dimmed button), the engine's `disabled` by the popup. */
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

/** Context keys a menu owner adds on top of the global ones for one resolve. */
export type MenuContextKeys = Readonly<Record<string, ContextKeySettableValue>>;

export function joinMenuGroups(groups: readonly IMenuEntryGroup[]): MenuEntry[] {
    const result: MenuEntry[] = [];
    for (const group of groups) {
        if (result.length > 0) result.push({ type: "separator" });
        result.push(...group.entries);
    }
    return result;
}

/** `null` drops the submenu (empty or a `MenuId` cycle). */
export type SubmenuResolver = (submenu: ISubmenuEntry) => MenuSubmenuEntry | null;

/**
 * `navigation` always comes first, as in VS Code `_compareMenuItems`. Keys are unique
 * within a menu, so there is no equality branch.
 */
function compareGroups(a: string, b: string): number {
    if (a === "navigation") return -1;
    if (b === "navigation") return 1;
    return a < b ? -1 : 1;
}

/** Items within a group are sorted by order, ties broken stably by insertion index. */
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

/** Open-time state (e.g. the clipboard) comes in via the `context` parameter, not via DI. */
export class MenuRegistry {
    public static dependencies = [
        CommandRegistryDIToken,
        KeybindingRegistryDIToken,
        ContextKeyServiceDIToken,
        MenuContributionsDIToken,
        ProductIconServiceDIToken,
    ] as const;

    private readonly items: MenuContribution[];
    private readonly onDidChangeMenuEmitter = new Emitter<MenuId>();

    public constructor(
        private readonly commands: CommandRegistry,
        private readonly keybindings: KeybindingRegistry,
        private readonly contextKeys: ContextKeyService,
        contributions: readonly MenuContribution[],
        private readonly icons: IProductIconService = NERD_FONT_ICONS,
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

    /**
     * `keys` are the menu owner's context keys on top of the global ones, like upstream's scoped
     * context key service: a section's title menu evaluates `view == <id>` with its own `view`.
     */
    public getMenuItemGroups(
        menuId: MenuId,
        context?: unknown,
        resolveSubmenu?: SubmenuResolver,
        keys?: MenuContextKeys,
    ): IMenuEntryGroup[] {
        const visible = this.items.filter((item) => {
            if (item.menuId !== menuId) return false;
            // Without a resolver, submenu entries are consumed only by `getSubmenus` (the menu bar).
            if (isSubmenuContribution(item)) {
                if (resolveSubmenu === undefined) return false;
                if (item.when !== undefined && !this.contextKeys.evaluate(item.when, keys)) return false;
                // Sidebar section submenus are filtered by `menuContext.view`: a when key
                // does not work, since the sidebar shows several sections.
                if (item.visible !== undefined && !item.visible(context)) return false;
                return true;
            }
            if (item.when !== undefined && !this.contextKeys.evaluate(item.when, keys)) return false;
            if (item.visible !== undefined && !item.visible(context)) return false;
            return true;
        });

        const result: IMenuEntryGroup[] = [];
        for (const bucket of collectSorted(visible)) {
            const groupEntries: ResolvedMenuEntry[] = [];
            for (const item of bucket) {
                if (isSubmenuContribution(item)) {
                    // The resolver is always present here: without it the filter above drops submenu entries.
                    const entry = resolveSubmenu?.(this.toSubmenuEntry(item)) ?? null;
                    if (entry !== null)
                        groupEntries.push(item.isSelection === true ? { ...entry, isSelection: true } : entry);
                } else {
                    groupEntries.push(this.toEntry(item, context, keys));
                }
            }
            if (groupEntries.length === 0) continue;
            result.push({ group: bucket[0].group ?? "", entries: groupEntries });
        }
        return result;
    }

    /**
     * Ignores `when`: the "⋯" button stays in the title all the time, and `when` keys change
     * without events, so "is it empty now" would hide the button forever if the key
     * was false at build time.
     */
    public hasItems(menuId: MenuId, context?: unknown, predicate?: (item: MenuContribution) => boolean): boolean {
        return this.items.some((item) => {
            if (item.menuId !== menuId) return false;
            if (item.visible !== undefined && !item.visible(context)) return false;
            return predicate?.(item) ?? true;
        });
    }

    public getMenuItems(
        menuId: MenuId,
        context?: unknown,
        resolveSubmenu?: SubmenuResolver,
        keys?: MenuContextKeys,
    ): MenuEntry[] {
        return joinMenuGroups(this.getMenuItemGroups(menuId, context, resolveSubmenu, keys));
    }

    /**
     * Upstream `menuService.getMenuContexts`: every key the menu's `when`, `enablement` and `toggled` read — a
     * persistent rendering of the menu redraws only when one of them changes.
     */
    public getMenuContexts(menuId: MenuId): ReadonlySet<string> {
        const keys = new Set<string>();
        for (const item of this.items) {
            if (item.menuId !== menuId) continue;
            const conditions = isSubmenuContribution(item) ? [item.when] : [item.when, item.enablement, item.toggled];
            for (const condition of conditions) {
                const expr = condition === undefined ? undefined : deserializeWhen(condition);
                if (expr !== undefined) for (const key of whenKeys(expr)) keys.add(key);
            }
        }
        return keys;
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

    private toEntry(
        item: IMenuContribution,
        context: unknown,
        keys: MenuContextKeys | undefined,
    ): IResolvedMenuItemEntry {
        const label = item.title ?? this.commands.getTitle(item.command) ?? item.command;
        const resolvedArgs = item.args ? item.args(context) : [];
        // Captured at resolve time, like VS Code when opening a popup; inline buttons
        // do not go stale: their groups are re-resolved both on click and on context change.
        const enabled = item.enablement === undefined || this.contextKeys.evaluate(item.enablement, keys);
        // Stryker disable next-line ConditionalExpression: equivalent — an absent `toggled` evaluates to false, the icon stays the item's
        const toggled = item.toggled !== undefined && this.contextKeys.evaluate(item.toggled, keys);
        return {
            label,
            id: item.command,
            enabled,
            disabled: !enabled,
            shortcut: this.resolveShortcut(item),
            icon: toggled ? CHECKED_ICON : this.iconOf(item),
            onSelect: () => {
                // A contribution may point to an extension command that has no guard of its own.
                if (!enabled) return;
                this.commands.execute(item.command, ...resolvedArgs);
            },
        };
    }

    /** Resolved per call, like the rest of the entry: a glyph set switch shows on the next resolve. */
    private iconOf(item: IMenuContribution): string | undefined {
        return item.icon === undefined ? undefined : this.icons.glyph(item.icon);
    }

    private resolveShortcut(item: IMenuContribution): string | undefined {
        if (item.shortcut === false) return undefined;
        if (typeof item.shortcut === "string") return item.shortcut;
        const chord = this.keybindings.getKeybindingForCommand(item.command, this.contextKeys);
        return chord ? formatKeybinding(chord, keybindingLabelStyle(this.contextKeys)) : undefined;
    }
}
