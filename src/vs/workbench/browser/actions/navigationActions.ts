import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import { parseChord, parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../platform/keybinding/common/keybindingResolver.ts";
import { HistoryServiceDIToken } from "../../services/history/browser/historyService.ts";

/**
 /**
  * Not VS Code's `1_history_nav`: groups sort as strings, and
  * `"1_goto" < "1_history_nav"` would push the navigation items below "Go to File".
  */
const HISTORY_GROUP = "0_history_nav";

/**
 * The canonical binding applies only where the terminal delivers it (on legacy Ctrl+Alt+-
 * is indistinguishable from Alt+-); Ctrl+K Ctrl+B works everywhere.
 *
 * The chord's second part has a modifier: the paired keypress is pinned to the target of
 * its keydown (`TuiApplication.pinnedKeypressTarget`), and the command switches the
 * tab — the target leaves the tree, and a bare character would be typed into the abandoned document.
 *
 * No `when` on purpose: without history it is a no-op, as in VS Code; and without a
 * focus-scoped key the step is correctly suppressed by a modal overlay.
 */
export const navigateBackAction: CommandAction = {
    id: "workbench.action.navigateBack",
    title: "Go Back",
    shortTitle: "Back",
    menus: [{ menuId: MenuId.MenubarGoMenu, group: HISTORY_GROUP, order: 10, when: "canNavigateBack" }],
    keybinding: parseChord("ctrl+k ctrl+b"),
    keybindings: [{ keys: parseKeybinding("ctrl+alt+-"), when: "tier != 'legacy'" }],
    run(accessor) {
        accessor.get(HistoryServiceDIToken).goBack();
    },
};

export const navigateForwardAction: CommandAction = {
    id: "workbench.action.navigateForward",
    // The Ctrl+K Ctrl+F chord is shared with the pc binding of `editor.action.formatSelection` and currently wins over it (the collision is recorded in docs/arch/workbench/Commands.md#коллизии-дефолтов). The weight keeps this behavior until the collision is resolved.
    weight: KeybindingWeight.WorkbenchContrib,
    title: "Go Forward",
    shortTitle: "Forward",
    menus: [{ menuId: MenuId.MenubarGoMenu, group: HISTORY_GROUP, order: 20, when: "canNavigateForward" }],
    keybinding: parseChord("ctrl+k ctrl+f"),
    keybindings: [{ keys: parseKeybinding("ctrl+shift+-"), when: "tier != 'legacy'" }],
    run(accessor) {
        accessor.get(HistoryServiceDIToken).goForward();
    },
};
