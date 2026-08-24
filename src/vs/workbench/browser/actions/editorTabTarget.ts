import type { EditorGroup } from "../../services/editor/browser/editorGroupModel.ts";
import type { EditorService } from "../../services/editor/browser/editorService.ts";

/** Вкладка, по которой работает команда: адрес из меню либо активная вкладка. */
export interface TabTarget {
    readonly group: EditorGroup;
    readonly index: number;
}

/** Несут ли аргументы команды адрес вкладки (пара чисел `(groupId, index)`). */
function hasTabAddress(args: readonly unknown[]): boolean {
    return typeof args[0] === "number" && typeof args[1] === "number";
}

/**
 * Явный адрес вкладки в аргументах команды — так контекст-меню таба указывает
 * на вкладку ПОД КУРСОРОМ (правый клик активную вкладку не меняет, см.
 * `editorTabTargetArg`). `null`, если адреса нет или он больше не существует
 * (вызов с клавиатуры/из палитры либо вкладку успели закрыть).
 */
export function resolveAddressedTab(service: EditorService, args: readonly unknown[]): TabTarget | null {
    // Stryker disable next-line ConditionalExpression: проверка избыточна — ниже и поиск группы по id, и getPane отсеивают неадресные аргументы, возвращая тот же null
    if (!hasTabAddress(args)) return null;
    const [groupId, index] = args as [number, number];
    const group = service.groups.find((candidate) => candidate.id === groupId);
    if (group === undefined || group.getPane(index) === null) return null;
    return { group, index };
}

/**
 * Цель «вкладочной» команды: явный адрес из меню, иначе — активная вкладка
 * активной группы (вызов с клавиатуры или из палитры). Протухший адрес НЕ
 * откатывается на активную вкладку: команда меню обязана либо сделать то, что
 * в нём написано, либо ничего.
 */
export function resolveTabTarget(service: EditorService, args: readonly unknown[]): TabTarget | null {
    if (hasTabAddress(args)) return resolveAddressedTab(service, args);
    const group = service.activeGroup;
    if (group.activeIndex < 0) return null;
    return { group, index: group.activeIndex };
}
