import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import { DefinitionServiceDIToken } from "./definitionService.ts";

/**
 * Прыжок к определению символа под кареткой (`editor.action.revealDefinition`).
 * Дефолтный кейбинд — F12 при фокусе редактора, как в VS Code. Цели отдают
 * definition-провайдеры расширений через `EditorService.definitionSource`.
 */
export const revealDefinitionAction: CommandAction = {
    id: "editor.action.revealDefinition",
    title: "Go to Definition",
    keybinding: parseKeybinding("f12"),
    when: "textInputFocus",
    run(accessor) {
        void accessor.get(DefinitionServiceDIToken).revealDefinition();
    },
};

/** То же, но цель открывается в соседней группе (VS Code `Ctrl+K F12`). */
export const revealDefinitionAsideAction: CommandAction = {
    id: "editor.action.revealDefinitionAside",
    title: "Go to Definition to the Side",
    keybinding: parseChord("ctrl+k f12"),
    when: "textInputFocus",
    run(accessor) {
        void accessor.get(DefinitionServiceDIToken).revealDefinition({ toSide: true });
    },
};
