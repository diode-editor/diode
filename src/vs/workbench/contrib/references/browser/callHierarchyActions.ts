import { codicon } from "../../../../base/common/codicons.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { viewMenuVisible } from "../../../browser/actions/menuContexts.ts";

import { CallHierarchyComponentDIToken } from "./callHierarchyComponent.ts";
import { HIERARCHY_VIEW_ID } from "./hierarchyComponent.ts";

/**
 * Ids, titles and the key are upstream's `references-view`. A legacy terminal can't deliver the key and the chord
 * `ctrl+k ctrl+h` is Output's, so there it's the context menu and the palette.
 */
export const showCallHierarchyAction: CommandAction = {
    id: "references-view.showCallHierarchy",
    title: "Show Call Hierarchy",
    when: "editorHasCallHierarchyProvider",
    keybindings: [
        {
            keys: parseKeybinding("shift+alt+h"),
            when: "textInputFocus && editorHasCallHierarchyProvider && tier != 'legacy'",
        },
    ],
    menus: [{ menuId: MenuId.EditorContext, group: "navigation", order: 1.46, when: "editorHasCallHierarchyProvider" }],
    run(accessor) {
        return accessor.get(CallHierarchyComponentDIToken).show();
    },
};

/** A pair in one title slot: the icon shows the current direction, the command switches away from it. */
export const showOutgoingCallsAction: CommandAction = {
    id: "references-view.showOutgoingCalls",
    title: "Show Outgoing Calls",
    when: "callHierarchyVisible",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 10,
            icon: codicon("call-incoming"),
            visible: viewMenuVisible(HIERARCHY_VIEW_ID),
            // The section is shared with the type tree: the mode alone would show this over types too.
            when: "callHierarchyVisible && callHierarchyMode == 'incoming'",
        },
    ],
    run(accessor) {
        return accessor.get(CallHierarchyComponentDIToken).setDirection("outgoing");
    },
};

export const showIncomingCallsAction: CommandAction = {
    id: "references-view.showIncomingCalls",
    title: "Show Incoming Calls",
    when: "callHierarchyVisible",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 10,
            icon: codicon("call-outgoing"),
            visible: viewMenuVisible(HIERARCHY_VIEW_ID),
            when: "callHierarchyVisible && callHierarchyMode == 'outgoing'",
        },
    ],
    run(accessor) {
        return accessor.get(CallHierarchyComponentDIToken).setDirection("incoming");
    },
};

/** Upstream puts it on a row; here it clears the tree, so it lives in the title. */
export const removeCallItemAction: CommandAction = {
    id: "references-view.removeCallItem",
    title: "Dismiss",
    when: "callHierarchyVisible",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 20,
            icon: codicon("close"),
            visible: viewMenuVisible(HIERARCHY_VIEW_ID),
            when: "callHierarchyVisible",
        },
        // As upstream: otherwise the palette lists two "Dismiss" rows, and the other tree's one does nothing.
        { menuId: MenuId.CommandPalette, when: "false" },
    ],
    run(accessor) {
        accessor.get(CallHierarchyComponentDIToken).dismiss();
    },
};

export const CALL_HIERARCHY_ACTIONS: readonly CommandAction[] = [
    showCallHierarchyAction,
    showOutgoingCallsAction,
    showIncomingCallsAction,
    removeCallItemAction,
];
