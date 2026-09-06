import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import { HoverServiceDIToken } from "./hoverService.ts";

/**
 * Показывает hover-попап для символа под кареткой (`editor.action.showHover`).
 * Дефолтный кейбинд — Ctrl+K Ctrl+X при фокусе редактора. Не VS Code-овский
 * Ctrl+K Ctrl+I: на legacy-tier'е Ctrl+I приезжает тем же байтом, что Tab
 * (0x09), поэтому тот чорд там физически недостижим и вдобавок занят
 * legacy-фолбэком `insertCursorAtEndOfEachLineSelected`. `ctrl+<буква>` вида
 * Ctrl+X доезжает на любом tier, так что фолбэк не нужен.
 *
 * Контент отдают hover-провайдеры расширений через `EditorService.hoverSource`.
 */
export const showHoverAction: CommandAction = {
    id: "editor.action.showHover",
    // Stryker disable next-line StringLiteral: заголовок команды виден только в палитре — подмена ненаблюдаема поведением
    title: "Show Hover",
    keybinding: parseChord("ctrl+k ctrl+x"),
    when: "textInputFocus",
    run(accessor) {
        void accessor.get(HoverServiceDIToken).showHover();
    },
};

/**
 * Закрывает hover-попап по Escape. Регистрируется ПОСЛЕ builtin editor-экшенов
 * (хвост builtinActions), чтобы победить removeSecondaryCursors при открытом
 * попапе (KeybindingRegistry.resolveKey: последний с проходящим `when` выигрывает).
 */
export const hideHoverAction: CommandAction = {
    id: "editor.action.hideHover",
    // Stryker disable next-line StringLiteral: заголовок команды виден только в палитре — подмена ненаблюдаема поведением
    title: "Hover: Close",
    keybinding: parseKeybinding("escape"),
    when: "editorHoverVisible",
    run(accessor) {
        accessor.get(HoverServiceDIToken).close();
    },
};
