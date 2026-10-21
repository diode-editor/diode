import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import { parseChord, parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { EXPLORER_VIEWLET_ID } from "../../contrib/files/browser/explorerComponent.ts";
import { ExplorerServiceDIToken } from "../../contrib/files/browser/explorerService.ts";
import { PROBLEMS_VIEW_ID, ProblemsComponentDIToken } from "../../contrib/markers/browser/problemsComponent.ts";
import { EditorServiceDIToken } from "../../services/editor/common/editorService.ts";
import { LayoutServiceDIToken } from "../../services/layout/browser/layoutService.ts";
import { CLOSE_PANEL_COMMAND_ID } from "../parts/panel/panelComponent.ts";
import { SidebarServiceDIToken } from "../parts/sidebar/sidebarService.ts";
import { ViewsServiceDIToken } from "../parts/views/viewsService.ts";

import { editorTabIsFile, editorTabPathArg } from "./menuContexts.ts";

const SIDEBAR_WIDTH_STEP = 3;

export const toggleSidebarAction: CommandAction = {
    id: "workbench.action.toggleSidebarVisibility",
    title: "View: Toggle Primary Side Bar Visibility",
    shortTitle: "Toggle Primary Side Bar",
    menus: [{ menuId: MenuId.MenubarViewMenu, group: "3_views", order: 40 }],
    keybinding: parseKeybinding("mod+b"),
    run(accessor) {
        accessor.get(LayoutServiceDIToken).toggleSidebar();
    },
};

export const showExplorerAction: CommandAction = {
    id: "workbench.view.explorer",
    title: "View: Show Explorer",
    shortTitle: "Explorer",
    menus: [{ menuId: MenuId.MenubarViewMenu, group: "3_views", order: 10 }],
    // The leader chord is unconditional; the canonical Ctrl+Shift+E applies only where the terminal
    // delivers it: otherwise the menu hint would promise something broken.
    keybinding: parseChord("ctrl+k e"),
    keybindings: [{ keys: parseKeybinding("mod+shift+e"), when: "tier != 'legacy'" }],
    run(accessor) {
        accessor.get(SidebarServiceDIToken).showViewlet(EXPLORER_VIEWLET_ID);
    },
};

export const revealActiveFileInExplorerAction: CommandAction = {
    id: "workbench.files.action.showActiveFileInExplorer",
    title: "File: Reveal Active File in Explorer",
    shortTitle: "Reveal in Explorer View",
    menus: [
        {
            menuId: MenuId.EditorTitleContext,
            group: "4_reveal",
            order: 10,
            args: editorTabPathArg,
            visible: editorTabIsFile,
        },
    ],
    run(accessor, ...args) {
        // From the tab menu: the path of the tab under the pointer, not the active one.
        const filePath =
            (args[0] as string | undefined) ?? accessor.get(EditorServiceDIToken).getActiveEditor()?.absoluteFilePath;
        if (!filePath) return;
        accessor.get(SidebarServiceDIToken).showViewlet(EXPLORER_VIEWLET_ID);
        return accessor.get(ExplorerServiceDIToken).revealPath(filePath);
    },
};

// No default bindings, like VS Code's increase/decreaseViewWidth.
export const increaseSidebarWidthAction: CommandAction = {
    id: "workbench.action.increaseSidebarWidth",
    title: "View: Increase Side Bar Width",
    shortTitle: "Increase Side Bar Width",
    menus: [{ menuId: MenuId.MenubarViewMenu, group: "4_sidebar", order: 10 }],
    run(accessor) {
        accessor.get(LayoutServiceDIToken).nudgeSidebarWidth(SIDEBAR_WIDTH_STEP);
    },
};

export const decreaseSidebarWidthAction: CommandAction = {
    id: "workbench.action.decreaseSidebarWidth",
    title: "View: Decrease Side Bar Width",
    shortTitle: "Decrease Side Bar Width",
    menus: [{ menuId: MenuId.MenubarViewMenu, group: "4_sidebar", order: 20 }],
    run(accessor) {
        accessor.get(LayoutServiceDIToken).nudgeSidebarWidth(-SIDEBAR_WIDTH_STEP);
    },
};

export const resetSidebarWidthAction: CommandAction = {
    id: "workbench.action.resetSidebarWidth",
    title: "View: Reset Side Bar Width",
    shortTitle: "Reset Side Bar Width",
    menus: [{ menuId: MenuId.MenubarViewMenu, group: "4_sidebar", order: 30 }],
    run(accessor) {
        accessor.get(LayoutServiceDIToken).resetSidebarWidth();
    },
};

const PANEL_HEIGHT_STEP = 1;

/** Upstream's `workbench.action.increaseViewSize`; as there, no default binding. */
export const increaseViewSizeAction: CommandAction = {
    id: "workbench.action.increaseViewSize",
    title: "View: Increase Current View Size",
    run(accessor) {
        accessor.get(LayoutServiceDIToken).resizeFocusedPart(SIDEBAR_WIDTH_STEP, PANEL_HEIGHT_STEP);
    },
};

export const decreaseViewSizeAction: CommandAction = {
    id: "workbench.action.decreaseViewSize",
    title: "View: Decrease Current View Size",
    run(accessor) {
        accessor.get(LayoutServiceDIToken).resizeFocusedPart(-SIDEBAR_WIDTH_STEP, -PANEL_HEIGHT_STEP);
    },
};

export const togglePanelAction: CommandAction = {
    id: "workbench.action.togglePanel",
    title: "View: Toggle Panel Visibility",
    shortTitle: "Toggle Panel",
    menus: [{ menuId: MenuId.MenubarViewMenu, group: "3_views", order: 50 }],
    keybinding: parseKeybinding("mod+j"),
    run(accessor) {
        const layout = accessor.get(LayoutServiceDIToken);
        layout.setPanelVisible(!layout.isPanelVisible());
    },
};

/**
 * Separate from toggle, as in VS Code: the `×` button means "close", and
 * `enablement` on `panelVisible` disables it in the command palette while the panel is closed.
 */
export const closePanelAction: CommandAction = {
    id: CLOSE_PANEL_COMMAND_ID,
    title: "View: Close Panel",
    shortTitle: "Close Panel",
    enablement: "panelVisible",
    run(accessor) {
        accessor.get(LayoutServiceDIToken).setPanelVisible(false);
    },
};

export const toggleProblemsAction: CommandAction = {
    id: "workbench.actions.view.problems",
    title: "View: Toggle Problems (Errors, Warnings, Infos)",
    shortTitle: "Problems",
    menus: [{ menuId: MenuId.MenubarViewMenu, group: "3_views", order: 20 }],
    keybinding: parseChord("ctrl+k m"),
    keybindings: [{ keys: parseKeybinding("mod+shift+m"), when: "tier != 'legacy'" }],
    run(accessor) {
        // As VS Code: hide the part if Problems is already a visible view in it (wherever it was moved).
        const views = accessor.get(ViewsServiceDIToken);
        if (views.isViewShown(PROBLEMS_VIEW_ID)) {
            views.closeView(PROBLEMS_VIEW_ID);
        } else {
            views.openView(PROBLEMS_VIEW_ID);
            accessor.get(ProblemsComponentDIToken).focus();
        }
    },
};
