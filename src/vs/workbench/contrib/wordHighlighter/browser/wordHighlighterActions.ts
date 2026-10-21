import { moveToWordHighlight } from "../../../../editor/contrib/wordHighlighter/wordHighlightNavigation.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";

// Вес и `when` — как у upstream; F7 в диффе отличается предусловием `isInDiffEditor` (docs/TODO/Diff.md, «Интерактив»).

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

export const WORD_HIGHLIGHTER_ACTIONS: readonly CommandAction[] = [nextWordHighlightAction, prevWordHighlightAction];
