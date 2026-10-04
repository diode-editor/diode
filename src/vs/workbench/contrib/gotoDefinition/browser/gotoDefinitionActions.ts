import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import { DefinitionServiceDIToken } from "./definitionService.ts";

/**
 * Прыжок к определению символа под кареткой (`editor.action.revealDefinition`).
 * Дефолтный кейбинд — F12 при фокусе редактора, как в VS Code. Цели отдают
 * definition-провайдеры реестра `ILanguageFeaturesService.definitionProvider`.
 */
export const revealDefinitionAction: CommandAction = {
    id: "editor.action.revealDefinition",
    title: "Go to Definition",
    keybinding: parseKeybinding("f12"),
    when: "textInputFocus",
    // Группа и порядок — дословно upstream (`goToCommands.ts`): пункт виден
    // только там, где определение кто-то отдаёт.
    menus: [
        {
            menuId: MenuId.EditorContext,
            group: "navigation",
            order: 1.1,
            when: "editorHasDefinitionProvider",
        },
    ],
    run(accessor) {
        return accessor.get(DefinitionServiceDIToken).revealDefinition();
    },
};

/** То же, но цель открывается в соседней группе (VS Code `Ctrl+K F12`). */
export const revealDefinitionAsideAction: CommandAction = {
    id: "editor.action.revealDefinitionAside",
    title: "Go to Definition to the Side",
    keybinding: parseChord("mod+k f12"),
    when: "textInputFocus",
    run(accessor) {
        return accessor.get(DefinitionServiceDIToken).revealDefinition({ toSide: true });
    },
};

/** Экшены перехода к определению. Фича отдаёт их одним массивом; регистрирует агрегатор (`WORKBENCH_ACTIONS`). */
export const GOTO_DEFINITION_ACTIONS: readonly CommandAction[] = [revealDefinitionAction, revealDefinitionAsideAction];
