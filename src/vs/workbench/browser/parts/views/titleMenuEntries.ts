import type { MenuEntry, MenuSubmenuEntry } from "@tuidom/elements/menu/popupMenuElement";

import type {
    IMenuEntryGroup,
    IResolvedMenuItemEntry,
    IResolvedSplitButton,
    ResolvedMenuEntry,
} from "../../../../platform/actions/common/menuRegistry.ts";
import { joinMenuGroups } from "../../../../platform/actions/common/menuRegistry.ts";

import type { IViewTitleAction } from "./viewTitleRowElement.ts";

export const NAVIGATION_GROUP = "navigation";

/** A literal, like "⋯": the arrow reads the same in both glyph sets. */
const DROPDOWN_ICON = "▾"; // ▾

/**
 * Upstream `DropdownWithDefaultActionViewItem` keeps the item last picked from a split button's arrow in
 * storage (`<submenu>_lastActionId`, workspace scope); the title bar owner supplies where.
 */
export interface ISplitButtonMemory {
    lastActionId(submenu: string): string | undefined;
    remember(submenu: string, actionId: string): void;
}

/** What only the title bar owner can do for a split button: remember the pick and open the arrow's popup. */
export interface ISplitButtonHost {
    readonly memory: ISplitButtonMemory;
    showDropdown(entries: MenuEntry[]): void;
}

/** Not a command id: the same command may also be an inline item of the group. */
const SPLIT_PRIMARY_PREFIX = "splitButton.primary:";
const SPLIT_DROPDOWN_PREFIX = "splitButton.dropdown:";

/**
 * A `navigation` item without an icon stays in "⋯": its label won't fit in a 30-column sidebar.
 * Same for submenu entries, except selection submenus (see {@link overflowEntries}) and split buttons
 * that have a glyph to show (see {@link splitButtonOf}).
 */
export function inlineActions(groups: readonly IMenuEntryGroup[], memory?: ISplitButtonMemory): IViewTitleAction[] {
    const navigation = groups.find((group) => group.group === NAVIGATION_GROUP);
    if (navigation === undefined) return [];
    return navigation.entries.flatMap((entry): IViewTitleAction[] => {
        if (isInlineItem(entry)) {
            return [{ id: entry.id, icon: entry.icon, enabled: entry.enabled, color: entry.iconColor }];
        }
        const split = splitButtonOf(entry, memory);
        if (split === null) return [];
        const { primary } = split;
        return [
            {
                id: SPLIT_PRIMARY_PREFIX + split.submenu,
                icon: split.icon,
                enabled: primary.enabled,
                color: primary.iconColor,
            },
            { id: SPLIT_DROPDOWN_PREFIX + split.submenu, icon: DROPDOWN_ICON, attached: true },
        ];
    });
}

/**
 * The view owner renders a selection submenu of the `navigation` group (`isSelection`) itself as
 * a dropdown, like VS Code does with the toolbar `SelectBox`; a "⋯" item would duplicate that list.
 * A drawn split button has its own arrow for the same reason.
 */
export function overflowEntries(groups: readonly IMenuEntryGroup[], memory?: ISplitButtonMemory): MenuEntry[] {
    const rest = groups.map((group) =>
        group.group === NAVIGATION_GROUP
            ? {
                  group: group.group,
                  entries: group.entries.filter(
                      (entry) =>
                          !isInlineItem(entry) && !isSelectionSubmenu(entry) && splitButtonOf(entry, memory) === null,
                  ),
              }
            : group,
    );
    return joinMenuGroups(rest.filter((group) => group.entries.length > 0));
}

