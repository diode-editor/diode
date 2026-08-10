import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import { parseChord, parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { EditorServiceDIToken } from "../../services/editor/browser/editorService.ts";

// ─── Basic Cursor Movement ──────────────────────────────────

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

// ─── Home / End ─────────────────────────────────────────────

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

// ─── Document Start / End ───────────────────────────────────

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

// ─── Word Navigation ────────────────────────────────────────

// Word motions keep the canonical VS Code combo on every tier; on `legacy` (where the
// terminal often can't disambiguate Ctrl/Ctrl+Shift+Arrow) we add single-key and leader-chord
// fallbacks so the function is still reachable — breadth preserved, ergonomics degrade gracefully.
export const cursorWordLeftAction: CommandAction = {
    id: "cursorWordLeft",
    title: "Cursor Word Left",
    keybinding: parseKeybinding("ctrl+left"),
    keybindings: [
        { keys: parseKeybinding("alt+left"), when: "tier == 'legacy'" },
        { keys: parseChord("ctrl+k left"), when: "tier == 'legacy'" },
    ],
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.cursorWordLeft();
    },
};

export const cursorWordLeftSelectAction: CommandAction = {
    id: "cursorWordLeftSelect",
    title: "Cursor Word Left Select",
    keybinding: parseKeybinding("ctrl+shift+left"),
    keybindings: [{ keys: parseChord("ctrl+k shift+left"), when: "tier == 'legacy'" }],
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.cursorWordLeft(true);
    },
};

export const cursorWordRightAction: CommandAction = {
    id: "cursorWordRight",
    title: "Cursor Word Right",
    keybinding: parseKeybinding("ctrl+right"),
    keybindings: [
        { keys: parseKeybinding("alt+right"), when: "tier == 'legacy'" },
        { keys: parseChord("ctrl+k right"), when: "tier == 'legacy'" },
    ],
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.cursorWordRight();
    },
};

export const cursorWordRightSelectAction: CommandAction = {
    id: "cursorWordRightSelect",
    title: "Cursor Word Right Select",
    // Label только в меню — семантика пункта, не команды.
    menus: [{ menuId: MenuId.MenubarSelectionMenu, title: "Expand Selection (Word)", group: "2_expand", order: 10 }],
    keybinding: parseKeybinding("ctrl+shift+right"),
    keybindings: [{ keys: parseChord("ctrl+k shift+right"), when: "tier == 'legacy'" }],
    when: "textViewFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.cursorWordRight(true);
    },
};

// ─── Page Navigation ────────────────────────────────────────

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

// ─── Scroll View ────────────────────────────────────────────

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
