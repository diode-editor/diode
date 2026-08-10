import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import { parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { ClipboardDIToken } from "../../common/coreTokens.ts";
import { EditorServiceDIToken } from "../../services/editor/browser/editorService.ts";

export const clipboardCopyAction: CommandAction = {
    id: "editor.action.clipboardCopyAction",
    title: "Copy",
    keybinding: parseKeybinding("ctrl+c"),
    // Шире, чем у Cut/Paste: копировать можно и из read-only диффа.
    when: "textViewFocus",
    menus: [
        { menuId: MenuId.EditorContext, group: "1_clipboard", order: 10 },
        { menuId: MenuId.MenubarEditMenu, group: "2_clipboard", order: 20 },
    ],
    async run(accessor) {
        // Через панель, а не через viewState: что считать выделенным, решает
        // она (дифф выбрасывает строки-плейсхолдеры свёрнутых кусков).
        const text = accessor.get(EditorServiceDIToken).getActivePane()?.getSelectedText() ?? "";
        if (text !== "") {
            await accessor.get(ClipboardDIToken).writeText(text);
        }
    },
};

export const clipboardCutAction: CommandAction = {
    id: "editor.action.clipboardCutAction",
    title: "Cut",
    keybinding: parseKeybinding("ctrl+x"),
    when: "textInputFocus && !editorReadonly",
    menus: [
        { menuId: MenuId.EditorContext, group: "1_clipboard", order: 20 },
        { menuId: MenuId.MenubarEditMenu, group: "2_clipboard", order: 10 },
    ],
    async run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (!editor) return;
        const text = editor.viewState.getSelectedText();
        if (text === "") return;
        await accessor.get(ClipboardDIToken).writeText(text);
        const undo = editor.viewState.deleteLeft();
        if (undo) {
            editor.pushUndo(undo);
        }
    },
};

export const clipboardPasteAction: CommandAction = {
    id: "editor.action.clipboardPasteAction",
    title: "Paste",
    keybinding: parseKeybinding("ctrl+v"),
    when: "textInputFocus && !editorReadonly",
    menus: [
        { menuId: MenuId.EditorContext, group: "1_clipboard", order: 30 },
        { menuId: MenuId.MenubarEditMenu, group: "2_clipboard", order: 30 },
    ],
    async run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (!editor) return;
        const text = await accessor.get(ClipboardDIToken).readText();
        if (text !== "") {
            editor.pushUndo(editor.viewState.insertText(text));
        }
    },
};
