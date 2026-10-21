import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import { parseChord, parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { EditorServiceDIToken } from "../../services/editor/common/editorService.ts";

export const cursorLeftAction: CommandAction = {
    id: "cursorLeft",
    title: "Cursor Left",
    keybinding: parseKeybinding("left"),
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.cursorLeft();
    },
};

export const cursorLeftSelectAction: CommandAction = {
    id: "cursorLeftSelect",
    title: "Cursor Left Select",
    keybinding: parseKeybinding("shift+left"),
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.cursorLeft(true);
    },
};

export const cursorRightAction: CommandAction = {
    id: "cursorRight",
    title: "Cursor Right",
    keybinding: parseKeybinding("right"),
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.cursorRight();
    },
};

export const cursorRightSelectAction: CommandAction = {
    id: "cursorRightSelect",
    title: "Cursor Right Select",
    keybinding: parseKeybinding("shift+right"),
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.cursorRight(true);
    },
};

export const cursorUpAction: CommandAction = {
    id: "cursorUp",
    title: "Cursor Up",
    keybinding: parseKeybinding("up"),
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.cursorUp();
    },
};

export const cursorUpSelectAction: CommandAction = {
    id: "cursorUpSelect",
    title: "Cursor Up Select",
    keybinding: parseKeybinding("shift+up"),
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.cursorUp(true);
    },
};

export const cursorDownAction: CommandAction = {
    id: "cursorDown",
    title: "Cursor Down",
    keybinding: parseKeybinding("down"),
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.cursorDown();
    },
};

export const cursorDownSelectAction: CommandAction = {
    id: "cursorDownSelect",
    title: "Cursor Down Select",
    keybinding: parseKeybinding("shift+down"),
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.cursorDown(true);
    },
};

export const cursorHomeAction: CommandAction = {
    id: "cursorHome",
    title: "Cursor Home",
    keybinding: parseKeybinding("home"),
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.cursorHome();
    },
};

export const cursorHomeSelectAction: CommandAction = {
    id: "cursorHomeSelect",
    title: "Cursor Home Select",
    keybinding: parseKeybinding("shift+home"),
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.cursorHome(true);
    },
};

export const cursorEndAction: CommandAction = {
    id: "cursorEnd",
    title: "Cursor End",
    keybinding: parseKeybinding("end"),
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.cursorEnd();
    },
};

export const cursorEndSelectAction: CommandAction = {
    id: "cursorEndSelect",
    title: "Cursor End Select",
    keybinding: parseKeybinding("shift+end"),
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.cursorEnd(true);
    },
};

// No PC bindings of their own, as upstream: on the Mac these are Ctrl+A / Ctrl+E (Home/End
// scroll the buffer in Mac terminals); the bindings live in the Mac delta table.

export const cursorLineStartAction: CommandAction = {
    id: "cursorLineStart",
    title: "Cursor Line Start",
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.cursorLineStart();
    },
};

export const cursorLineEndAction: CommandAction = {
    id: "cursorLineEnd",
    title: "Cursor Line End",
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.cursorEnd();
    },
};

export const cursorTopAction: CommandAction = {
    id: "cursorTop",
    title: "Cursor Top",
    keybinding: parseKeybinding("ctrl+home"),
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.cursorTop();
    },
};

export const cursorTopSelectAction: CommandAction = {
    id: "cursorTopSelect",
    title: "Cursor Top Select",
    keybinding: parseKeybinding("ctrl+shift+home"),
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.cursorTop(true);
    },
};

export const cursorBottomAction: CommandAction = {
    id: "cursorBottom",
    title: "Cursor Bottom",
    keybinding: parseKeybinding("ctrl+end"),
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.cursorBottom();
    },
};

export const cursorBottomSelectAction: CommandAction = {
    id: "cursorBottomSelect",
    title: "Cursor Bottom Select",
    keybinding: parseKeybinding("ctrl+shift+end"),
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.cursorBottom(true);
    },
};

// The fallbacks are UNCONDITIONAL, not under `tier == 'legacy'`: under tmux the tier rises on
// the env hint and the first CSI-u key, yet tmux does not deliver extended keys —
// the gate disabled the fallback exactly where it is needed (docs/arch/workbench/Keyboard.md).
export const cursorWordLeftAction: CommandAction = {
    id: "cursorWordLeft",
    title: "Cursor Word Left",
    keybinding: parseKeybinding("ctrl+left"),
    keybindings: [parseKeybinding("alt+left"), parseChord("ctrl+k left")],
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.cursorWordLeft();
    },
};

export const cursorWordLeftSelectAction: CommandAction = {
    id: "cursorWordLeftSelect",
    title: "Cursor Word Left Select",
    keybinding: parseKeybinding("ctrl+shift+left"),
    keybindings: [parseChord("ctrl+k shift+left")],
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.cursorWordLeft(true);
    },
};

export const cursorWordRightAction: CommandAction = {
    id: "cursorWordRight",
    title: "Cursor Word Right",
    keybinding: parseKeybinding("ctrl+right"),
    keybindings: [parseKeybinding("alt+right"), parseChord("ctrl+k right")],
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.cursorWordRight();
    },
};

export const cursorWordRightSelectAction: CommandAction = {
    id: "cursorWordRightSelect",
    title: "Cursor Word Right Select",
    keybinding: parseKeybinding("ctrl+shift+right"),
    keybindings: [parseChord("ctrl+k shift+right")],
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.cursorWordRight(true);
    },
};

export const cursorPageDownAction: CommandAction = {
    id: "cursorPageDown",
    title: "Cursor Page Down",
    keybinding: parseKeybinding("pagedown"),
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.cursorPageDown();
    },
};

export const cursorPageDownSelectAction: CommandAction = {
    id: "cursorPageDownSelect",
    title: "Cursor Page Down Select",
    keybinding: parseKeybinding("shift+pagedown"),
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.cursorPageDown(true);
    },
};

export const cursorPageUpAction: CommandAction = {
    id: "cursorPageUp",
    title: "Cursor Page Up",
    keybinding: parseKeybinding("pageup"),
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.cursorPageUp();
    },
};

export const cursorPageUpSelectAction: CommandAction = {
    id: "cursorPageUpSelect",
    title: "Cursor Page Up Select",
    keybinding: parseKeybinding("shift+pageup"),
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.cursorPageUp(true);
    },
};

export const scrollLineUpAction: CommandAction = {
    id: "scrollLineUp",
    title: "Scroll Line Up",
    keybinding: parseKeybinding("ctrl+up"),
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.scrollLineUp();
    },
};

export const scrollLineDownAction: CommandAction = {
    id: "scrollLineDown",
    title: "Scroll Line Down",
    keybinding: parseKeybinding("ctrl+down"),
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.scrollLineDown();
    },
};

// No when, as in VS Code: it toggles the service's session state, not the editor.
export const toggleWordWrapAction: CommandAction = {
    id: "editor.action.toggleWordWrap",
    title: "View: Toggle Word Wrap",
    shortTitle: "Word Wrap",
    menus: [{ menuId: MenuId.MenubarViewMenu, group: "5_editor", order: 10 }],
    keybinding: parseKeybinding("alt+z"),
    run(accessor) {
        accessor.get(EditorServiceDIToken).editorConfiguration.toggleWordWrap();
    },
};
