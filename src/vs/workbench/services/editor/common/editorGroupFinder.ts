import type { Uri } from "../../../../base/common/uri.ts";
import type { EditorGroup } from "../browser/editorGroupModel.ts";

import type { IEditorGroupsService } from "./editorGroupsService.ts";

/** A group means exactly that group (a user gesture, a column, a recipe): a lock does not redirect it. */
export type PreferredGroup = EditorGroup | "beside" | undefined;

/**
 * Upstream `isGroupLockedForEditor`: a locked group still takes the resource it already holds,
 * so a repeat open reveals the tab instead of duplicating it elsewhere. No resource — a new editor.
 */
export function isGroupLockedForEditor(group: EditorGroup, resource: Uri | undefined): boolean {
    if (!group.isLocked) return false;
    return resource === undefined || group.findPaneIndex(resource) < 0;
}

/**
 * The target {@link findGroup} would pick without creating a group; `undefined` where it would create one.
 * Side-effect free: the open path asks it whether the resource is already open in the target.
 */
export function peekGroup(
    groups: IEditorGroupsService,
    resource: Uri | undefined,
    preferred: PreferredGroup,
): EditorGroup | undefined {
    if (preferred !== undefined && preferred !== "beside") return preferred;
    if (preferred === "beside") {
        const neighbor = groups.groups.at(groups.groups.indexOf(groups.activeGroup) + 1);
        return neighbor !== undefined && !isGroupLockedForEditor(neighbor, resource) ? neighbor : undefined;
    }
    // The active group heads the MRU order: it wins whenever it is not locked.
    return groups.getGroupsByMru().find((group) => !isGroupLockedForEditor(group, resource));
}

/**
 * Upstream `doFindGroup` without modal/auxiliary parts and `revealIfOpen`: unspecified and side targets
 * avoid locked groups; when every candidate is locked, a new group opens to the right of the active one.
 * Does not activate the result: opening decides that.
 */
export function findGroup(
    groups: IEditorGroupsService,
    resource: Uri | undefined,
    preferred: PreferredGroup,
): EditorGroup {
    const found = peekGroup(groups, resource, preferred);
    if (found !== undefined) return found;
    const active = groups.activeGroup;
    // No neighbor at all: `sideGroup` creates it (and logs when it does not fit).
    if (preferred === "beside" && groups.groups.at(groups.groups.indexOf(active) + 1) === undefined) {
        return groups.sideGroup();
    }
    return groups.addGroup(active, "after") ?? active;
}
