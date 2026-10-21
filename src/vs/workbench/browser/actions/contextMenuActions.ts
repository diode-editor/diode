import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { EditorServiceDIToken } from "../../services/editor/common/editorService.ts";

/**
 * Спискам и деревьям отдельная команда не нужна: Shift+F10 для них синтезирует
 * движок ("contextmenu"), а этот бинд перехватывает его только при фокусе в тексте.
 */
export const showEditorContextMenuAction: CommandAction = {
    id: "editor.action.showContextMenu",
    title: "Show Editor Context Menu",
    keybinding: parseKeybinding("shift+f10"),
    when: "textInputFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveEditor()?.showContextMenu();
    },
};
