import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import { HoverServiceDIToken } from "./hoverService.ts";

/**
 * Показывает hover-попап для символа под кареткой (`editor.action.showHover`).
 * Дефолтный кейбинд — чорд Ctrl+K Ctrl+U при фокусе редактора, вторым идёт Alt+Q.
 *
 * Не VS Code-овский Ctrl+K Ctrl+I: на legacy-tier'е Ctrl+I приезжает тем же
 * байтом, что Tab (0x09), поэтому тот чорд там физически недостижим и вдобавок
 * занят legacy-фолбэком `insertCursorAtEndOfEachLineSelected`. Primary — чорд,
 * а не Alt+Q: именно primary показывается в палитре и меню, и подсказка должна
 * вести на бинд, который работает всегда. `alt+буква` намеренно
 * layout-sensitive (`code`-фолбэк только у ctrl/meta, см. keybindingRegistry),
 * то есть на кириллице Alt+Q молчит; на macOS Option по умолчанию не Meta
 * (Terminal.app напечатает `œ`), да и оконные менеджеры любят забирать
 * alt+букву себе. Alt+Q оставлен вторым биндом как одно нажатие для тех, у
 * кого он доезжает.
 *
 * Контент отдают hover-провайдеры расширений через `EditorService.hoverSource`.
 */
export const showHoverAction: CommandAction = {
    id: "editor.action.showHover",
    // Stryker disable next-line StringLiteral: заголовок команды виден только в палитре — подмена ненаблюдаема поведением
    title: "Show Hover",
    keybinding: parseChord("ctrl+k ctrl+u"),
    keybindings: [parseKeybinding("alt+q")],
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
