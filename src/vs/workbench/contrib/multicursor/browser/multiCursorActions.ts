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
 * Гейт `textViewFocus` без `!editorReadonly`: команды только двигают выделения, как в VS Code.
 * `shift+alt+↑/↓` рядом с `ctrl+alt+↑/↓` — дефолт VS Code на Linux, где ctrl+alt забирает оконный менеджер.
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
    // Гейт по числу кареток обязателен: иначе Escape залипал бы на редакторе и не доходил
    // до тех, кому он нужнее (find-виджет, попап автодополнения).
    when: "textViewFocus && editorHasMultipleSelections",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveViewState()?.removeSecondaryCursors();
    },
};

export const insertCursorAtEndOfEachLineSelectedAction: CommandAction = {
    id: "editor.action.insertCursorAtEndOfEachLineSelected",
    title: "Add Cursors to Line Ends",
    // `ctrl+shift+i` неотличим от `ctrl+i` (это Tab) там, где нет extended keys —
    // отсюда безусловный аккорд рядом (см. editorActions: гейт по tier на фолбэке
    // снимал его ровно в том окружении, где он и нужен).
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
    // `ctrl+<буква>` доезжает на любом tier — фолбэк не нужен.
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
    // Без бинда по умолчанию — как в VS Code; доступна из палитры и меню Selection.
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
    // `ctrl+shift+<буква>` на legacy неотличим от `ctrl+<буква>` — та же норма, что у
    // `ctrl+shift+f` / `ctrl+shift+g`: безусловный аккорд рядом с каноническим биндом.
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
 * Под id эталона (`editor.action.changeAll`): его знают кейбинды и `contributes.menus`. Бинда нет
 * намеренно — Ctrl+F2 на legacy-терминале не доезжает, та же операция висит на Select All Occurrences.
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

/** Порядок — как в меню Selection. */
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
