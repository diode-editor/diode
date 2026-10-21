import type { MenuEntry } from "@tuidom/elements/menu/popupMenuElement";

import type {
    IMenuEntryGroup,
    IResolvedMenuItemEntry,
    ResolvedMenuEntry,
} from "../../../../platform/actions/common/menuRegistry.ts";
import { joinMenuGroups } from "../../../../platform/actions/common/menuRegistry.ts";

import type { IViewTitleAction } from "./viewTitleRowElement.ts";

export const NAVIGATION_GROUP = "navigation";

/**
 * A `navigation` item without an icon stays in "⋯": its label won't fit in a 30-column sidebar.
 * Same for submenu entries, except selection submenus (see {@link overflowEntries}).
 */
export function inlineActions(groups: readonly IMenuEntryGroup[]): IViewTitleAction[] {
    const navigation = groups.find((group) => group.group === NAVIGATION_GROUP);
    if (navigation === undefined) return [];
    return navigation.entries
        .filter(isInlineItem)
        .map((entry) => ({ id: entry.id, icon: entry.icon, enabled: entry.enabled }));
}

/**
 * The view owner renders a selection submenu of the `navigation` group (`isSelection`) itself as
 * a dropdown, like VS Code does with the toolbar `SelectBox`; a "⋯" item would duplicate that list.
 */
export function overflowEntries(groups: readonly IMenuEntryGroup[]): MenuEntry[] {
    const rest = groups.map((group) =>
        group.group === NAVIGATION_GROUP
            ? {
                  group: group.group,
                  entries: group.entries.filter((entry) => !isInlineItem(entry) && !isSelectionSubmenu(entry)),
              }
            : group,
    );
    return joinMenuGroups(rest.filter((group) => group.entries.length > 0));
}

export function runAction(groups: readonly IMenuEntryGroup[], actionId: string): void {
    for (const group of groups) {
        for (const entry of group.entries) {
            if (isInlineItem(entry) && entry.id === actionId) {
                // A disabled button still takes the click (otherwise the click would collapse the section) but
                // does nothing: the refusal lives in the resolved entry itself (`MenuRegistry.toEntry`).
                // Stryker disable next-line OptionalChaining: every entry resolved by MenuRegistry has onSelect; guards against foreign MenuEntry implementations
                entry.onSelect?.();
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
