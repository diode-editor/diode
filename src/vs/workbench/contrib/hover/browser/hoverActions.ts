import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import { HoverServiceDIToken } from "./hoverService.ts";

/**
 * Показывает hover-попап для символа под кареткой (`editor.action.showHover`).
 * Дефолтный кейбинд — Alt+Q при фокусе редактора, вторым идёт чорд Ctrl+K Ctrl+U.
 *
 * Не VS Code-овский Ctrl+K Ctrl+I: на legacy-tier'е Ctrl+I приезжает тем же
 * байтом, что Tab (0x09), поэтому тот чорд там физически недостижим и вдобавок
 * занят legacy-фолбэком `insertCursorAtEndOfEachLineSelected`. Alt+Q — одно
 * нажатие для команды, которую дёргают часто; на legacy-tier'е приезжает
 * ESC-префиксом, на csi-u — битом модификатора, то есть доезжает везде. Чорд
 * оставлен вторым биндом: на macOS Option по умолчанию не Meta (Terminal.app
 * напечатает `œ`), да и оконные менеджеры любят забирать alt+букву себе.
 *
 * Контент отдают hover-провайдеры расширений через `EditorService.hoverSource`.
 */
export const showHoverAction: CommandAction = {
    id: "editor.action.showHover",
    // Stryker disable next-line StringLiteral: заголовок команды виден только в палитре — подмена ненаблюдаема поведением
    title: "Show Hover",
    keybinding: parseKeybinding("alt+q"),
    keybindings: [parseChord("ctrl+k ctrl+u")],
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
