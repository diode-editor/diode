import type { Event } from "../../../../base/common/event.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import type { EditorGroup, GroupId, MruCycleState } from "../browser/editorGroupModel.ts";

/** Событие изменения полосы групп (для view-слоя и host-адаптеров). */
export interface IGroupsChangeEvent {
    readonly kind: "added" | "removed" | "moved";
    readonly group: EditorGroup;
    /** Позиция группы в полосе (для added/moved — новая). */
    readonly index: number;
    /** Группа-источник сплита (view-слой делит её долю пополам). */
    readonly source?: EditorGroup;
}

/**
 * Полоса групп редакторов — аналог upstream `IEditorGroupsService`: группы в
 * порядке ViewColumn, активная группа, сплиты, фокус, перенос и слияние
 * вкладок между группами. Вкладочные операции — у самой группы
 * ({@link EditorGroup}). Реализация — `EditorGroupsService`
 * (`services/editor/browser/editorGroupsService.ts`).
 *
 * Порядок событий — контракт: {@link onDidChangeEditors} → фокус →
 * {@link onDidChangeActivePane} → {@link onDidActiveGroupChange}.
 */
export interface IEditorGroupsService {
    /** Полоса групп в порядке ViewColumn − 1. */
    readonly groups: readonly EditorGroup[];
    /** Активная группа — куда открываются ресурсы и по которой работают команды вкладок. */
    readonly activeGroup: EditorGroup;
    /** Группа, содержащая вкладку, либо `null` (detached-панели групп не имеют). */
    groupOf(pane: IEditorPane): EditorGroup | null;
    /** Номер колонки группы (1..N) — производный от позиции в полосе. */
    viewColumnOf(group: EditorGroup): number;

    /** Смена активной группы (сплит, фокус-команды, клик мышью в другую группу). */
    readonly onDidActiveGroupChange: Event<EditorGroup>;
    /** Жизнь серии Ctrl+Tab любой группы: снимок MRU-списка с позицией, `null` — конец. */
    readonly onDidChangeMruCycle: Event<MruCycleState | null>;
    /** Структурное изменение полосы: группа добавлена/удалена/переставлена. */
    readonly onDidGroupsChange: Event<IGroupsChangeEvent>;
    /** Агрегат `onDidChangeEditors` всех групп: вкладки, метки, активная вкладка. */
    readonly onDidChangeEditors: Event<void>;
    /** Активная вкладка полосы сменилась (любого вида). */
    readonly onDidChangeActivePane: Event<IEditorPane | null>;

    /** Хук view-слоя «влезет ли ещё одна группа»; не задан — место не проверяется. */
    canAddGroupHook?: () => boolean;
    /** Хук view-слоя «сфокусируй содержимое группы» (filler пустой группы). */
    focusGroupContentHook?: (group: EditorGroup) => void;

    /** Сплит: новая группа рядом с активной, наполняемая колбэком `fill`. */
    splitActiveGroup(
        fill: (group: EditorGroup, source: IEditorPane) => void,
        options?: { focus?: boolean; position?: "before" | "after" },
    ): EditorGroup | null;
    /** Пустая группа рядом с активной. */
    newGroup(position: "before" | "after", options?: { focus?: boolean }): EditorGroup | null;
    /** Фокус группы: по id, позиции, соседству или циклом. */
    focusGroup(
        target: GroupId | { index: number } | { direction: "next" | "previous" | "cycle" },
        options?: { focus?: boolean },
    ): void;
    /** Мышь/фокус сделали группу активной — только события. */
    notifyGroupFocused(group: EditorGroup): void;
    /** Перенос активной вкладки в соседнюю группу (у единственной — в новую). */
    moveActiveEditorToGroup(direction: "next" | "previous", options?: { focus?: boolean }): void;
    /** Соседняя группа становится активной и наполняется колбэком `fill`. */
    openInNeighborGroup(direction: "next" | "previous", fill: (group: EditorGroup) => void): void;
    /** Группа становится активной до наполнения `fill`, событие смены — после. */
    openInGroup(group: EditorGroup, fill: () => void): void;
    /** Группа справа от активной для «Open to the Side». */
    sideGroup(): EditorGroup;
    /** Вливает следующую группу в активную. */
    joinTwoGroups(): void;
    /** Сливает все группы в первую. */
    joinAllGroups(): void;
    /** Переставляет активную группу по полосе. */
    moveActiveGroup(direction: "next" | "previous"): void;
    /** Вкладки всех групп для пикера открытых редакторов (активная группа первой, MRU). */
    getOpenEditorsMru(): IEditorPane[];
    /** Показывает уже открытую вкладку: её группа активна, вкладка активна с фокусом. */
    revealPane(pane: IEditorPane): void;
    /** Шаг по вкладкам всей полосы в визуальном порядке (Ctrl+PgDn/PgUp). */
    cycleEditor(direction: 1 | -1): void;
}

export const EditorGroupsServiceDIToken = token<IEditorGroupsService>("EditorGroupsService");
