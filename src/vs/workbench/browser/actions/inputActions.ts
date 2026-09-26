import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { ClipboardDIToken } from "../../common/coreTokens.ts";
import { InputWidgetServiceDIToken } from "../../contrib/files/browser/inputWidgetService.ts";

// ─── Cursor Movement ─────────────────────────────────────────

export const inputCursorLeftAction: CommandAction = {
    id: "input.cursorLeft",
    title: "Input: Cursor Left",
    keybinding: parseKeybinding("left"),
    when: "inputWidgetFocus",
    run(accessor) {
        accessor.get(InputWidgetServiceDIToken).cursorLeft();
    },
};

export const inputCursorRightAction: CommandAction = {
    id: "input.cursorRight",
    title: "Input: Cursor Right",
    keybinding: parseKeybinding("right"),
    when: "inputWidgetFocus",
    run(accessor) {
        accessor.get(InputWidgetServiceDIToken).cursorRight();
    },
};

export const inputCursorHomeAction: CommandAction = {
    id: "input.cursorHome",
    title: "Input: Cursor Home",
    keybinding: parseKeybinding("home"),
    when: "inputWidgetFocus",
    run(accessor) {
        accessor.get(InputWidgetServiceDIToken).cursorHome();
    },
};

export const inputCursorEndAction: CommandAction = {
    id: "input.cursorEnd",
    title: "Input: Cursor End",
    keybinding: parseKeybinding("end"),
    when: "inputWidgetFocus",
    run(accessor) {
        accessor.get(InputWidgetServiceDIToken).cursorEnd();
    },
};

export const inputCursorWordLeftAction: CommandAction = {
    id: "input.cursorWordLeft",
    title: "Input: Cursor Word Left",
    keybinding: parseKeybinding("ctrl+left"),
    when: "inputWidgetFocus",
    run(accessor) {
        accessor.get(InputWidgetServiceDIToken).cursorWordLeft();
    },
};

export const inputCursorWordRightAction: CommandAction = {
    id: "input.cursorWordRight",
    title: "Input: Cursor Word Right",
    keybinding: parseKeybinding("ctrl+right"),
    when: "inputWidgetFocus",
    run(accessor) {
        accessor.get(InputWidgetServiceDIToken).cursorWordRight();
    },
};

// ─── Editing ─────────────────────────────────────────────────

export const inputDeleteLeftAction: CommandAction = {
    id: "input.deleteLeft",
    title: "Input: Delete Left",
    keybinding: parseKeybinding("backspace"),
    when: "inputWidgetFocus",
    run(accessor) {
        accessor.get(InputWidgetServiceDIToken).deleteLeft();
    },
};

export const inputDeleteRightAction: CommandAction = {
    id: "input.deleteRight",
    title: "Input: Delete Right",
    keybinding: parseKeybinding("delete"),
    when: "inputWidgetFocus",
    run(accessor) {
        accessor.get(InputWidgetServiceDIToken).deleteRight();
    },
};

export const inputDeleteWordLeftAction: CommandAction = {
    id: "input.deleteWordLeft",
    title: "Input: Delete Word Left",
    keybinding: parseKeybinding("ctrl+backspace"),
    when: "inputWidgetFocus",
    run(accessor) {
        accessor.get(InputWidgetServiceDIToken).deleteWordLeft();
    },
};

export const inputDeleteWordRightAction: CommandAction = {
    id: "input.deleteWordRight",
    title: "Input: Delete Word Right",
    keybinding: parseKeybinding("ctrl+delete"),
    when: "inputWidgetFocus",
    run(accessor) {
        accessor.get(InputWidgetServiceDIToken).deleteWordRight();
    },
};

// ─── Selection ───────────────────────────────────────────────

