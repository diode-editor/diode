import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import { HoverServiceDIToken } from "./hoverService.ts";

/**
 * Показывает hover-попап для символа под кареткой (`editor.action.showHover`).
 * Дефолтный кейбинд — Ctrl+K Ctrl+I при фокусе редактора, как в VS Code.
 * Контент отдают hover-провайдеры расширений через `EditorService.hoverSource`.
 */
export const showHoverAction: CommandAction = {
    id: "editor.action.showHover",
    // Stryker disable next-line StringLiteral: заголовок команды виден только в палитре — подмена ненаблюдаема поведением
    title: "Show Hover",
    // Stryker disable next-line StringLiteral: на legacy-tier'е (в том числе в тестовой среде) Ctrl+I приезжает байтом Tab, поэтому основной VS Code-чорд проверить нечем — рабочий путь закрыт фолбэком строкой ниже
    keybinding: parseChord("ctrl+k ctrl+i"),
    // На legacy Ctrl+I неотличим от Tab (байт 0x09) — VS Code-чорд там
    // недостижим физически; фолбэк — та же прелюдия с голой `i` (паттерн
    // tier-гейта у insertCursorAtEndOfEachLineSelected).
    keybindings: [{ keys: parseChord("ctrl+k i"), when: "tier == 'legacy'" }],
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
