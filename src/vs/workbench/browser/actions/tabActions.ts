import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import type { ServiceAccessor } from "../../../platform/instantiation/common/diContainer.ts";
import { parseChord, parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../platform/keybinding/common/keybindingResolver.ts";
import { ModifierReleaseArmoryDIToken } from "../../../platform/keybinding/common/modifierReleaseArmory.ts";
import { EditorGroupsServiceDIToken } from "../../services/editor/common/editorGroupsService.ts";
import { EditorServiceDIToken } from "../../services/editor/common/editorService.ts";

import { resolveTabTarget } from "./editorTabTarget.ts";
import { editorTabIsPreview, editorTabTargetArg } from "./menuContexts.ts";

/** Beats editor line scrolling (upstream: WorkbenchContrib + 50; one step is enough). */
const TAB_SWITCHER_WEIGHT = KeybindingWeight.WorkbenchContrib;

/**
 * Releasing the held modifier commits the choice: quick presses toggle the two
 * most recent editors, holding walks deeper. From the menu and the command
 * palette there is no modifier, so the step runs without a hold session.
 */
function cycleMruStep(accessor: ServiceAccessor, direction: 1 | -1): void {
    const groups = accessor.get(EditorGroupsServiceDIToken);
    groups.activeGroup.cycleMru(direction);
    accessor.get(ModifierReleaseArmoryDIToken).armOnHoldRelease(() => {
        groups.activeGroup.endMruCycle();
    });
}

/**
 * Any tab of the editor area (text, diff, keybindings, extension page, terminal), not the
 * Explorer or the panel. Upstream has no gate (`when: undefined`); ours keeps tab keys away
 * from views that use them. Upstream lists tab commands in `commandsToSkipShell`, so in a
 * terminal tab they never reach the shell.
 */
const EDITOR_TABS_FOCUS = "editorAreaFocus";

/**
 * Visual order across all groups, wrapping around; no hold session. The Alt duplicate is for
 * terminals where Ctrl+PgUp/PgDn are taken by their own tabs (gnome-terminal).
 */
export const nextEditorAction: CommandAction = {
    id: "workbench.action.nextEditor",
    title: "Open Next Editor",
    shortTitle: "Next Editor",
    menus: [{ menuId: MenuId.MenubarGoMenu, group: "2_editors", order: 1 }],
    keybinding: parseKeybinding("ctrl+pagedown"),
    keybindings: [parseKeybinding("alt+pagedown")],
    when: EDITOR_TABS_FOCUS,
    run(accessor) {
        accessor.get(EditorGroupsServiceDIToken).cycleEditor(1);
    },
};

export const previousEditorAction: CommandAction = {
    id: "workbench.action.previousEditor",
    title: "Open Previous Editor",
    shortTitle: "Previous Editor",
    menus: [{ menuId: MenuId.MenubarGoMenu, group: "2_editors", order: 2 }],
    keybinding: parseKeybinding("ctrl+pageup"),
    keybindings: [parseKeybinding("alt+pageup")],
    when: EDITOR_TABS_FOCUS,
    run(accessor) {
        accessor.get(EditorGroupsServiceDIToken).cycleEditor(-1);
    },
};

/**
 * Direction is tied to the list, not to the side the series started from.
 * The Shift variants serve a Ctrl+Shift+Tab series: the modifier often stays held.
 * The gate separates them from `scrollLineUp`/`scrollLineDown` on the same Ctrl+Up/Down.
 */
const TAB_SWITCHER_ARROWS = "tabSwitcherVisible";

export const nextEditorInGroupAction: CommandAction = {
    id: "workbench.action.nextEditorInGroup",
    weight: TAB_SWITCHER_WEIGHT,
    title: "Next Editor In Group",
    shortTitle: "Next Used Editor",
    menus: [{ menuId: MenuId.MenubarGoMenu, group: "2_editors", order: 10 }],
    keybinding: parseKeybinding("ctrl+tab"),
    keybindings: [
        { keys: parseKeybinding("ctrl+down"), when: TAB_SWITCHER_ARROWS },
        { keys: parseKeybinding("ctrl+shift+down"), when: TAB_SWITCHER_ARROWS },
    ],
    when: "editorAreaFocus && editorTabsMultiple",
    run(accessor) {
        cycleMruStep(accessor, 1);
    },
};

export const previousEditorInGroupAction: CommandAction = {
    id: "workbench.action.previousEditorInGroup",
    weight: TAB_SWITCHER_WEIGHT,
    title: "Previous Editor In Group",
    shortTitle: "Previous Used Editor",
    menus: [{ menuId: MenuId.MenubarGoMenu, group: "2_editors", order: 20 }],
    keybinding: parseKeybinding("ctrl+shift+tab"),
    keybindings: [
        { keys: parseKeybinding("ctrl+up"), when: TAB_SWITCHER_ARROWS },
        { keys: parseKeybinding("ctrl+shift+up"), when: TAB_SWITCHER_ARROWS },
    ],
    when: "editorAreaFocus && editorTabsMultiple",
    run(accessor) {
        cycleMruStep(accessor, -1);
    },
};

/**
 * No hold session: the terminal reports modifier release only in the kitty
 * protocol. Ctrl+6 (0x1e) arrives even on legacy and matches Vim's Ctrl+^.
 */
export const openPreviousRecentlyUsedEditorInGroupAction: CommandAction = {
    id: "workbench.action.openPreviousRecentlyUsedEditorInGroup",
    title: "Open Previous Recently Used Editor In Group",
    shortTitle: "Alternate Editor",
    menus: [{ menuId: MenuId.MenubarGoMenu, group: "2_editors", order: 15 }],
    keybinding: parseKeybinding("ctrl+6"),
    // A terminal tab keeps Ctrl+6 for the shell.
    when: "editorAreaFocus && editorTabsMultiple && !terminalEditorFocus",
    run(accessor) {
        const group = accessor.get(EditorGroupsServiceDIToken).activeGroup;
        group.cycleMru(1);
        group.endMruCycle();
    },
};

/**
 * Not gated on "tab is a preview": for a pinned tab it is a no-op, and otherwise
 * the dispatcher would swallow Ctrl+K Enter on a regular tab for nothing.
 */
export const keepEditorAction: CommandAction = {
    id: "workbench.action.keepEditor",
    title: "Keep Editor",
    shortTitle: "Keep Open",
    menus: [
        {
            menuId: MenuId.EditorTitleContext,
            group: "3_preview",
            order: 10,
            args: editorTabTargetArg,
            visible: editorTabIsPreview,
        },
    ],
    keybinding: parseChord("ctrl+k enter"),
    // No focus gate: Explorer opens previews, so pinning works without leaving it.
    when: "editorGroupHasEditors",
    run(accessor, ...args) {
        const target = resolveTabTarget(accessor.get(EditorGroupsServiceDIToken), args);
        // The resolver has already validated the live target's index, so the pane needs no `null` guard.
        if (target === null) return;
        target.group.pinPane(target.group.getPanes()[target.index]);
    },
};

export const closeActiveEditorAction: CommandAction = {
    id: "workbench.action.closeActiveEditor",
    title: "Close Active Editor",
    shortTitle: "Close",
    menus: [
        { menuId: MenuId.MenubarFileMenu, group: "5_close", order: 10, title: "Close Editor" },
        { menuId: MenuId.EditorTitleContext, group: "1_close", order: 10, args: editorTabTargetArg },
    ],
    keybinding: parseKeybinding("mod+w"),
    // In a terminal tab Ctrl+W belongs to `workbench.action.terminal.killEditor` (closes and kills the process).
    when: "editorAreaFocus && editorGroupHasEditors && !terminalEditorFocus",
    run(accessor, ...args) {
        const service = accessor.get(EditorServiceDIToken);
        // From the menu, the tab UNDER THE POINTER (right-click does not activate it); otherwise the active one.
        const target = resolveTabTarget(accessor.get(EditorGroupsServiceDIToken), args);
        if (target === null) return;

        // By address, not the focus-aware `getActiveEditor()`: with focus in the panel it would
        // return Output (never modified), and a modified tab would close silently.
        void service.closeEditor(target.group, target.index);
    },
};
