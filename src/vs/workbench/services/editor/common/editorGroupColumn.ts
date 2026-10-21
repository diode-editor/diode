import type { EditorGroup } from "../browser/editorGroupModel.ts";

import type { IEditorGroupsService } from "./editorGroupsService.ts";

/** `ACTIVE_GROUP` эталона — он же `vscode.ViewColumn.Active`: текущая колонка. */
export const ACTIVE_GROUP = -1;
/** `SIDE_GROUP` эталона — он же `vscode.ViewColumn.Beside`: колонка справа от активной. */
export const SIDE_GROUP = -2;

/**
 * `columnToEditorGroup` эталона. За краем полосы — догоняющее создание хвостовых групп
 * (AS-5; не влезло — последняя).
 */
export function columnToEditorGroup(groups: IEditorGroupsService, column: number): EditorGroup {
    if (column === ACTIVE_GROUP) return groups.activeGroup;
    if (column === SIDE_GROUP) {
        const index = groups.groups.indexOf(groups.activeGroup);
        return (
            groups.groups.at(index + 1) ??
            // Любая позиция, кроме "before", — справа: пустая строка ведёт себя как "after".
            // Stryker disable next-line StringLiteral: эквивалентен — см. выше
            groups.newGroup("after", { focus: false }) ??
            groups.activeGroup
        );
    }
    const wanted = Math.max(1, Math.floor(column));
    while (groups.groups.length < wanted) {
        const before = groups.groups.length;
        groups.focusGroup({ index: before - 1 }, { focus: false });
        // Stryker disable next-line StringLiteral: позиция "" ведёт себя как "after" — эквивалентен
        if (groups.newGroup("after", { focus: false }) === null) break; // не влезло — фолбэк в край
        /* v8 ignore start -- защитный выход от зацикливания при неожиданном no-op */
        // Stryker disable next-line ConditionalExpression,EqualityOperator: защитный выход — недостижим по той же причине
        if (groups.groups.length === before) break;
        /* v8 ignore stop */
    }
    return groups.groups[Math.min(wanted, groups.groups.length) - 1];
}
