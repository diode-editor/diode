import {
    addSelectionToNextFindMatch,
    addSelectionToPreviousFindMatch,
    insertCursorAtEndOfEachLineSelected,
    moveSelectionToNextFindMatch,
    moveSelectionToPreviousFindMatch,
    selectHighlights,
} from "../../../../editor/contrib/multicursor/multiCursorCommands.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";

/**
 * `textViewFocus` gate without `!editorReadonly`: the commands only move selections, like in VS Code.
 * `shift+alt+↑/↓` next to `ctrl+alt+↑/↓` is VS Code's Linux default, where the window manager takes ctrl+alt.
 */

export const insertCursorAboveAction: CommandAction = {
    id: "editor.action.insertCursorAbove",
    title: "Add Cursor Above",
    keybinding: parseKeybinding("ctrl+alt+up"),
    keybindings: [parseKeybinding("shift+alt+up")],
    when: "textViewFocus",
    menus: [{ menuId: MenuId.MenubarSelectionMenu, group: "3_multi", order: 10 }],
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.insertCursorAbove();
    },
};

export const insertCursorBelowAction: CommandAction = {
    id: "editor.action.insertCursorBelow",
    title: "Add Cursor Below",
    keybinding: parseKeybinding("ctrl+alt+down"),
    keybindings: [parseKeybinding("shift+alt+down")],
    when: "textViewFocus",
    menus: [{ menuId: MenuId.MenubarSelectionMenu, group: "3_multi", order: 20 }],
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.insertCursorBelow();
    },
};

export const removeSecondaryCursorsAction: CommandAction = {
    id: "removeSecondaryCursors",
    title: "Remove Secondary Cursors",
    keybinding: parseKeybinding("escape"),
    // The cursor-count gate is required: otherwise Escape would stick to the editor and never reach
    // those who need it more (the find widget, the suggest popup).
    when: "textViewFocus && editorHasMultipleSelections",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.removeSecondaryCursors();
    },
};

export const insertCursorAtEndOfEachLineSelectedAction: CommandAction = {
    id: "editor.action.insertCursorAtEndOfEachLineSelected",
    title: "Add Cursors to Line Ends",
    // `ctrl+shift+i` is indistinguishable from `ctrl+i` (which is Tab) where there are no extended keys —
    // hence the unconditional chord next to it (see editorActions: a tier gate on the fallback
    // removed it exactly in the environment that needs it).
    keybinding: parseKeybinding("ctrl+shift+alt+i"),
    keybindings: [parseChord("ctrl+k ctrl+i")],
    when: "textViewFocus",
    menus: [{ menuId: MenuId.MenubarSelectionMenu, group: "3_multi", order: 30 }],
    run(accessor) {
        const viewState = accessor.get(EditorServiceDIToken).getActiveViewState();
        if (viewState) insertCursorAtEndOfEachLineSelected(viewState);
    },
};

export const addSelectionToNextFindMatchAction: CommandAction = {
    id: "editor.action.addSelectionToNextFindMatch",
    title: "Add Selection To Next Find Match",
    // `ctrl+<letter>` arrives on any tier — no fallback needed.
    keybinding: parseKeybinding("mod+d"),
    when: "textViewFocus",
    menus: [{ menuId: MenuId.MenubarSelectionMenu, group: "4_find", order: 10 }],
    run(accessor) {
        const viewState = accessor.get(EditorServiceDIToken).getActiveViewState();
        if (viewState) addSelectionToNextFindMatch(viewState);
    },
};

export const addSelectionToPreviousFindMatchAction: CommandAction = {
    id: "editor.action.addSelectionToPreviousFindMatch",
    title: "Add Selection To Previous Find Match",
    // No default binding — like VS Code; available from the command palette and the Selection menu.
    when: "textViewFocus",
    menus: [{ menuId: MenuId.MenubarSelectionMenu, group: "4_find", order: 20 }],
    run(accessor) {
        const viewState = accessor.get(EditorServiceDIToken).getActiveViewState();
        if (viewState) addSelectionToPreviousFindMatch(viewState);
    },
};

export const moveSelectionToNextFindMatchAction: CommandAction = {
    id: "editor.action.moveSelectionToNextFindMatch",
    title: "Move Last Selection To Next Find Match",
    keybinding: parseChord("mod+k mod+d"),
    when: "textViewFocus",
    menus: [{ menuId: MenuId.MenubarSelectionMenu, group: "4_find", order: 30 }],
    run(accessor) {
        const viewState = accessor.get(EditorServiceDIToken).getActiveViewState();
        if (viewState) moveSelectionToNextFindMatch(viewState);
    },
};

export const moveSelectionToPreviousFindMatchAction: CommandAction = {
    id: "editor.action.moveSelectionToPreviousFindMatch",
    title: "Move Last Selection To Previous Find Match",
    when: "textViewFocus",
    menus: [{ menuId: MenuId.MenubarSelectionMenu, group: "4_find", order: 40 }],
    run(accessor) {
        const viewState = accessor.get(EditorServiceDIToken).getActiveViewState();
        if (viewState) moveSelectionToPreviousFindMatch(viewState);
    },
};

export const selectHighlightsAction: CommandAction = {
    id: "editor.action.selectHighlights",
    title: "Select All Occurrences",
    // On legacy `ctrl+shift+<letter>` is indistinguishable from `ctrl+<letter>` — same rule as
    // `ctrl+shift+f` / `ctrl+shift+g`: an unconditional chord next to the canonical binding.
    keybinding: parseKeybinding("mod+shift+l"),
    keybindings: [parseChord("ctrl+k ctrl+a")],
    when: "textViewFocus",
    menus: [{ menuId: MenuId.MenubarSelectionMenu, group: "4_find", order: 50 }],
    run(accessor) {
        const viewState = accessor.get(EditorServiceDIToken).getActiveViewState();
        if (viewState) selectHighlights(viewState);
    },
};

/**
 * Uses upstream's id (`editor.action.changeAll`): keybindings and `contributes.menus` know it. No binding
 * on purpose — Ctrl+F2 does not get through a legacy terminal; the same operation is on Select All Occurrences.
 */
export const changeAllOccurrencesAction: CommandAction = {
    id: "editor.action.changeAll",
    title: "Change All Occurrences",
    when: "textInputFocus && !editorReadonly",
    menus: [{ menuId: MenuId.EditorContext, group: "1_modification", order: 1.2 }],
    run(accessor) {
        const viewState = accessor.get(EditorServiceDIToken).getActiveViewState();
        if (viewState) selectHighlights(viewState);
    },
};

/** Order follows the Selection menu. */
export const MULTI_CURSOR_ACTIONS: readonly CommandAction[] = [
    insertCursorAboveAction,
    insertCursorBelowAction,
    insertCursorAtEndOfEachLineSelectedAction,
    removeSecondaryCursorsAction,
    addSelectionToNextFindMatchAction,
    addSelectionToPreviousFindMatchAction,
    moveSelectionToNextFindMatchAction,
    moveSelectionToPreviousFindMatchAction,
    selectHighlightsAction,
    changeAllOccurrencesAction,
];
