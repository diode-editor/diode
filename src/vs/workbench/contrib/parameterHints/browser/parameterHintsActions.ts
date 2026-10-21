import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";

import { ParameterHintsServiceDIToken } from "./parameterHintsService.ts";

/** Сильнее редактора и остальных попапов; с suggest их when взаимоисключающие через `!suggestWidgetVisible`. */
const PARAMETER_HINTS_WEIGHT = KeybindingWeight.EditorContrib + 93;

/**
 * Рядом с открытым suggest стрелки принадлежат списку пунктов. В VS Code это решает вес, у нас вес
 * подсказки выше suggest — поэтому `!suggestWidgetVisible`.
 */
const MULTIPLE_SIGNATURES = "parameterHintsVisible && parameterHintsMultipleSignatures && !suggestWidgetVisible";

/**
 * Чорд Ctrl+K Ctrl+Space основной: канонический Ctrl+Shift+Space на legacy-tier'е неотличим от
 * Ctrl+Space (байт 0x00), а тот занят `triggerSuggest`. Ctrl+K Ctrl+P занят палитрой, Ctrl+K Ctrl+I
 * на legacy приезжает Tab'ом.
 */
export const triggerParameterHintsAction: CommandAction = {
    id: "editor.action.triggerParameterHints",
    // Stryker disable next-line StringLiteral: заголовок команды виден только в палитре — подмена ненаблюдаема поведением
    title: "Trigger Parameter Hints",
    keybinding: parseChord("ctrl+k ctrl+space"),
    keybindings: [parseKeybinding("mod+shift+space")],
    when: "textInputFocus",
    run(accessor) {
        return accessor.get(ParameterHintsServiceDIToken).trigger();
    },
};

/**
 * Down — канон VS Code; Alt+Down — для терминалов, где стрелкой привыкли двигать каретку при
 * открытых попапах.
 */
export const showNextParameterHintAction: CommandAction = {
    id: "showNextParameterHint",
    weight: PARAMETER_HINTS_WEIGHT,
    // Stryker disable next-line StringLiteral: заголовок команды виден только в палитре — подмена ненаблюдаема поведением
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
    // Stryker disable next-line StringLiteral: заголовок команды виден только в палитре — подмена ненаблюдаема поведением
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
    // Stryker disable next-line StringLiteral: заголовок команды виден только в палитре — подмена ненаблюдаема поведением
    title: "Parameter Hints: Close",
    keybinding: parseKeybinding("escape"),
    // Пока открыт и попап автодополнения, Escape принадлежит ему (см. MULTIPLE_SIGNATURES).
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
