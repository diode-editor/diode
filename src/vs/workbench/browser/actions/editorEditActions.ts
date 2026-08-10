import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import { parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { EditorServiceDIToken } from "../../services/editor/browser/editorService.ts";

// ─── Delete ─────────────────────────────────────────────────

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

export const deleteWordLeftAction: CommandAction = {
    id: "deleteWordLeft",
    title: "Delete Word Left",
    keybinding: parseKeybinding("ctrl+backspace"),
    when: "textInputFocus && !editorReadonly",
    run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (editor) {
            editor.pushUndo(editor.viewState.deleteWordLeft());
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

// ─── Undo / Redo ────────────────────────────────────────────

export const undoAction: CommandAction = {
    id: "undo",
    title: "Undo",
    keybinding: parseKeybinding("ctrl+z"),
    when: "textInputFocus && !editorReadonly",
    menus: [
        { menuId: MenuId.EditorContext, group: "2_undo", order: 10 },
        { menuId: MenuId.MenubarEditMenu, group: "1_undo", order: 10 },
    ],
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveEditor()?.undo();
    },
};

export const redoAction: CommandAction = {
    id: "redo",
    title: "Redo",
    keybinding: parseKeybinding("ctrl+shift+z"),
    when: "textInputFocus && !editorReadonly",
    menus: [{ menuId: MenuId.MenubarEditMenu, group: "1_undo", order: 20 }],
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveEditor()?.redo();
    },
};

// ─── Indentation ────────────────────────────────────────────

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

// ─── Selection ──────────────────────────────────────────────

export const selectAllAction: CommandAction = {
    id: "editor.action.selectAll",
    title: "Select All",
    keybinding: parseKeybinding("ctrl+a"),
    // Единственная команда в этом файле без гейта `!editorReadonly`: выделение
    // ничего не меняет. Отсюда и `textViewFocus` — Ctrl+A + Ctrl+C на диффе
    // копирует его целиком.
    when: "textViewFocus",
    menus: [{ menuId: MenuId.MenubarSelectionMenu, group: "1_select", order: 10 }],
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.selectAll();
    },
};
