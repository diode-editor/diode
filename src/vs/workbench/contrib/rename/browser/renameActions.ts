import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import { RenameServiceDIToken } from "./renameService.ts";

/** F2 досягаема на любом терминале — второй, аккордный путь команде не нужен. */
export const renameSymbolAction: CommandAction = {
    id: "editor.action.rename",
    title: "Rename Symbol",
    keybinding: parseKeybinding("f2"),
    when: "textInputFocus && !editorReadonly",
    // Дословно upstream (`rename.ts`): без rename-провайдера меню обещало бы нерабочее.
    menus: [{ menuId: MenuId.EditorContext, group: "1_modification", order: 1.1, when: "editorHasRenameProvider" }],
    run(accessor) {
        return accessor.get(RenameServiceDIToken).rename();
    },
};

export const RENAME_ACTIONS: readonly CommandAction[] = [renameSymbolAction];
