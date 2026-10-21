import type { EditorGroup } from "../../services/editor/browser/editorGroupModel.ts";
import type { IEditorGroupsService } from "../../services/editor/common/editorGroupsService.ts";

export interface TabTarget {
    readonly group: EditorGroup;
    readonly index: number;
}

/** A pair of numbers `(groupId, index)`. */
function hasTabAddress(args: readonly unknown[]): boolean {
    return typeof args[0] === "number" && typeof args[1] === "number";
}

/** `null` when there is no address or the tab has already been closed. */
export function resolveAddressedTab(groups: IEditorGroupsService, args: readonly unknown[]): TabTarget | null {
    // Stryker disable next-line ConditionalExpression: the check is redundant — both the group lookup by id and getPane below reject non-address arguments, returning the same null
    if (!hasTabAddress(args)) return null;
    const [groupId, index] = args as [number, number];
    const group = groups.groups.find((candidate) => candidate.id === groupId);
    if (group?.getPane(index) == null) return null;
    return { group, index };
}

/**
 * A stale address does NOT fall back to the active tab: a menu command must
 * do what the menu says, or nothing.
 */
export function resolveTabTarget(groups: IEditorGroupsService, args: readonly unknown[]): TabTarget | null {
    if (hasTabAddress(args)) return resolveAddressedTab(groups, args);
    const group = groups.activeGroup;
    if (group.activeIndex < 0) return null;
    return { group, index: group.activeIndex };
}
