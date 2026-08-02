import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

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
