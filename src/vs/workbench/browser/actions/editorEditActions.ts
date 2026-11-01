import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import type { ServiceAccessor } from "../../../platform/instantiation/common/diContainer.ts";
import { parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { EditorServiceDIToken } from "../../services/editor/common/editorService.ts";

function typeIntoFocusedEditor(accessor: ServiceAccessor, args: unknown): void {
    const text = (args as { readonly text?: unknown } | null | undefined)?.text;
    if (typeof text !== "string") return;
    accessor.get(EditorServiceDIToken).getActiveEditor()?.typeText(text);
}

/**
 * Upstream `Handler.Type`: acts on the focused editor only, without a `text` does nothing.
 * Deviation: keys do not go through this command, so overriding it does not intercept typing.
 */
export const typeAction: CommandAction = {
    id: "type",
    title: "Type",
    enablement: "editorTextFocus",
    menus: [{ menuId: MenuId.CommandPalette, when: "false" }],
    run: typeIntoFocusedEditor,
};

/** The original handler, for an extension that overrides `type`. */
export const defaultTypeAction: CommandAction = { ...typeAction, id: "default:type" };

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

// In the legacy stream Ctrl+Backspace is byte 0x08 (Ctrl+H): that binding sits behind a tier gate, and
// the reachable path is Alt+Backspace. It is also canonical on macOS — hence here, not in the mac deltas.
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

/** On macOS Cmd+Backspace is bound in the mac delta table. */
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
    // No Undo in the context menu: the EditorContext set matches upstream verbatim.
    menus: [{ menuId: MenuId.MenubarEditMenu, group: "1_undo", order: 10 }],
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveEditor()?.undo();
    },
};

export const redoAction: CommandAction = {
    id: "redo",
    title: "Redo",
    keybinding: parseKeybinding("mod+shift+z"),
    // On macOS below cmd this is the only redo combination that gets delivered.
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
    // No `!editorReadonly` gate and a wider focus: Ctrl+A + Ctrl+C on a diff copies it whole.
    when: "textViewFocus",
    menus: [{ menuId: MenuId.MenubarSelectionMenu, group: "1_select", order: 10 }],
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.selectAll();
    },
};
