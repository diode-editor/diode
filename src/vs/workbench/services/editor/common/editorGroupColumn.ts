import type { Uri } from "../../../../base/common/uri.ts";
import type { EditorGroup } from "../browser/editorGroupModel.ts";

import { findGroup, isGroupLockedForEditor } from "./editorGroupFinder.ts";
import type { IEditorGroupsService } from "./editorGroupsService.ts";

/** Upstream `ACTIVE_GROUP`, i.e. `vscode.ViewColumn.Active`: the current column. */
export const ACTIVE_GROUP = -1;
/** Upstream `SIDE_GROUP`, i.e. `vscode.ViewColumn.Beside`: the column right of the active one. */
export const SIDE_GROUP = -2;

/**
 * Upstream `columnToEditorGroup` + `findGroup`. A column past the end of the strip creates trailing groups
 * up to it (AS-5; if they don't fit, the last group). Active and side targets avoid a group locked for
 * `resource`; an explicit column is honored even when locked.
 */
export function columnToEditorGroup(groups: IEditorGroupsService, column: number, resource?: Uri): EditorGroup {
    if (column === ACTIVE_GROUP) return findGroup(groups, resource, undefined);
    if (column === SIDE_GROUP) {
        const index = groups.groups.indexOf(groups.activeGroup);
        const neighbor = groups.groups.at(index + 1);
        if (neighbor !== undefined && !isGroupLockedForEditor(neighbor, resource)) return neighbor;
        return (
            // A locked neighbor: the new group goes between, as upstream `addGroup(activeGroup, right)`.
            // Any position other than "before" means right: an empty string acts as "after".
            // Stryker disable next-line StringLiteral: equivalent, see above
            groups.newGroup("after", { focus: false }) ?? neighbor ?? groups.activeGroup
        );
    }
    const wanted = Math.max(1, Math.floor(column));
    while (groups.groups.length < wanted) {
        const before = groups.groups.length;
        groups.focusGroup({ index: before - 1 }, { focus: false });
        // Stryker disable next-line StringLiteral: position "" acts as "after", equivalent
        if (groups.newGroup("after", { focus: false }) === null) break; // doesn't fit: fall back to the edge
        /* v8 ignore start -- guard against looping on an unexpected no-op */
        // Stryker disable next-line ConditionalExpression,EqualityOperator: guard exit, unreachable for the same reason
        if (groups.groups.length === before) break;
        /* v8 ignore stop */
    }
    return groups.groups[Math.min(wanted, groups.groups.length) - 1];
}
