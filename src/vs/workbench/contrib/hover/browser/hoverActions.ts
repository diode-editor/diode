import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";

import { HoverServiceDIToken } from "./hoverService.ts";

/** Escape with both hover and suggest open closes the hover; upstream does the opposite, see docs/arch/workbench/Commands.md#коллизии-дефолтов. */
const HOVER_WEIGHT = KeybindingWeight.EditorContrib + 92;

/**
 * Chord Ctrl+K Ctrl+U, not upstream's Ctrl+K Ctrl+I: on the legacy tier Ctrl+I is the same byte as Tab.
 * A single `alt+letter` is avoided: alt is layout-sensitive (silent on a Cyrillic layout), and Option on macOS isn't Meta.
 */
export const showHoverAction: CommandAction = {
    id: "editor.action.showHover",
    weight: HOVER_WEIGHT,
    // Stryker disable next-line StringLiteral: the command title is visible only in the command palette, so the substitution is unobservable by behavior
    title: "Show Hover",
    keybinding: parseChord("ctrl+k ctrl+u"),
    when: "textInputFocus",
    run(accessor) {
        return accessor.get(HoverServiceDIToken).showHover();
    },
};

/** HOVER_WEIGHT so Escape beats removeSecondaryCursors. */
export const hideHoverAction: CommandAction = {
    id: "editor.action.hideHover",
    weight: HOVER_WEIGHT,
    // Stryker disable next-line StringLiteral: the command title is visible only in the command palette, so the substitution is unobservable by behavior
    title: "Hover: Close",
    keybinding: parseKeybinding("escape"),
    when: "editorHoverVisible",
    run(accessor) {
        accessor.get(HoverServiceDIToken).close();
    },
};

export const HOVER_ACTIONS: readonly CommandAction[] = [showHoverAction, hideHoverAction];
