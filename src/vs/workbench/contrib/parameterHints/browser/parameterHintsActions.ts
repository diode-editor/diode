import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";

import { ParameterHintsServiceDIToken } from "./parameterHintsService.ts";

/** Stronger than the editor and other popups; mutually exclusive with suggest via `!suggestWidgetVisible` in `when`. */
const PARAMETER_HINTS_WEIGHT = KeybindingWeight.EditorContrib + 93;

/**
 * With suggest open, the arrows belong to its list. VS Code settles this by weight; here the hint weight
 * is above suggest, hence `!suggestWidgetVisible`.
 */
const MULTIPLE_SIGNATURES = "parameterHintsVisible && parameterHintsMultipleSignatures && !suggestWidgetVisible";

/**
 * The Ctrl+K Ctrl+Space chord is primary: the canonical Ctrl+Shift+Space is indistinguishable from
 * Ctrl+Space (byte 0x00) on the legacy tier, and that one is taken by `triggerSuggest`. Ctrl+K Ctrl+P is
 * taken by the command palette, Ctrl+K Ctrl+I arrives as Tab on legacy.
 */
export const triggerParameterHintsAction: CommandAction = {
    id: "editor.action.triggerParameterHints",
    // Stryker disable next-line StringLiteral: the command title is visible only in the command palette — a substitution is not observable in behavior
    title: "Trigger Parameter Hints",
    keybinding: parseChord("ctrl+k ctrl+space"),
    keybindings: [parseKeybinding("mod+shift+space")],
    when: "textInputFocus",
    run(accessor) {
        return accessor.get(ParameterHintsServiceDIToken).trigger();
    },
};

/**
 * Down is the VS Code canon; Alt+Down is for terminals where the arrow is expected to move the cursor
 * while popups are open.
 */
export const showNextParameterHintAction: CommandAction = {
    id: "showNextParameterHint",
    weight: PARAMETER_HINTS_WEIGHT,
    // Stryker disable next-line StringLiteral: the command title is visible only in the command palette — a substitution is not observable in behavior
    title: "Parameter Hints: Next Signature",
    keybinding: parseKeybinding("down"),
    keybindings: [parseKeybinding("alt+down")],
    when: MULTIPLE_SIGNATURES,
    run(accessor) {
        accessor.get(ParameterHintsServiceDIToken).nextSignature();
    },
};

export const showPrevParameterHintAction: CommandAction = {
    id: "showPrevParameterHint",
    weight: PARAMETER_HINTS_WEIGHT,
    // Stryker disable next-line StringLiteral: the command title is visible only in the command palette — a substitution is not observable in behavior
    title: "Parameter Hints: Previous Signature",
    keybinding: parseKeybinding("up"),
    keybindings: [parseKeybinding("alt+up")],
    when: MULTIPLE_SIGNATURES,
    run(accessor) {
        accessor.get(ParameterHintsServiceDIToken).previousSignature();
    },
};

export const closeParameterHintsAction: CommandAction = {
    id: "closeParameterHints",
    weight: PARAMETER_HINTS_WEIGHT,
    // Stryker disable next-line StringLiteral: the command title is visible only in the command palette — a substitution is not observable in behavior
    title: "Parameter Hints: Close",
    keybinding: parseKeybinding("escape"),
    // While the suggest popup is also open, Escape belongs to it (see MULTIPLE_SIGNATURES).
    when: "parameterHintsVisible && !suggestWidgetVisible",
    run(accessor) {
        accessor.get(ParameterHintsServiceDIToken).close();
    },
};

export const PARAMETER_HINTS_ACTIONS: readonly CommandAction[] = [
    triggerParameterHintsAction,
    closeParameterHintsAction,
    showNextParameterHintAction,
    showPrevParameterHintAction,
];
