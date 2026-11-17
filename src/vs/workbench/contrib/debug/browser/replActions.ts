// The Debug Console's commands with upstream's ids, titles, keys and `when` (`debug.contribution.ts`, `repl.ts`).
// Deviations: Ctrl+Shift+Y reaches only terminals with extended keys, Ctrl+K Y toggles the console everywhere (as
// Ctrl+K M for Problems); Enter in the input is the input's own key (it calls `repl.action.acceptInput`'s method), and
// Clear Console has no key: upstream binds Cmd+K on macOS only. Focus Filter's Ctrl+F is bound in the console (its
// precondition) rather than in any text input: the console's input is its only one. Collapse All has no context menu
// to sit in yet (#1158): a command only.

import { codicon } from "../../../../base/common/codicons.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { ClipboardDIToken } from "../../../../platform/clipboard/common/iClipboard.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";
import { viewMenuVisible } from "../../../browser/actions/menuContexts.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { REPL_VIEW_ID } from "../common/debug.ts";

import { ReplDIToken } from "./repl.ts";

export const TOGGLE_REPL_ID = "workbench.debug.action.toggleRepl";
export const FOCUS_REPL_ID = "workbench.debug.action.focusRepl";
export const ACCEPT_REPL_INPUT_ID = "repl.action.acceptInput";
export const CLEAR_REPL_ID = "workbench.debug.panel.action.clearReplAction";
export const FILTER_REPL_ID = "repl.action.filter";
export const COPY_ALL_REPL_ID = "repl.action.copyAll";
export const COLLAPSE_REPL_ID = "debug.collapseRepl";

export const toggleReplAction: CommandAction = {
    id: TOGGLE_REPL_ID,
    title: "View: Toggle Debug Console",
    shortTitle: "Debug Console",
    // Upstream: between Output and Terminal.
    menus: [{ menuId: MenuId.MenubarViewMenu, group: "3_views", order: 30.5 }],
    keybinding: parseChord("ctrl+k y"),
    keybindings: [{ keys: parseKeybinding("mod+shift+y"), when: "tier != 'legacy'" }],
    run(accessor) {
        // Shown and hidden where it is: the console may have been moved out of the panel.
        const views = accessor.get(ViewsServiceDIToken);
        if (views.isViewShown(REPL_VIEW_ID)) {
            views.closeView(REPL_VIEW_ID);
            return;
        }
        views.openView(REPL_VIEW_ID, true);
    },
};

export const focusReplAction: CommandAction = {
    id: FOCUS_REPL_ID,
    title: "Debug: Focus on Debug Console View",
    run(accessor) {
        accessor.get(ViewsServiceDIToken).openView(REPL_VIEW_ID, true);
    },
};

export const acceptReplInputAction: CommandAction = {
    id: ACCEPT_REPL_INPUT_ID,
    title: "Debug Console: Accept Input",
    enablement: "inDebugRepl",
    run(accessor) {
        accessor.get(ReplDIToken).acceptReplInput();
    },
};

export const clearReplAction: CommandAction = {
    id: CLEAR_REPL_ID,
    title: "Clear Console",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 30,
            icon: codicon("clear-all"),
            visible: viewMenuVisible(REPL_VIEW_ID),
        },
    ],
    run(accessor) {
        accessor.get(ReplDIToken).clearRepl();
    },
};

export const filterReplAction: CommandAction = {
    id: FILTER_REPL_ID,
    title: "Debug Console: Focus Filter",
    enablement: "inDebugRepl",
    // Over the editor's Find (same weight upstream, decided there by the registration order): in the console Ctrl+F filters.
    keybindings: [{ keys: parseKeybinding("mod+f"), when: "inDebugRepl", weight: KeybindingWeight.EditorContrib + 1 }],
    run(accessor) {
        accessor.get(ReplDIToken).focusFilter();
    },
};

export const copyAllReplAction: CommandAction = {
    id: COPY_ALL_REPL_ID,
    title: "Debug: Console Copy All",
    enablement: "inDebugRepl",
    async run(accessor) {
        await accessor.get(ClipboardDIToken).writeText(accessor.get(ReplDIToken).getVisibleContent());
    },
};

export const collapseReplAction: CommandAction = {
    id: COLLAPSE_REPL_ID,
    title: "Collapse All",
    run(accessor) {
        const repl = accessor.get(ReplDIToken);
        repl.collapseAll();
        repl.focus();
    },
};

export const REPL_ACTIONS: readonly CommandAction[] = [
    toggleReplAction,
    focusReplAction,
    acceptReplInputAction,
    // Upstream's order in repl.ts.
    copyAllReplAction,
    filterReplAction,
    clearReplAction,
    collapseReplAction,
];
