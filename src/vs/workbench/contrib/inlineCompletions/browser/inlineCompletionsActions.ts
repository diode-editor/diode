import { InlineCompletionTriggerKind } from "../../../../editor/common/languages/iInlineCompletionSource.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";

import { InlineCompletionsServiceDIToken } from "./inlineCompletionsService.ts";

/** Сильнее find и Tab-отступа, слабее открытого suggest-попапа (Escape сначала закрывает попап). */
const INLINE_WEIGHT = KeybindingWeight.EditorContrib + 80;

/**
 * Работает и при выключенном `editor.inlineSuggest.enabled` — это и есть ручной режим. Alt+\ — от
 * GitHub Copilot (в ядре vscode клавиши нет); терминал шлёт ESC + `\` → `{key: "\\", altKey: true}`.
 */
export const triggerInlineSuggestAction: CommandAction = {
    id: "editor.action.inlineSuggest.trigger",
    title: "Trigger Inline Suggestion",
    keybinding: parseKeybinding("alt+\\"),
    when: "textInputFocus && !editorReadonly",
    run(accessor) {
        return accessor.get(InlineCompletionsServiceDIToken).trigger(InlineCompletionTriggerKind.Invoke);
    },
};

/**
 * Tab не принимает, когда подсказка начинается с ≥ таба отступа при каретке в отступе — тогда Tab
 * индентит (как в VS Code).
 */
export const commitInlineSuggestAction: CommandAction = {
    id: "editor.action.inlineSuggest.commit",
    weight: INLINE_WEIGHT,
    title: "Accept Inline Suggestion",
    keybinding: parseKeybinding("tab"),
    when: "inlineSuggestionVisible && !suggestWidgetVisible && inlineSuggestionHasIndentationLessThanTabSize",
    run(accessor) {
        accessor.get(InlineCompletionsServiceDIToken).acceptCurrent();
    },
};

/**
 * Отменяет и запрос в полёте: `inlineSuggestionRequestPending` продлевает биндинг на ожидание ответа.
 * Гейт `textInputFocus` обязателен — иначе сюда уходил бы Escape find-виджета и квик-пика.
 */
export const hideInlineSuggestAction: CommandAction = {
    id: "editor.action.inlineSuggest.hide",
    weight: INLINE_WEIGHT,
    title: "Hide Inline Suggestion",
    keybinding: parseKeybinding("escape"),
    when: "inlineSuggestionVisible || (inlineSuggestionRequestPending && textInputFocus)",
    run(accessor) {
        accessor.get(InlineCompletionsServiceDIToken).hide();
    },
};

export const INLINE_COMPLETIONS_ACTIONS: readonly CommandAction[] = [
    triggerInlineSuggestAction,
    commitInlineSuggestAction,
    hideInlineSuggestAction,
];
