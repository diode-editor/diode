import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import { SmartSelectServiceDIToken } from "./smartSelectService.ts";

/** Upstream's Mac bindings live in `macKeybindings.ts`. Gated on `textViewFocus`, like multi-cursor: selection edits nothing. */
export const smartSelectExpandAction: CommandAction = {
    id: "editor.action.smartSelect.expand",
    title: "Expand Selection",
    keybinding: parseKeybinding("shift+alt+right"),
    when: "textViewFocus",
    menus: [{ menuId: MenuId.MenubarSelectionMenu, group: "1_select", order: 20 }],
    run(accessor) {
        return accessor.get(SmartSelectServiceDIToken).run(true);
    },
};

export const smartSelectShrinkAction: CommandAction = {
    id: "editor.action.smartSelect.shrink",
    title: "Shrink Selection",
    keybinding: parseKeybinding("shift+alt+left"),
    when: "textViewFocus",
    menus: [{ menuId: MenuId.MenubarSelectionMenu, group: "1_select", order: 30 }],
    run(accessor) {
        return accessor.get(SmartSelectServiceDIToken).run(false);
    },
};

export const SMART_SELECT_ACTIONS: readonly CommandAction[] = [smartSelectExpandAction, smartSelectShrinkAction];
