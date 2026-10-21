import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";

import { HoverServiceDIToken } from "./hoverService.ts";

/** Escape при открытых hover и suggest закрывает hover; у upstream наоборот — docs/arch/workbench/Commands.md#коллизии-дефолтов. */
const HOVER_WEIGHT = KeybindingWeight.EditorContrib + 92;

/**
 * Чорд Ctrl+K Ctrl+U, а не эталонный Ctrl+K Ctrl+I: на legacy-tier'е Ctrl+I — тот же байт, что Tab.
 * Одиночный `alt+буква` не берём: alt layout-sensitive (молчит на кириллице), Option на macOS — не Meta.
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

/** Вес HOVER_WEIGHT — чтобы Escape перебил removeSecondaryCursors. */
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

export const HOVER_ACTIONS: readonly CommandAction[] = [showHoverAction, hideHoverAction];
