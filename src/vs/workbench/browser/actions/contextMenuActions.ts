import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { EditorServiceDIToken } from "../../services/editor/browser/editorService.ts";

/**
 * Открывает контекстное меню редактора с клавиатуры (Shift+F10, как в VS Code),
 * заякорив его на каретке. Тот же набор пунктов, что и по правому клику.
 * Спискам/деревьям отдельная команда не нужна: Shift+F10 для них синтезирует
 * движок (событие "contextmenu"), а этот бинд перехватывает его раньше только
 * при фокусе в тексте (`when: textInputFocus`).
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
