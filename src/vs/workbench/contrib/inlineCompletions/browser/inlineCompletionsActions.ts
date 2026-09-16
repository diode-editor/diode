import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { InlineCompletionTriggerKind } from "../../../../editor/common/languages/iInlineCompletionSource.ts";

import { InlineCompletionsServiceDIToken } from "./inlineCompletionsService.ts";

// Тонкие экшены призрачных подсказок поверх InlineCompletionsService. Id команд
// и when-ключи — дословно VS Code (`editor.action.inlineSuggest.*`,
// `inlineSuggestionVisible`). Регистрируются в хвосте builtinActions ПЕРЕД
// suggest-экшенами: KeybindingRegistry.resolveKey берёт последний
// зарегистрированный с проходящим `when`, поэтому при открытом попапе Tab
// достаётся acceptSelectedSuggestion (у commit к тому же `!suggestWidgetVisible`).

/** Явный запрос подсказки у каретки (без дебаунса, `InlineCompletionTriggerKind.Invoke`). */
export const triggerInlineSuggestAction: CommandAction = {
    id: "editor.action.inlineSuggest.trigger",
    title: "Trigger Inline Suggestion",
    when: "textInputFocus && !editorReadonly",
    run(accessor) {
        void accessor.get(InlineCompletionsServiceDIToken).trigger(InlineCompletionTriggerKind.Invoke);
    },
};

/**
 * Принять показанную подсказку. Tab, но: не при открытом suggest-попапе (там
 * Tab принимает пункт попапа) и не когда подсказка начинается с ≥ таба отступа
 * при каретке в отступе — тогда Tab продолжает индентить (ключ
 * `inlineSuggestionHasIndentationLessThanTabSize`, как в VS Code).
 */
export const commitInlineSuggestAction: CommandAction = {
    id: "editor.action.inlineSuggest.commit",
    title: "Accept Inline Suggestion",
    keybinding: parseKeybinding("tab"),
    when: "inlineSuggestionVisible && !suggestWidgetVisible && inlineSuggestionHasIndentationLessThanTabSize",
    run(accessor) {
        accessor.get(InlineCompletionsServiceDIToken).acceptCurrent();
    },
};

/** Спрятать показанную подсказку (Escape). */
export const hideInlineSuggestAction: CommandAction = {
    id: "editor.action.inlineSuggest.hide",
    title: "Hide Inline Suggestion",
    keybinding: parseKeybinding("escape"),
    when: "inlineSuggestionVisible",
    run(accessor) {
        accessor.get(InlineCompletionsServiceDIToken).hide();
    },
};
