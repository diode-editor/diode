import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import { parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { EditorServiceDIToken } from "../../services/editor/browser/editorService.ts";

/**
 * Мультикурсор: команды, создающие и снимающие каретки.
 *
 * Все они только двигают выделения, поэтому гейт — `textViewFocus` без `!editorReadonly`:
 * в VS Code мультикурсор работает и в режиме «только чтение» (искать и копировать по
 * нескольким местам полезно и там).
 *
 * Про бинды. `ctrl+alt+↑/↓` — канон VS Code на Windows/Linux; парой к нему идёт
 * `shift+alt+↑/↓` (дефолт VS Code на Linux, где `ctrl+alt+стрелка` часто забирает себе
 * оконный менеджер) — заодно это запасной путь на терминалах, которые не различают
 * `ctrl+alt` со стрелкой.
 */

export const insertCursorAboveAction: CommandAction = {
    id: "editor.action.insertCursorAbove",
    title: "Add Cursor Above",
    keybinding: parseKeybinding("ctrl+alt+up"),
    keybindings: [parseKeybinding("shift+alt+up")],
    when: "textViewFocus",
    menus: [{ menuId: MenuId.MenubarSelectionMenu, group: "3_multi", order: 10 }],
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.insertCursorAbove();
    },
};

export const insertCursorBelowAction: CommandAction = {
    id: "editor.action.insertCursorBelow",
    title: "Add Cursor Below",
    keybinding: parseKeybinding("ctrl+alt+down"),
    keybindings: [parseKeybinding("shift+alt+down")],
    when: "textViewFocus",
    menus: [{ menuId: MenuId.MenubarSelectionMenu, group: "3_multi", order: 20 }],
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.insertCursorBelow();
    },
};

export const removeSecondaryCursorsAction: CommandAction = {
    id: "removeSecondaryCursors",
    title: "Remove Secondary Cursors",
    keybinding: parseKeybinding("escape"),
    // Гейт по числу кареток обязателен: иначе Escape залипал бы на редакторе и не доходил
    // до тех, кому он нужнее (find-виджет, попап автодополнения).
    when: "textViewFocus && editorHasMultipleSelections",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.removeSecondaryCursors();
    },
};

/** Порядок — как в меню Selection; регистрируется единым куском в `builtinActions.ts`. */
export const MULTI_CURSOR_ACTIONS: readonly CommandAction[] = [
    insertCursorAboveAction,
    insertCursorBelowAction,
    removeSecondaryCursorsAction,
];
