import type { EditorGroup } from "../../services/editor/browser/editorGroupModel.ts";
import type { IEditorGroupsService } from "../../services/editor/common/editorGroupsService.ts";

export interface TabTarget {
    readonly group: EditorGroup;
    readonly index: number;
}

/** Пара чисел `(groupId, index)`. */
function hasTabAddress(args: readonly unknown[]): boolean {
    return typeof args[0] === "number" && typeof args[1] === "number";
}

/** `null`, если адреса нет или вкладку успели закрыть. */
export function resolveAddressedTab(groups: IEditorGroupsService, args: readonly unknown[]): TabTarget | null {
    // Stryker disable next-line ConditionalExpression: проверка избыточна — ниже и поиск группы по id, и getPane отсеивают неадресные аргументы, возвращая тот же null
    if (!hasTabAddress(args)) return null;
    const [groupId, index] = args as [number, number];
    const group = groups.groups.find((candidate) => candidate.id === groupId);
    if (group?.getPane(index) == null) return null;
    return { group, index };
}

/**
 * Протухший адрес НЕ откатывается на активную вкладку: команда меню обязана
 * сделать то, что в нём написано, либо ничего.
 */
export function resolveTabTarget(groups: IEditorGroupsService, args: readonly unknown[]): TabTarget | null {
    if (hasTabAddress(args)) return resolveAddressedTab(groups, args);
    const group = groups.activeGroup;
    if (group.activeIndex < 0) return null;
    return { group, index: group.activeIndex };
}
