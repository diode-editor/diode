import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import { parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { EXPLORER_VIEWLET_ID } from "../../contrib/files/browser/explorerComponent.ts";
import { ExplorerServiceDIToken } from "../../contrib/files/browser/explorerService.ts";
import { PROBLEMS_VIEW_ID, ProblemsComponentDIToken } from "../../contrib/markers/browser/problemsComponent.ts";
import { EditorServiceDIToken } from "../../services/editor/browser/editorService.ts";
import { LayoutServiceDIToken } from "../../services/layout/browser/layoutService.ts";
import { PanelServiceDIToken } from "../parts/panel/panelService.ts";
import { SidebarServiceDIToken } from "../parts/sidebar/sidebarService.ts";

// Columns added/removed per increase/decrease Side Bar Width command.
const SIDEBAR_WIDTH_STEP = 3;

export const toggleSidebarAction: CommandAction = {
    id: "workbench.action.toggleSidebarVisibility",
    title: "View: Toggle Primary Side Bar Visibility",
    shortTitle: "Toggle Primary Side Bar",
    menus: [{ menuId: MenuId.MenubarViewMenu, group: "3_views", order: 40 }],
    keybinding: parseKeybinding("ctrl+b"),
    run(accessor) {
        accessor.get(LayoutServiceDIToken).toggleSidebar();
    },
};

export const showExplorerAction: CommandAction = {
    id: "workbench.view.explorer",
    title: "View: Show Explorer",
    shortTitle: "Explorer",
    menus: [{ menuId: MenuId.MenubarViewMenu, group: "3_views", order: 10 }],
    keybinding: parseKeybinding("ctrl+shift+e"),
    run(accessor) {
        accessor.get(SidebarServiceDIToken).showViewlet(EXPLORER_VIEWLET_ID);
    },
};

export const revealActiveFileInExplorerAction: CommandAction = {
    id: "workbench.files.action.showActiveFileInExplorer",
    title: "File: Reveal Active File in Explorer",
    run(accessor) {
        const filePath = accessor.get(EditorServiceDIToken).getActiveEditor()?.absoluteFilePath;
        if (!filePath) return;
        accessor.get(SidebarServiceDIToken).showViewlet(EXPLORER_VIEWLET_ID);
        void accessor.get(ExplorerServiceDIToken).revealPath(filePath);
    },
};

// Side bar width: palette-only, no default keybindings (matching VS Code's
// increase/decreaseViewWidth). Users can bind them via keybindings.json.
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

// Bottom Panel (Problems/Output/…) visibility.
export const togglePanelAction: CommandAction = {
    id: "workbench.action.togglePanel",
    title: "View: Toggle Panel Visibility",
    shortTitle: "Toggle Panel",
    menus: [{ menuId: MenuId.MenubarViewMenu, group: "3_views", order: 50 }],
    keybinding: parseKeybinding("ctrl+j"),
    run(accessor) {
        const layout = accessor.get(LayoutServiceDIToken);
        layout.setPanelVisible(!layout.isPanelVisible());
    },
};

export const toggleProblemsAction: CommandAction = {
    id: "workbench.actions.view.problems",
    title: "View: Toggle Problems (Errors, Warnings, Infos)",
    shortTitle: "Problems",
    menus: [{ menuId: MenuId.MenubarViewMenu, group: "3_views", order: 20 }],
    keybinding: parseKeybinding("ctrl+shift+m"),
    run(accessor) {
        // Toggle like VS Code: show + focus Problems, or hide the panel if
        // Problems is already the visible view.
        const layout = accessor.get(LayoutServiceDIToken);
        const panel = accessor.get(PanelServiceDIToken);
        const showing = layout.isPanelVisible() && panel.getActiveViewId() === PROBLEMS_VIEW_ID;
        if (showing) {
            layout.setPanelVisible(false);
        } else {
            panel.setActiveView(PROBLEMS_VIEW_ID);
            layout.setPanelVisible(true);
            accessor.get(ProblemsComponentDIToken).focus();
        }
    },
};
