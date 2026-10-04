import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";

import { ParameterHintsServiceDIToken } from "./parameterHintsService.ts";

/** Вес подсказки параметров: стрелки и Escape у неё сильнее редактора и остальных попапов (кроме suggest: их when взаимоисключающие через `!suggestWidgetVisible`). */
const PARAMETER_HINTS_WEIGHT = KeybindingWeight.EditorContrib + 93;

/**
 * Стрелки листают перегрузки, только когда их больше одной, попап показан — и
 * НЕ показан попап автодополнения: у каретки они живут одновременно (подсказка
 * сверху, автодополнение снизу), и в этой паре стрелки принадлежат списку
 * пунктов. В VS Code это решает вес (у suggest он выше), у нас — `when`:
 * подсказка параметров весит больше suggest (PARAMETER_HINTS_WEIGHT), и без
 * `!suggestWidgetVisible` её стрелки перехватили бы список.
 */
const MULTIPLE_SIGNATURES = "parameterHintsVisible && parameterHintsMultipleSignatures && !suggestWidgetVisible";

/**
 * Показывает подсказку параметров для вызова под кареткой
 * (`editor.action.triggerParameterHints`). Обычно она открывается сама — по
 * триггер-символу сервера («(», «,»), — а команда нужна, когда каретку вернули
 * в уже написанный вызов.
 *
 * Основной бинд — чорд Ctrl+K Ctrl+Space: канонический VS Code-овский
 * Ctrl+Shift+Space на legacy-tier'е неотличим от Ctrl+Space (терминал шлёт тот
 * же байт 0x00), а Ctrl+Space уже занят `triggerSuggest` — то есть без чорда
 * фича осталась бы недоступной с клавиатуры там, где терминал не кодирует
 * модификаторы. Канонический бинд объявлен вторым и работает, где доезжает.
 *
 * Вторая клавиша чорда — именно Ctrl+Space: «как автодополнение, только про
 * параметры». Ctrl+K Ctrl+P занят палитрой команд (её legacy-фолбэк вместо
 * Ctrl+Shift+P), а Ctrl+K Ctrl+I недостижим на legacy — там Ctrl+I приезжает
 * байтом Tab.
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
 * Следующая перегрузка (`showNextParameterHint`). Down — канон VS Code, Alt+Down
 * объявлен вторым: с ним стрелка остаётся у редактора на терминалах, где
 * пользователь привык двигать каретку при открытых попапах.
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

/** Предыдущая перегрузка (`showPrevParameterHint`), зеркало предыдущей команды. */
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

/**
 * Закрывает подсказку по Escape (`closeParameterHints`); вес
 * PARAMETER_HINTS_WEIGHT перебивает removeSecondaryCursors и остальные попапы.
 */
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

/** Экшены подсказки параметров. Фича отдаёт их одним массивом; регистрирует агрегатор (`builtinActions`). */
export const PARAMETER_HINTS_ACTIONS: readonly CommandAction[] = [
    triggerParameterHintsAction,
    closeParameterHintsAction,
    showNextParameterHintAction,
    showPrevParameterHintAction,
];
