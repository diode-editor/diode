import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";

import { CompletionServiceDIToken } from "./completionService.ts";

/** Вес suggest-попапа (upstream: EditorContrib + 90): его Enter/Tab/Escape/стрелки сильнее редактора, find и призрака inline. */
const SUGGEST_WEIGHT = KeybindingWeight.EditorContrib + 90;

// Тонкие экшены suggest-попапа поверх CompletionService (этап 10:
// run-обработчики живут в самих экшенах, как у find/quick-open). Экшены под
// `suggestWidgetVisible` перебивают cursorDown/indentLines при открытом попапе
// весом SUGGEST_WEIGHT.

/**
 * Открывает completion-попап у каретки (`editor.action.triggerSuggest`).
 * Дефолтный кейбинд — Ctrl+Space при фокусе редактора. Команда также
 * вызывается расширениями (editorconfig после вставки свойства).
 */
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
 * Разворачивает/сворачивает панель описания у попапа. Кейбинд тот же Ctrl+Space,
 * что и у `editor.action.triggerSuggest`, — и это намеренно, как в VS Code:
 * `when: suggestWidgetVisible` и вес на ступень выше triggerSuggest дают ему
 * победу ровно пока попап открыт.
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
