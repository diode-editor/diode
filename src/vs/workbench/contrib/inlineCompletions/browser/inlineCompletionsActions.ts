import { InlineCompletionTriggerKind } from "../../../../editor/common/languages/iInlineCompletionSource.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import { InlineCompletionsServiceDIToken } from "./inlineCompletionsService.ts";

// Тонкие экшены призрачных подсказок поверх InlineCompletionsService. Id команд
// и when-ключи — дословно VS Code (`editor.action.inlineSuggest.*`,
// `inlineSuggestionVisible`). Регистрируются в хвосте builtinActions ПЕРЕД
// suggest-экшенами: KeybindingRegistry.resolveKey берёт последний
// зарегистрированный с проходящим `when`, поэтому при открытом попапе Tab
// достаётся acceptSelectedSuggestion (у commit к тому же `!suggestWidgetVisible`).

/**
 * Явный запрос подсказки у каретки (без дебаунса,
 * `InlineCompletionTriggerKind.Invoke`) — работает и при выключенном
 * `editor.inlineSuggest.enabled`, это и есть ручной режим.
 *
 * Alt+\ — не из ядра vscode (там у команды дефолтной клавиши нет вовсе);
 * комбинация приходит от расширения GitHub Copilot, пользователь её знает, а
 * конфликта у нас нет. Терминал шлёт её как ESC + `\`, что разбирается в
 * `{key: "\\", altKey: true}` (tuidom `tokenize` → `esc-char`).
 */
export const triggerInlineSuggestAction: CommandAction = {
    id: "editor.action.inlineSuggest.trigger",
    title: "Trigger Inline Suggestion",
    keybinding: parseKeybinding("alt+\\"),
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

/**
 * Спрятать показанную подсказку (Escape) — и отменить запрос, который ещё в
 * полёте: `inlineSuggestionRequestPending` продлевает биндинг на окно ожидания
 * ответа, когда показывать ещё нечего. Гейт по `textInputFocus` обязателен:
 * ожидание невидимо, и без него Escape в find-виджете или квик-пике уходил бы
 * призрачным подсказкам.
 */
export const hideInlineSuggestAction: CommandAction = {
    id: "editor.action.inlineSuggest.hide",
    title: "Hide Inline Suggestion",
    keybinding: parseKeybinding("escape"),
    when: "inlineSuggestionVisible || (inlineSuggestionRequestPending && textInputFocus)",
    run(accessor) {
        accessor.get(InlineCompletionsServiceDIToken).hide();
    },
};
