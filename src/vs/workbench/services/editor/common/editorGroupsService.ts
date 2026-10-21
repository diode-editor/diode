import type { Event } from "../../../../base/common/event.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import type { EditorGroup, GroupId, MruCycleState } from "../browser/editorGroupModel.ts";

export interface IGroupsChangeEvent {
    readonly kind: "added" | "removed" | "moved";
    readonly group: EditorGroup;
    /** Для added/moved — новая. */
    readonly index: number;
    /** View-слой делит её долю пополам. */
    readonly source?: EditorGroup;
}

/**
 * Аналог `IEditorGroupsService`. Порядок событий — контракт: {@link onDidChangeEditors} →
 * фокус → {@link onDidChangeActivePane} → {@link onDidActiveGroupChange}.
 */
export interface IEditorGroupsService {
    /** Индекс — ViewColumn − 1. */
    readonly groups: readonly EditorGroup[];
    readonly activeGroup: EditorGroup;
    /** Detached-панели групп не имеют. */
    groupOf(pane: IEditorPane): EditorGroup | null;
    /** 1..N, производный от позиции в полосе. */
    viewColumnOf(group: EditorGroup): number;

    readonly onDidActiveGroupChange: Event<EditorGroup>;
    /** Серия Ctrl+Tab любой группы; `null` — конец серии. */
    readonly onDidChangeMruCycle: Event<MruCycleState | null>;
    readonly onDidGroupsChange: Event<IGroupsChangeEvent>;
    readonly onDidChangeEditors: Event<void>;
    readonly onDidChangeActivePane: Event<IEditorPane | null>;

    /** Не задан — место не проверяется. */
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
    /** Только события. */
    notifyGroupFocused(group: EditorGroup): void;
    /** У единственной группы — в новую. */
    moveActiveEditorToGroup(direction: "next" | "previous", options?: { focus?: boolean }): void;
    openInNeighborGroup(direction: "next" | "previous", fill: (group: EditorGroup) => void): void;
    /** Группа становится активной до наполнения `fill`, событие смены — после. */
    openInGroup(group: EditorGroup, fill: () => void): void;
    sideGroup(): EditorGroup;
    joinTwoGroups(): void;
    joinAllGroups(): void;
    moveActiveGroup(direction: "next" | "previous"): void;
    /** Активная группа первой, MRU. */
    getOpenEditorsMru(): IEditorPane[];
    revealPane(pane: IEditorPane): void;
    /** В визуальном порядке всей полосы. */
    cycleEditor(direction: 1 | -1): void;
}

export const EditorGroupsServiceDIToken = token<IEditorGroupsService>("EditorGroupsService");
