import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import { CompletionServiceDIToken } from "./completionService.ts";

// Тонкие экшены suggest-попапа поверх CompletionService (этап 10:
// run-обработчики живут в самих экшенах, как у find/quick-open). Экшены под
// `suggestWidgetVisible` регистрируются ПОСЛЕ builtin editor-экшенов (хвост
// builtinActions в WorkbenchComponent), чтобы победить cursorDown/indentLines при
// открытом попапе (KeybindingRegistry.resolveKey: последний зарегистрированный
// с проходящим `when` выигрывает).

/**
 * Открывает completion-попап у каретки (`editor.action.triggerSuggest`).
 * Дефолтный кейбинд — Ctrl+Space при фокусе редактора. Команда также
 * вызывается расширениями (editorconfig после вставки свойства).
 */
export const triggerSuggestAction: CommandAction = {
    id: "editor.action.triggerSuggest",
    title: "Trigger Suggest",
    keybinding: parseKeybinding("ctrl+space"),
    when: "textInputFocus",
    run(accessor) {
        void accessor.get(CompletionServiceDIToken).trigger();
    },
};

export const selectNextSuggestionAction: CommandAction = {
    id: "selectNextSuggestion",
    title: "Suggest: Select Next",
    keybinding: parseKeybinding("down"),
    when: "suggestWidgetVisible",
    run(accessor) {
        accessor.get(CompletionServiceDIToken).selectNext();
    },
};

export const selectPrevSuggestionAction: CommandAction = {
    id: "selectPrevSuggestion",
    title: "Suggest: Select Previous",
    keybinding: parseKeybinding("up"),
    when: "suggestWidgetVisible",
    run(accessor) {
        accessor.get(CompletionServiceDIToken).selectPrevious();
    },
};

export const selectNextPageSuggestionAction: CommandAction = {
    id: "selectNextPageSuggestion",
    title: "Suggest: Select Next Page",
    keybinding: parseKeybinding("pagedown"),
    when: "suggestWidgetVisible",
    run(accessor) {
        accessor.get(CompletionServiceDIToken).selectNextPage();
    },
};

export const selectPrevPageSuggestionAction: CommandAction = {
    id: "selectPrevPageSuggestion",
    title: "Suggest: Select Previous Page",
    keybinding: parseKeybinding("pageup"),
    when: "suggestWidgetVisible",
    run(accessor) {
        accessor.get(CompletionServiceDIToken).selectPreviousPage();
    },
};

export const acceptSelectedSuggestionAction: CommandAction = {
    id: "acceptSelectedSuggestion",
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
 * `when: suggestWidgetVisible` вместе с регистрацией в хвосте suggest-экшенов
 * даёт ему победу ровно пока попап открыт (`KeybindingRegistry.resolveKey`
 * выбирает последний зарегистрированный с проходящим `when`).
 */
export const toggleSuggestionDetailsAction: CommandAction = {
    id: "toggleSuggestionDetails",
    title: "Suggest: Toggle Details",
    keybinding: parseKeybinding("ctrl+space"),
    when: "suggestWidgetVisible",
    run(accessor) {
        accessor.get(CompletionServiceDIToken).toggleDetails();
    },
};

export const hideSuggestWidgetAction: CommandAction = {
    id: "hideSuggestWidget",
    title: "Suggest: Close",
    keybinding: parseKeybinding("escape"),
    when: "suggestWidgetVisible",
    run(accessor) {
        accessor.get(CompletionServiceDIToken).hide();
    },
};
