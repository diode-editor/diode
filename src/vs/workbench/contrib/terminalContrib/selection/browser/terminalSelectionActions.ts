import type { CommandAction } from "../../../../../platform/actions/common/commandAction.ts";
import { parseKeybinding } from "../../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../../platform/keybinding/common/keybindingResolver.ts";
import { MODERN_TIER } from "../../../terminal/browser/terminalActions.ts";

import { TerminalSelectionServiceDIToken } from "./terminalSelectionService.ts";

/** Upstream precondition of the copy commands, without `terminalAvailable` (a terminal is always available here). */
const TEXT_SELECTED = "terminalTextSelectedInFocused || terminalTextSelected";
/** Upstream `when` of the copy keybindings. */
const TEXT_SELECTED_IN_FOCUS = "(terminalTextSelected && terminalFocus) || terminalTextSelectedInFocused";

// Upstream binds Ctrl+Shift+C on Linux and Windows. In the legacy key encoding it arrives as Ctrl+C, and host
// terminals usually take it for their own copy: Ctrl+C below is the way that always works. Bound only where Shift
// is encoded with Ctrl (kitty, CSI-u), like the other Ctrl+Shift+letter terminal bindings.
export const copySelectionAction: CommandAction = {
    id: "workbench.action.terminal.copySelection",
    title: "Terminal: Copy Selection",
    enablement: TEXT_SELECTED,
    keybindings: [{ keys: parseKeybinding("ctrl+shift+c"), when: `(${TEXT_SELECTED_IN_FOCUS}) && (${MODERN_TIER})` }],
    weight: KeybindingWeight.WorkbenchContrib,
    run(accessor) {
        return accessor.get(TerminalSelectionServiceDIToken).copySelection();
    },
};

// Ours: Ctrl+C on every platform, upstream binds it on Windows only. Without a selection the binding's `when` is
// false and Ctrl+C goes to the shell as SIGINT.
export const copyAndClearSelectionAction: CommandAction = {
    id: "workbench.action.terminal.copyAndClearSelection",
    title: "Terminal: Copy and Clear Selection",
    enablement: TEXT_SELECTED,
    keybindings: [{ keys: parseKeybinding("ctrl+c"), when: TEXT_SELECTED_IN_FOCUS }],
    weight: KeybindingWeight.WorkbenchContrib,
    async run(accessor) {
        const selection = accessor.get(TerminalSelectionServiceDIToken);
        await selection.copySelection();
        selection.clearSelection();
    },
};

// Upstream: Cmd+A on macOS only; Ctrl+A stays the shell's (start of the line).
export const selectAllAction: CommandAction = {
    id: "workbench.action.terminal.selectAll",
    title: "Terminal: Select All",
    enablement: "terminalHasBeenCreated",
    run(accessor) {
        accessor.get(TerminalSelectionServiceDIToken).selectAll();
    },
};

// Upstream `terminalFocusInAny && terminalTextSelected && !terminalFindVisible`: `terminalFocus` covers the panel and
// editor tabs alike, and there is no find widget in the terminal.
export const clearSelectionAction: CommandAction = {
    id: "workbench.action.terminal.clearSelection",
    title: "Terminal: Clear Selection",
    enablement: "terminalHasBeenCreated",
    keybindings: [{ keys: parseKeybinding("escape"), when: "terminalFocus && terminalTextSelected" }],
    weight: KeybindingWeight.WorkbenchContrib,
    run(accessor) {
        accessor.get(TerminalSelectionServiceDIToken).clearSelection();
    },
};

export const TERMINAL_SELECTION_ACTIONS: readonly CommandAction[] = [
    copySelectionAction,
    copyAndClearSelectionAction,
    selectAllAction,
    clearSelectionAction,
];