export const inputSelectLeftAction: CommandAction = {
    id: "input.selectLeft",
    title: "Input: Select Left",
    keybinding: parseKeybinding("shift+left"),
    when: "inputWidgetFocus",
    run(accessor) {
        accessor.get(InputWidgetServiceDIToken).selectLeft();
    },
};

export const inputSelectRightAction: CommandAction = {
    id: "input.selectRight",
    title: "Input: Select Right",
    keybinding: parseKeybinding("shift+right"),
    when: "inputWidgetFocus",
    run(accessor) {
        accessor.get(InputWidgetServiceDIToken).selectRight();
    },
};

export const inputSelectToHomeAction: CommandAction = {
    id: "input.selectToHome",
    title: "Input: Select to Home",
    keybinding: parseKeybinding("shift+home"),
    when: "inputWidgetFocus",
    run(accessor) {
        accessor.get(InputWidgetServiceDIToken).selectToHome();
    },
};

export const inputSelectToEndAction: CommandAction = {
    id: "input.selectToEnd",
    title: "Input: Select to End",
    keybinding: parseKeybinding("shift+end"),
    when: "inputWidgetFocus",
    run(accessor) {
        accessor.get(InputWidgetServiceDIToken).selectToEnd();
    },
};

export const inputSelectWordLeftAction: CommandAction = {
    id: "input.selectWordLeft",
    title: "Input: Select Word Left",
    keybinding: parseKeybinding("ctrl+shift+left"),
    when: "inputWidgetFocus",
    run(accessor) {
        accessor.get(InputWidgetServiceDIToken).selectWordLeft();
    },
};

export const inputSelectWordRightAction: CommandAction = {
    id: "input.selectWordRight",
    title: "Input: Select Word Right",
    keybinding: parseKeybinding("ctrl+shift+right"),
    when: "inputWidgetFocus",
    run(accessor) {
        accessor.get(InputWidgetServiceDIToken).selectWordRight();
    },
};

export const inputSelectAllAction: CommandAction = {
    id: "input.selectAll",
    title: "Input: Select All",
    keybinding: parseKeybinding("ctrl+a"),
    when: "inputWidgetFocus",
    run(accessor) {
        accessor.get(InputWidgetServiceDIToken).selectAll();
    },
};

// ─── Clipboard ───────────────────────────────────────────────

export const inputCopyAction: CommandAction = {
    id: "input.copy",
    title: "Input: Copy",
    keybinding: parseKeybinding("ctrl+c"),
    when: "inputWidgetFocus",
    async run(accessor) {
        await accessor.get(InputWidgetServiceDIToken).copy(accessor.get(ClipboardDIToken));
    },
};

export const inputCutAction: CommandAction = {
    id: "input.cut",
    title: "Input: Cut",
    keybinding: parseKeybinding("ctrl+x"),
    when: "inputWidgetFocus",
    async run(accessor) {
        await accessor.get(InputWidgetServiceDIToken).cut(accessor.get(ClipboardDIToken));
    },
};

export const inputPasteAction: CommandAction = {
    id: "input.paste",
    title: "Input: Paste",
    keybinding: parseKeybinding("ctrl+v"),
    when: "inputWidgetFocus",
    async run(accessor) {
        await accessor.get(InputWidgetServiceDIToken).paste(accessor.get(ClipboardDIToken));
    },
};

// ─── Undo / Redo ─────────────────────────────────────────────

export const inputUndoAction: CommandAction = {
    id: "input.undo",
    title: "Input: Undo",
    keybinding: parseKeybinding("mod+z"),
    when: "inputWidgetFocus",
    run(accessor) {
        accessor.get(InputWidgetServiceDIToken).undo();
    },
};

export const inputRedoAction: CommandAction = {
    id: "input.redo",
    title: "Input: Redo",
    keybindings: [parseKeybinding("ctrl+y"), parseKeybinding("mod+shift+z")],
    when: "inputWidgetFocus",
    run(accessor) {
        accessor.get(InputWidgetServiceDIToken).redo();
    },
};
