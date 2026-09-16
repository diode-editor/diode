import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import { parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { EditorServiceDIToken } from "../../services/editor/browser/editorService.ts";

// ─── Line operations ────────────────────────────────────────
//
// Строчные операции VS Code (`editor/contrib/linesOperations`): дублирование,
// перемещение и удаление строк. Бинды — линуксовый канон VS Code: копирование
// строк — `ctrl+shift+alt+↑/↓`, потому что `shift+alt+↑/↓` (дефолт Windows/mac)
// на Linux — и у нас — занят мультикурсором (см. multiCursorActions.ts).

export const copyLinesUpAction: CommandAction = {
    id: "editor.action.copyLinesUpAction",
    title: "Copy Line Up",
    keybinding: parseKeybinding("ctrl+shift+alt+up"),
    when: "textInputFocus && !editorReadonly",
    menus: [{ menuId: MenuId.MenubarSelectionMenu, group: "2_line", order: 10 }],
    run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (editor) {
            editor.pushUndo(editor.viewState.copyLinesUp());
        }
    },
};

export const copyLinesDownAction: CommandAction = {
    id: "editor.action.copyLinesDownAction",
    title: "Copy Line Down",
    keybinding: parseKeybinding("ctrl+shift+alt+down"),
    when: "textInputFocus && !editorReadonly",
    menus: [{ menuId: MenuId.MenubarSelectionMenu, group: "2_line", order: 20 }],
    run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (editor) {
            editor.pushUndo(editor.viewState.copyLinesDown());
        }
    },
};

export const moveLinesUpAction: CommandAction = {
    id: "editor.action.moveLinesUpAction",
    title: "Move Line Up",
    keybinding: parseKeybinding("alt+up"),
    when: "textInputFocus && !editorReadonly",
    menus: [{ menuId: MenuId.MenubarSelectionMenu, group: "2_line", order: 30 }],
    run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (editor) {
            editor.pushUndo(editor.viewState.moveLinesUp());
        }
    },
};

export const moveLinesDownAction: CommandAction = {
    id: "editor.action.moveLinesDownAction",
    title: "Move Line Down",
    keybinding: parseKeybinding("alt+down"),
    when: "textInputFocus && !editorReadonly",
    menus: [{ menuId: MenuId.MenubarSelectionMenu, group: "2_line", order: 40 }],
    run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (editor) {
            editor.pushUndo(editor.viewState.moveLinesDown());
        }
    },
};

export const duplicateSelectionAction: CommandAction = {
    id: "editor.action.duplicateSelection",
    title: "Duplicate Selection",
    // Без дефолтного бинда — как в VS Code.
    when: "textInputFocus && !editorReadonly",
    menus: [{ menuId: MenuId.MenubarSelectionMenu, group: "2_line", order: 50 }],
    run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (editor) {
            editor.pushUndo(editor.viewState.duplicateSelection());
        }
    },
};

export const deleteLinesAction: CommandAction = {
    id: "editor.action.deleteLines",
    title: "Delete Line",
    keybinding: parseKeybinding("ctrl+shift+k"),
    when: "textInputFocus && !editorReadonly",
    run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (editor) {
            editor.pushUndo(editor.viewState.deleteLines());
        }
    },
};
