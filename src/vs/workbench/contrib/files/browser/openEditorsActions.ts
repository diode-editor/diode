import { codicon } from "../../../../base/common/codicons.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import type { IMenuContribution } from "../../../../platform/actions/common/iMenuContribution.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";
import { viewMenuVisible } from "../../../browser/actions/menuContexts.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";

import { OPEN_EDITORS_VIEW_ID, OpenEditorsViewDIToken } from "./openEditorsView.ts";

const HIDDEN_FROM_PALETTE = { menuId: MenuId.CommandPalette, when: "false" };

/**
 * Upstream's generated `<view id>.focus` command under its `focusCommand` id. No shortcut: upstream's
 * Ctrl+K E is Show Explorer here (the fallback for terminals without Ctrl+Shift+E).
 */
export const focusOpenEditorsViewAction: CommandAction = {
    id: "workbench.files.action.focusOpenEditorsView",
    title: "Explorer: Focus on Open Editors View",
    run(accessor) {
        // Shows the section if hidden, expands it and focuses the list.
        accessor.get(ViewsServiceDIToken).openView(OPEN_EDITORS_VIEW_ID, true);
    },
};

/** Upstream's title button (`openEditors.closeAll`), not in the palette. */
export const openEditorsCloseAllAction: CommandAction = {
    id: "openEditors.closeAll",
    title: "View: Close All Editors",
    shortTitle: "Close All Editors",
    menus: [
        HIDDEN_FROM_PALETTE,
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 30,
            icon: codicon("close-all"),
            visible: viewMenuVisible(OPEN_EDITORS_VIEW_ID),
        },
    ],
    run(accessor) {
        accessor.get(CommandRegistryDIToken).execute("workbench.action.closeAllEditors");
    },
};

/**
 * Delete on an editor row closes it. Not upstream: there the list has no Delete (only the row's × and
 * the middle click), but a keyboard user needs a way to close the row under the cursor. The weight of
 * upstream's Explorer commands (`WorkbenchContrib + 10`): the list is a `listFocus` too, and Explorer's
 * Delete File must not reach it.
 */
export const openEditorsCloseEditorAction: CommandAction = {
    id: "openEditors.closeEditor",
    title: "View: Close Editor in Open Editors",
    when: "openEditorsFocus && !inputWidgetFocus",
    keybinding: parseKeybinding("delete"),
    weight: KeybindingWeight.WorkbenchContrib + 10,
    menus: [HIDDEN_FROM_PALETTE],
    run(accessor) {
        const view = accessor.get(OpenEditorsViewDIToken);
        const element = view.getFocusedElement();
        if (element?.kind === "editor") view.closeEditor(element);
    },
};

export const OPEN_EDITORS_ACTIONS: readonly CommandAction[] = [
    focusOpenEditorsViewAction,
    openEditorsCloseAllAction,
    openEditorsCloseEditorAction,
];

/** Upstream registers Toggle Vertical/Horizontal Editor Layout on the section's title with two or more groups. */
export const OPEN_EDITORS_MENU_ITEMS: readonly IMenuContribution[] = [
    {
        menuId: MenuId.ViewTitle,
        command: "workbench.action.toggleEditorGroupLayout",
        title: "Toggle Vertical/Horizontal Editor Layout",
        group: "navigation",
        order: 10,
        icon: codicon("editor-layout"),
        when: "multipleEditorGroups",
        visible: viewMenuVisible(OPEN_EDITORS_VIEW_ID),
    },
];
