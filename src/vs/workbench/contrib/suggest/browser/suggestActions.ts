import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";

import { CompletionServiceDIToken } from "./completionService.ts";

/** upstream: EditorContrib + 90 — stronger than the editor, find and inline ghost text. */
const SUGGEST_WEIGHT = KeybindingWeight.EditorContrib + 90;

export const triggerSuggestAction: CommandAction = {
    id: "editor.action.triggerSuggest",
    weight: SUGGEST_WEIGHT,
    title: "Trigger Suggest",
    keybinding: parseKeybinding("ctrl+space"),
    when: "textInputFocus",
    run(accessor) {
        return accessor.get(CompletionServiceDIToken).trigger();
    },
};

export const selectNextSuggestionAction: CommandAction = {
    id: "selectNextSuggestion",
    weight: SUGGEST_WEIGHT,
    title: "Suggest: Select Next",
    keybinding: parseKeybinding("down"),
    when: "suggestWidgetVisible",
    run(accessor) {
        accessor.get(CompletionServiceDIToken).selectNext();
    },
};

export const selectPrevSuggestionAction: CommandAction = {
    id: "selectPrevSuggestion",
    weight: SUGGEST_WEIGHT,
    title: "Suggest: Select Previous",
    keybinding: parseKeybinding("up"),
    when: "suggestWidgetVisible",
    run(accessor) {
        accessor.get(CompletionServiceDIToken).selectPrevious();
    },
};

export const selectNextPageSuggestionAction: CommandAction = {
    id: "selectNextPageSuggestion",
    weight: SUGGEST_WEIGHT,
    title: "Suggest: Select Next Page",
    keybinding: parseKeybinding("pagedown"),
    when: "suggestWidgetVisible",
    run(accessor) {
        accessor.get(CompletionServiceDIToken).selectNextPage();
    },
};

export const selectPrevPageSuggestionAction: CommandAction = {
    id: "selectPrevPageSuggestion",
    weight: SUGGEST_WEIGHT,
    title: "Suggest: Select Previous Page",
    keybinding: parseKeybinding("pageup"),
    when: "suggestWidgetVisible",
    run(accessor) {
        accessor.get(CompletionServiceDIToken).selectPreviousPage();
    },
};

export const acceptSelectedSuggestionAction: CommandAction = {
    id: "acceptSelectedSuggestion",
    weight: SUGGEST_WEIGHT,
    title: "Suggest: Accept Selected",
    keybinding: parseKeybinding("enter"),
    keybindings: [parseKeybinding("tab")],
    when: "suggestWidgetVisible",
    run(accessor) {
        accessor.get(CompletionServiceDIToken).acceptSelected();
    },
};

/**
 * The same Ctrl+Space as triggerSuggest — on purpose, like VS Code: `when: suggestWidgetVisible`
 * and a higher weight make it win while the popup is open.
 */
export const toggleSuggestionDetailsAction: CommandAction = {
    id: "toggleSuggestionDetails",
    weight: SUGGEST_WEIGHT + 1,
    title: "Suggest: Toggle Details",
    keybinding: parseKeybinding("ctrl+space"),
    when: "suggestWidgetVisible",
    run(accessor) {
        accessor.get(CompletionServiceDIToken).toggleDetails();
    },
};

export const hideSuggestWidgetAction: CommandAction = {
    id: "hideSuggestWidget",
    weight: SUGGEST_WEIGHT,
    title: "Suggest: Close",
    keybinding: parseKeybinding("escape"),
    when: "suggestWidgetVisible",
    run(accessor) {
        accessor.get(CompletionServiceDIToken).hide();
    },
};

export const SUGGEST_ACTIONS: readonly CommandAction[] = [
    triggerSuggestAction,
    selectNextSuggestionAction,
    selectPrevSuggestionAction,
    selectNextPageSuggestionAction,
    selectPrevPageSuggestionAction,
    acceptSelectedSuggestionAction,
    hideSuggestWidgetAction,
    toggleSuggestionDetailsAction,
];
