import { moveToWordHighlight } from "../../../../editor/contrib/wordHighlighter/wordHighlightNavigation.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";

/**
 * Переход по подсвеченным вхождениям слова под кареткой (upstream
 * `editor/contrib/wordHighlighter`). Вес и `when` — как у upstream. F7 в диффе
 * (`editor.action.accessibleDiffViewer.next`) у эталона висит на том же весе и
 * отличается предусловием `isInDiffEditor` — см. docs/TODO/DiffViewer.md.
 */

export const nextWordHighlightAction: CommandAction = {
    id: "editor.action.wordHighlight.next",
    title: "Go to Next Symbol Highlight",
    weight: KeybindingWeight.EditorContrib,
    keybinding: parseKeybinding("f7"),
    when: "editorTextFocus",
    run(accessor) {
        const viewState = accessor.get(EditorServiceDIToken).getActiveViewState();
        if (viewState) moveToWordHighlight(viewState, 1);
    },
};

export const prevWordHighlightAction: CommandAction = {
    id: "editor.action.wordHighlight.prev",
    title: "Go to Previous Symbol Highlight",
    weight: KeybindingWeight.EditorContrib,
    keybinding: parseKeybinding("shift+f7"),
    when: "editorTextFocus",
    run(accessor) {
        const viewState = accessor.get(EditorServiceDIToken).getActiveViewState();
        if (viewState) moveToWordHighlight(viewState, -1);
    },
};

/** Экшены фичи одним массивом; регистрирует агрегатор (`WORKBENCH_ACTIONS`). */
export const WORD_HIGHLIGHTER_ACTIONS: readonly CommandAction[] = [nextWordHighlightAction, prevWordHighlightAction];
