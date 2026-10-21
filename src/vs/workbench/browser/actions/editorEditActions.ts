import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import { parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { EditorServiceDIToken } from "../../services/editor/common/editorService.ts";

export const deleteLeftAction: CommandAction = {
    id: "deleteLeft",
    title: "Delete Left",
    keybinding: parseKeybinding("backspace"),
    when: "textInputFocus && !editorReadonly",
    run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (editor) {
            editor.pushUndo(editor.viewState.deleteLeft());
        }
    },
};

export const deleteRightAction: CommandAction = {
    id: "deleteRight",
    title: "Delete Right",
    keybinding: parseKeybinding("delete"),
    when: "textInputFocus && !editorReadonly",
    run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (editor) {
            editor.pushUndo(editor.viewState.deleteRight());
        }
    },
};

// Ctrl+Backspace в legacy-потоке — байт 0x08 (Ctrl+H): бинд под tier-гейтом, а
// досягаемый путь — Alt+Backspace. Он же канонический на маке — потому здесь, а не в мак-дельтах.
export const deleteWordLeftAction: CommandAction = {
    id: "deleteWordLeft",
    title: "Delete Word Left",
    keybinding: parseKeybinding("alt+backspace"),
    keybindings: [{ keys: parseKeybinding("ctrl+backspace"), when: "tier != 'legacy'" }],
    when: "textInputFocus && !editorReadonly",
    run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (editor) {
            editor.pushUndo(editor.viewState.deleteWordLeft());
        }
    },
};

/** На маке Cmd+Backspace — бинд в таблице мак-дельт. */
export const deleteAllLeftAction: CommandAction = {
    id: "deleteAllLeft",
    title: "Delete All Left",
    when: "textInputFocus && !editorReadonly",
    run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (editor) {
            editor.pushUndo(editor.viewState.deleteAllLeft());
        }
    },
};

export const deleteWordRightAction: CommandAction = {
    id: "deleteWordRight",
    title: "Delete Word Right",
    keybinding: parseKeybinding("ctrl+delete"),
    when: "textInputFocus && !editorReadonly",
    run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (editor) {
            editor.pushUndo(editor.viewState.deleteWordRight());
        }
    },
};

export const undoAction: CommandAction = {
    id: "undo",
    title: "Undo",
    keybinding: parseKeybinding("mod+z"),
    when: "textInputFocus && !editorReadonly",
    // Undo в контекст-меню нет: состав EditorContext — дословно upstream'ский.
    menus: [{ menuId: MenuId.MenubarEditMenu, group: "1_undo", order: 10 }],
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveEditor()?.undo();
    },
};

export const redoAction: CommandAction = {
    id: "redo",
    title: "Redo",
    keybinding: parseKeybinding("mod+shift+z"),
    // На маке ниже cmd это единственная доставляемая комбинация redo.
    keybindings: [parseKeybinding("ctrl+y")],
    when: "textInputFocus && !editorReadonly",
    menus: [{ menuId: MenuId.MenubarEditMenu, group: "1_undo", order: 20 }],
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveEditor()?.redo();
    },
};

export const indentLinesAction: CommandAction = {
    id: "editor.action.indentLines",
    title: "Indent Line(s)",
    keybinding: parseKeybinding("tab"),
    when: "textInputFocus && !editorReadonly",
    run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (editor) {
            editor.pushUndo(editor.viewState.indentLines());
        }
    },
};

export const outdentLinesAction: CommandAction = {
    id: "editor.action.outdentLines",
    title: "Outdent Line(s)",
    keybinding: parseKeybinding("shift+tab"),
    when: "textInputFocus && !editorReadonly",
    run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (editor) {
            editor.pushUndo(editor.viewState.outdentLines());
        }
    },
};

export const selectAllAction: CommandAction = {
    id: "editor.action.selectAll",
    title: "Select All",
    keybinding: parseKeybinding("mod+a"),
    // Без гейта `!editorReadonly` и шире фокус: Ctrl+A + Ctrl+C на диффе копирует его целиком.
    when: "textViewFocus",
    menus: [{ menuId: MenuId.MenubarSelectionMenu, group: "1_select", order: 10 }],
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.selectAll();
    },
};
