import type { MenuEntry, MenuItemEntry } from "@tuidom/elements/menu/popupMenuElement";
import type { ITreeItemAction } from "@tuidom/elements/tree/iTreeDataProvider";

import type { IMenuEntryGroup, IResolvedMenuItemEntry } from "../../../../platform/actions/common/menuRegistry.ts";

// A tree row's menu (upstream `TreeMenus` of `browser/parts/views/treeView.ts`, `getActionableElementActions` of the
// Test Explorer): the `inline` group is the row's glyph buttons, the rest its context menu. The registry's entries
// run their command without the row; the tree passes its row as the arguments.

/** Upstream `getContextMenuActions(menuData, 'inline')`: this group is the row's buttons, the rest its menu. */
export const INLINE_MENU_GROUP = "inline";

/** A submenu can't be a glyph: upstream's inline group shows only actions. A group holds no separators. */
export function inlineMenuEntries(groups: readonly IMenuEntryGroup[]): IResolvedMenuItemEntry[] {
    return groups.flatMap((group) =>
        group.entries.filter((entry): entry is IResolvedMenuItemEntry => entry.type !== "submenu"),
    );
}

/** The command's icon, or its title when it has none (or its glyph is missing from the font set). */
export function inlineMenuActions(groups: readonly IMenuEntryGroup[]): ITreeItemAction[] {
    return inlineMenuEntries(groups).map((entry) => ({ label: entry.label, icon: menuEntryGlyph(entry) }));
}

/** The entry's glyph; none when the command has no icon or its glyph is missing from the font set. */
export function menuEntryGlyph(entry: IResolvedMenuItemEntry): string | undefined {
    return entry.icon === "" ? undefined : entry.icon;
}

/** Every item of the menu, submenus included, runs through `run` instead of the registry's handler. */
export function bindMenuEntry(entry: MenuEntry, run: (entry: MenuItemEntry) => void): MenuEntry {
    // Stryker disable next-line ConditionalExpression,StringLiteral: equivalent — a separator given `onSelect` below is still a separator to the popup
    if (entry.type === "separator") return entry;
    if (entry.type === "submenu") {
        // The engine's submenu may be lazy; the registry's is eager, both bind their items.
        const entries = typeof entry.entries === "function" ? entry.entries() : entry.entries;
        return { ...entry, entries: entries.map((child) => bindMenuEntry(child, run)) };
    }
    return {
        ...entry,
        onSelect: () => {
            run(entry);
        },
    };
}

/** A disabled item does nothing; a throw or a rejection of the command goes to `fail`. */
export function runMenuEntry(
    entry: MenuItemEntry,
    execute: (id: string) => unknown,
    fail: (message: string) => void,
): void {
    // Stryker disable next-line ConditionalExpression: the registry always sets `id` (the command) on an item entry
    if (entry.disabled === true || entry.id === undefined) return;
    const report = (err: unknown): void => {
        fail(err instanceof Error ? err.message : String(err));
    };
    try {
        Promise.resolve(execute(entry.id)).catch(report);
    } catch (err: unknown) {
        report(err);
    }
}
