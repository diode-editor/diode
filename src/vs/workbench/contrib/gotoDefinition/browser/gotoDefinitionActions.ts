import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import { DefinitionServiceDIToken } from "./definitionService.ts";

export const revealDefinitionAction: CommandAction = {
    id: "editor.action.revealDefinition",
    title: "Go to Definition",
    keybinding: parseKeybinding("f12"),
    when: "textInputFocus",
    enablement: "editorHasDefinitionProvider",
    // Group and order are copied from upstream (`goToCommands.ts`): the item is visible
    // only where someone provides a definition.
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

export const revealDefinitionAsideAction: CommandAction = {
    id: "editor.action.revealDefinitionAside",
    title: "Open Definition to the Side",
    keybinding: parseChord("mod+k f12"),
    when: "textInputFocus",
    enablement: "editorHasDefinitionProvider",
    run(accessor) {
        return accessor.get(DefinitionServiceDIToken).revealDefinition({ toSide: true });
    },
};

export const GOTO_DEFINITION_ACTIONS: readonly CommandAction[] = [revealDefinitionAction, revealDefinitionAsideAction];
