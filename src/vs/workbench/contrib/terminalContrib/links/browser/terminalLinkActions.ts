import type { CommandAction } from "../../../../../platform/actions/common/commandAction.ts";
import type { ServiceAccessor } from "../../../../../platform/instantiation/common/diContainer.ts";
import { parseKeybinding } from "../../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../../platform/keybinding/common/keybindingResolver.ts";
import { MODERN_TIER } from "../../../terminal/browser/terminalActions.ts";
import { type ITerminalInstance, TerminalServiceDIToken } from "../../../terminal/browser/terminalService.ts";

import { TerminalLinkQuickpickDIToken } from "./terminalLinkQuickpick.ts";
import { TerminalLinkServiceDIToken } from "./terminalLinkService.ts";

/** Upstream `registerActiveInstanceAction`: the terminal last active in the panel or in an editor tab. */
function activeInstance(accessor: ServiceAccessor): ITerminalInstance | null {
    return accessor.get(TerminalServiceDIToken).getActiveInstanceAcrossHosts();
}

// Ctrl+Shift+O exists only where Shift is encoded with Ctrl (kitty, CSI-u). In legacy it arrives as Ctrl+O
// and stays the shell's (bash operate-and-get-next): the command is in the palette there.
export const openDetectedLinkAction: CommandAction = {
    id: "workbench.action.terminal.openDetectedLink",
    title: "Terminal: Open Detected Link...",
    enablement: "terminalHasBeenCreated",
    keybindings: [{ keys: parseKeybinding("ctrl+shift+o"), when: `terminalFocus && (${MODERN_TIER})` }],
    weight: KeybindingWeight.WorkbenchContrib + 1,
    run(accessor) {
        const instance = activeInstance(accessor);
        if (instance === null) return undefined;
        return accessor.get(TerminalLinkQuickpickDIToken).show(instance);
    },
};

export const openFileLinkAction: CommandAction = {
    id: "workbench.action.terminal.openFileLink",
    title: "Terminal: Open Last Local File Link",
    enablement: "terminalHasBeenCreated",
    run(accessor) {
        const instance = activeInstance(accessor);
        if (instance === null) return undefined;
        return accessor.get(TerminalLinkServiceDIToken).openRecentLink(instance);
    },
};

export const TERMINAL_LINK_ACTIONS: readonly CommandAction[] = [openDetectedLinkAction, openFileLinkAction];
