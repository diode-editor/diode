import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";

import { FindServiceDIToken } from "./findService.ts";

/** Weaker than popups over the text: inline, suggest, hover, parameter hints (upstream: EditorContrib + 5). */
const FIND_WEIGHT = KeybindingWeight.EditorContrib;

export const findAction: CommandAction = {
    id: "actions.find",
    title: "Find",
    menus: [{ menuId: MenuId.MenubarEditMenu, group: "3_find", order: 10 }],
    keybinding: parseKeybinding("mod+f"),
    when: "textInputFocus || findWidgetVisible",
    run(accessor) {
        accessor.get(FindServiceDIToken).open();
    },
};

export const nextMatchAction: CommandAction = {
    id: "editor.action.nextMatchFindAction",
    weight: FIND_WEIGHT,
    title: "Find: Next Match",
    shortTitle: "Find Next",
    menus: [{ menuId: MenuId.MenubarEditMenu, group: "3_find", order: 20 }],
    // F3 keys off text focus, like upstream's `EditorContextKeys.focus`: search
    // continues with the last query even with the widget closed. Enter stays
    // bound to the open widget; in the text it inserts a newline.
    keybindings: [
        { keys: parseKeybinding("enter"), when: "findWidgetVisible" },
        { keys: parseKeybinding("f3"), when: "textInputFocus || findWidgetVisible" },
    ],
    run(accessor) {
        accessor.get(FindServiceDIToken).next();
    },
};

export const previousMatchAction: CommandAction = {
    id: "editor.action.previousMatchFindAction",
    title: "Find: Previous Match",
    shortTitle: "Find Previous",
    menus: [{ menuId: MenuId.MenubarEditMenu, group: "3_find", order: 30 }],
    keybindings: [
        { keys: parseKeybinding("shift+enter"), when: "findWidgetVisible" },
        { keys: parseKeybinding("shift+f3"), when: "textInputFocus || findWidgetVisible" },
    ],
    run(accessor) {
        accessor.get(FindServiceDIToken).prev();
    },
};

export const closeFindWidgetAction: CommandAction = {
    id: "closeFindWidget",
    weight: FIND_WEIGHT,
    title: "Find: Close",
    keybinding: parseKeybinding("escape"),
    when: "findWidgetVisible",
    run(accessor) {
        accessor.get(FindServiceDIToken).close();
    },
};

export const FIND_ACTIONS: readonly CommandAction[] = [
    findAction,
    nextMatchAction,
    previousMatchAction,
    closeFindWidgetAction,
];
