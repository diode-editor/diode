import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";

// Канонические Ctrl+Shift+[ / Ctrl+Shift+] недостижимы без extended keys (Ctrl+[
// это сам ESC, а Shift с печатным символом в legacy-поток не попадает), поэтому
// рядом — безусловные лидер-аккорды. Вторая часть не `alt+[`/`alt+]`: `ESC [` и
// `ESC ]` — вводители CSI и OSC, разбор ввода их не отдаёт как Alt+символ.
export const foldAction: CommandAction = {
    id: "editor.fold",
    title: "Fold",
    keybinding: parseChord("ctrl+k alt+f"),
    keybindings: [{ keys: parseKeybinding("ctrl+shift+["), when: "tier != 'legacy'" }],
    when: "textInputFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveEditor()?.foldAtCursor();
    },
};

export const unfoldAction: CommandAction = {
    id: "editor.unfold",
    title: "Unfold",
    keybinding: parseChord("ctrl+k alt+u"),
    keybindings: [{ keys: parseKeybinding("ctrl+shift+]"), when: "tier != 'legacy'" }],
    when: "textInputFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveEditor()?.unfoldAtCursor();
    },
};

export const toggleFoldAction: CommandAction = {
    id: "editor.toggleFold",
    title: "Toggle Fold",
    keybinding: parseChord("mod+k mod+l"),
    when: "textInputFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveEditor()?.toggleFoldAtCursor();
    },
};

export const foldAllAction: CommandAction = {
    id: "editor.foldAll",
    title: "Fold All",
    keybinding: parseChord("mod+k mod+0"),
    when: "textInputFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveEditor()?.foldAll();
    },
};

export const unfoldAllAction: CommandAction = {
    id: "editor.unfoldAll",
    title: "Unfold All",
    keybinding: parseChord("mod+k mod+j"),
    when: "textInputFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveEditor()?.unfoldAll();
    },
};

export const foldRecursivelyAction: CommandAction = {
    id: "editor.foldRecursively",
    title: "Fold Recursively",
    keybinding: parseChord("mod+k mod+["),
    when: "textInputFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveEditor()?.foldRecursivelyAtCursor();
    },
};

export const unfoldRecursivelyAction: CommandAction = {
    id: "editor.unfoldRecursively",
    title: "Unfold Recursively",
    keybinding: parseChord("mod+k mod+]"),
    when: "textInputFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveEditor()?.unfoldRecursivelyAtCursor();
    },
};

/** Builds an `editor.foldLevelN` action bound to Ctrl+K Ctrl+N (VS Code parity, N = 1..7). */
function makeFoldLevelAction(level: number): CommandAction {
    return {
        id: `editor.foldLevel${String(level)}`,
        title: `Fold Level ${String(level)}`,
        keybinding: parseChord(`mod+k mod+${String(level)}`),
        when: "textInputFocus",
        run(accessor) {
            accessor.get(EditorServiceDIToken).getActiveEditor()?.foldLevel(level);
        },
    };
}

export const foldLevelActions: CommandAction[] = [1, 2, 3, 4, 5, 6, 7].map(makeFoldLevelAction);

// Go to next/previous foldable region. VS Code ships these unbound; we bind them
// to Ctrl+K Ctrl+. / Ctrl+K Ctrl+, (easy to rebind).
export const gotoNextFoldAction: CommandAction = {
    id: "editor.gotoNextFold",
    title: "Go to Next Fold",
    keybinding: parseChord("ctrl+k ctrl+."),
    when: "textInputFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveEditor()?.gotoNextFold();
    },
};

export const gotoPreviousFoldAction: CommandAction = {
    id: "editor.gotoPreviousFold",
    title: "Go to Previous Fold",
    keybinding: parseChord("ctrl+k ctrl+,"),
    when: "textInputFocus",
    run(accessor) {
        accessor.get(EditorServiceDIToken).getActiveEditor()?.gotoPreviousFold();
    },
};

/** Экшены сворачивания. Фича отдаёт их одним массивом; регистрирует агрегатор (`WORKBENCH_ACTIONS`). */
export const FOLDING_ACTIONS: readonly CommandAction[] = [
    foldAction,
    unfoldAction,
    toggleFoldAction,
    foldAllAction,
    unfoldAllAction,
    foldRecursivelyAction,
    unfoldRecursivelyAction,
    ...foldLevelActions,
    gotoNextFoldAction,
    gotoPreviousFoldAction,
];
