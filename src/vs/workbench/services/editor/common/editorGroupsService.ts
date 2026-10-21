import type { Event } from "../../../../base/common/event.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import type { EditorGroup, GroupId, MruCycleState } from "../browser/editorGroupModel.ts";

export interface IGroupsChangeEvent {
    readonly kind: "added" | "removed" | "moved";
    readonly group: EditorGroup;
    /** For added/moved, the new index. */
    readonly index: number;
    /** The view layer splits its share in half. */
    readonly source?: EditorGroup;
}

/**
 * Counterpart of `IEditorGroupsService`. Event order is a contract: {@link onDidChangeEditors} →
 * focus → {@link onDidChangeActivePane} → {@link onDidActiveGroupChange}.
 */
export interface IEditorGroupsService {
    /** Index is ViewColumn − 1. */
    readonly groups: readonly EditorGroup[];
    readonly activeGroup: EditorGroup;
    /** Detached panes have no group. */
    groupOf(pane: IEditorPane): EditorGroup | null;
    /** 1..N, derived from the position in the strip. */
    viewColumnOf(group: EditorGroup): number;

    readonly onDidActiveGroupChange: Event<EditorGroup>;
    /** Ctrl+Tab series of any group; `null` ends the series. */
    readonly onDidChangeMruCycle: Event<MruCycleState | null>;
    readonly onDidGroupsChange: Event<IGroupsChangeEvent>;
    readonly onDidChangeEditors: Event<void>;
    readonly onDidChangeActivePane: Event<IEditorPane | null>;

    /** Unset: available space is not checked. */
    canAddGroupHook?: () => boolean;
    focusGroupContentHook?: (group: EditorGroup) => void;

    splitActiveGroup(
        fill: (group: EditorGroup, source: IEditorPane) => void,
        options?: { focus?: boolean; position?: "before" | "after" },
    ): EditorGroup | null;
    newGroup(position: "before" | "after", options?: { focus?: boolean }): EditorGroup | null;
    focusGroup(
        target: GroupId | { index: number } | { direction: "next" | "previous" | "cycle" },
        options?: { focus?: boolean },
    ): void;
    /** Fires events only. */
    notifyGroupFocused(group: EditorGroup): void;
    /** With a single group, moves into a new one. */
    moveActiveEditorToGroup(direction: "next" | "previous", options?: { focus?: boolean }): void;
    openInNeighborGroup(direction: "next" | "previous", fill: (group: EditorGroup) => void): void;
    /** The group becomes active before `fill` runs; the change event fires after. */
    openInGroup(group: EditorGroup, fill: () => void): void;
    sideGroup(): EditorGroup;
    joinTwoGroups(): void;
    joinAllGroups(): void;
    moveActiveGroup(direction: "next" | "previous"): void;
    /** Active group first, MRU order. */
    getOpenEditorsMru(): IEditorPane[];
    revealPane(pane: IEditorPane): void;
    /** In visual order across the whole strip. */
    cycleEditor(direction: 1 | -1): void;
}

export const EditorGroupsServiceDIToken = token<IEditorGroupsService>("EditorGroupsService");
