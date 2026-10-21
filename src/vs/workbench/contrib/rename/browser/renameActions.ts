import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import { RenameServiceDIToken } from "./renameService.ts";

/** F2 is reachable on any terminal, so the command needs no second chord path. */
export const renameSymbolAction: CommandAction = {
    id: "editor.action.rename",
    title: "Rename Symbol",
    keybinding: parseKeybinding("f2"),
    when: "textInputFocus && !editorReadonly",
    // Verbatim upstream (`rename.ts`): without a rename provider the menu would promise something broken.
    menus: [{ menuId: MenuId.EditorContext, group: "1_modification", order: 1.1, when: "editorHasRenameProvider" }],
    run(accessor) {
        return accessor.get(RenameServiceDIToken).rename();
    },
};

export const RENAME_ACTIONS: readonly CommandAction[] = [renameSymbolAction];