export function runAction(groups: readonly IMenuEntryGroup[], actionId: string, host?: ISplitButtonHost): void {
    for (const group of groups) {
        for (const entry of group.entries) {
            if (isInlineItem(entry) && entry.id === actionId) {
                // A disabled button still takes the click (otherwise the click would collapse the section) but
                // does nothing: the refusal lives in the resolved entry itself (`MenuRegistry.toEntry`).
                // Stryker disable next-line OptionalChaining: every entry resolved by MenuRegistry has onSelect; guards against foreign MenuEntry implementations
                entry.onSelect?.();
                return;
            }
            const split = group.group === NAVIGATION_GROUP ? splitButtonOf(entry, host?.memory) : null;
            if (split === null) continue;
            if (actionId === SPLIT_PRIMARY_PREFIX + split.submenu) {
                // Like an inline button: a disabled primary takes the click, the refusal lives in `onSelect`.
                split.primary.onSelect?.();
                return;
            }
            if (actionId === SPLIT_DROPDOWN_PREFIX + split.submenu) {
                host?.showDropdown(
                    split.togglePrimaryAction ? remembering(split.entries, split.submenu, host.memory) : split.entries,
                );
                return;
            }
        }
    }
}

export function isSelectionSubmenu(entry: ResolvedMenuEntry): boolean {
    // Stryker disable next-line ConditionalExpression: the type check is TS narrowing; the registry sets `isSelection` only on submenu entries, never on command items
    return entry.type === "submenu" && entry.isSelection === true;
}

export function isInlineItem(entry: ResolvedMenuEntry): entry is IResolvedMenuItemEntry & { id: string; icon: string } {
    // Stryker disable next-line ConditionalExpression,LogicalOperator: the type check is TS narrowing; submenus and separators have no `id` and the next check filters them out
    if (entry.type !== undefined) return false;
    return typeof entry.id === "string" && typeof entry.icon === "string";
}

interface ISplitButton extends IResolvedSplitButton {
    readonly icon: string;
    /** The item the button runs: the remembered one while it is still in the submenu, otherwise the first. */
    readonly primary: IResolvedMenuItemEntry;
    readonly entries: MenuEntry[];
}

/**
 * `null` for anything but a split button that can be drawn: without a command item there is nothing to run,
 * and without a glyph (an SVG icon and no fallback) the submenu goes to "⋯" with its label instead.
 */
function splitButtonOf(entry: ResolvedMenuEntry, memory: ISplitButtonMemory | undefined): ISplitButton | null {
    // Stryker disable next-line ConditionalExpression: the type check is TS narrowing; only submenu entries carry `splitButton`, the next check filters the rest out
    if (entry.type !== "submenu" || entry.splitButton === undefined) return null;
    const split = entry.splitButton;
    const entries = submenuEntries(entry);
    const items = entries.filter(isCommandItem);
    const remembered = split.togglePrimaryAction ? memory?.lastActionId(split.submenu) : undefined;
    const primary = items.find((item) => item.id === remembered) ?? items.at(0);
    if (primary === undefined) return null;
    const icon = primary.icon ?? split.icon;
    if (icon === undefined) return null;
    return { ...split, icon, primary, entries };
}

/** Upstream promotes whatever item the arrow's popup runs, nested submenus included. */
function remembering(entries: readonly MenuEntry[], submenu: string, memory: ISplitButtonMemory): MenuEntry[] {
    return entries.map((entry): MenuEntry => {
        if (entry.type === "submenu") return { ...entry, entries: remembering(submenuEntries(entry), submenu, memory) };
        // Separators and entries without an id stay as they are: there is nothing to remember.
        if (!isCommandItem(entry)) return entry;
        const { id, onSelect } = entry;
        return {
            ...entry,
            onSelect: () => {
                // Before the run: the command may change context keys, and that re-render must see the new pick.
                memory.remember(submenu, id);
                onSelect?.();
            },
        };
    });
}

function submenuEntries(entry: MenuSubmenuEntry): MenuEntry[] {
    return typeof entry.entries === "function" ? entry.entries() : entry.entries;
}

function isCommandItem(entry: MenuEntry): entry is IResolvedMenuItemEntry & { id: string } {
    // Stryker disable next-line ConditionalExpression,LogicalOperator: the type check is TS narrowing; submenus and separators have no `id` and the next check filters them out
    return entry.type === undefined && typeof entry.id === "string";
}
