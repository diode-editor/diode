import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { EditorServiceDIToken } from "../../services/editor/common/editorService.ts";

/**
 * Lists and trees need no separate command: for them the engine synthesizes Shift+F10
 * ("contextmenu"), and this binding intercepts it only when focus is in text.
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
