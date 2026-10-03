import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";

import { HoverServiceDIToken } from "./hoverService.ts";

/** Вес hover-попапа: при одновременно открытых hover и suggest Escape закрывает hover. Так было при порядке регистрации; у upstream наоборот (suggest + 90 сильнее hover) — расхождение записано в docs/TODO/KeybindingsEditor.md. */
const HOVER_WEIGHT = KeybindingWeight.EditorContrib + 92;

/**
 * Показывает hover-попап для символа под кареткой (`editor.action.showHover`).
 * Дефолтный кейбинд — чорд Ctrl+K Ctrl+U при фокусе редактора.
 *
 * Не VS Code-овский Ctrl+K Ctrl+I: на legacy-tier'е Ctrl+I приезжает тем же
 * байтом, что Tab (0x09), поэтому тот чорд там физически недостижим и вдобавок
 * занят legacy-фолбэком `insertCursorAtEndOfEachLineSelected`. Одиночный
 * `alt+буква` в дефолты не берём: `alt` намеренно layout-sensitive
 * (`code`-фолбэк только у ctrl/meta, см. keybindingRegistry), то есть на
 * кириллице такой бинд молчит, а на macOS Option по умолчанию не Meta.
 * Кому нужно одно нажатие — добавляет своё в `keybindings.json` профиля.
 *
 * Контент отдают hover-провайдеры расширений из реестра ядра `ILanguageFeaturesService.hoverProvider`.
 */
export const showHoverAction: CommandAction = {
    id: "editor.action.showHover",
    weight: HOVER_WEIGHT,
    // Stryker disable next-line StringLiteral: заголовок команды виден только в палитре — подмена ненаблюдаема поведением
    title: "Show Hover",
    keybinding: parseChord("ctrl+k ctrl+u"),
    when: "textInputFocus",
    run(accessor) {
        return accessor.get(HoverServiceDIToken).showHover();
    },
};

/** Закрывает hover-попап по Escape; вес HOVER_WEIGHT перебивает removeSecondaryCursors. */
export const hideHoverAction: CommandAction = {
    id: "editor.action.hideHover",
    weight: HOVER_WEIGHT,
    // Stryker disable next-line StringLiteral: заголовок команды виден только в палитре — подмена ненаблюдаема поведением
    title: "Hover: Close",
    keybinding: parseKeybinding("escape"),
    when: "editorHoverVisible",
    run(accessor) {
        accessor.get(HoverServiceDIToken).close();
    },
};
