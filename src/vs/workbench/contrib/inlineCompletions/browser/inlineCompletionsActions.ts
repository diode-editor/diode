import { InlineCompletionTriggerKind } from "../../../../editor/common/languages/iInlineCompletionSource.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";

import { InlineCompletionsServiceDIToken } from "./inlineCompletionsService.ts";

/** Stronger than find and Tab indent, weaker than an open suggest popup (Escape closes the popup first). */
const INLINE_WEIGHT = KeybindingWeight.EditorContrib + 80;

/**
 * Works even with `editor.inlineSuggest.enabled` off — that is the manual mode. Alt+\ comes from
 * GitHub Copilot (core vscode has no key); the terminal sends ESC + `\` → `{key: "\\", altKey: true}`.
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
 * Tab does not accept when the suggestion starts with ≥ a tab of indentation and the cursor is in the
 * indentation — then Tab indents (as in VS Code).
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
 * Also cancels a request in flight: `inlineSuggestionRequestPending` extends the binding while awaiting
 * the answer. The `textInputFocus` gate is required — otherwise Escape of the find widget and quick pick
 * would land here.
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
