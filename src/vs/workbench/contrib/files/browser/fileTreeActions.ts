import { codicon } from "../../../../base/common/codicons.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { explorerPathArg, viewMenuVisible } from "../../../browser/actions/menuContexts.ts";

import { EXPLORER_VIEW_ID, ExplorerComponentDIToken } from "./explorerComponent.ts";
import { ExplorerServiceDIToken } from "./explorerService.ts";
import { FileOperationsServiceDIToken } from "./fileOperationsService.ts";

/** Inline button in the Explorer header. */
const REFRESH_ICON = codicon("refresh");

export const fileDeleteAction: CommandAction = {
    id: "fileOperations.deleteFile",
    title: "File: Delete",
    shortTitle: "Delete",
    keybinding: parseKeybinding("delete"),
    when: "listFocus",
    // Delete is bound to `delete`, but the menu doesn't show the shortcut — suppress it.
    menus: [{ menuId: MenuId.ExplorerContext, group: "4_modify", order: 20, args: explorerPathArg, shortcut: false }],
    run(accessor, filePath: unknown) {
        const target = (filePath as string | undefined) ?? accessor.get(ExplorerServiceDIToken).getSelectedPaths()[0];
        if (target) accessor.get(FileOperationsServiceDIToken).requestDeleteFile(target);
    },
};

export const fileRenameAction: CommandAction = {
    id: "fileOperations.rename",
    title: "File: Rename",
    shortTitle: "Rename...",
    keybinding: parseKeybinding("f2"),
    when: "listFocus",
    menus: [{ menuId: MenuId.ExplorerContext, group: "4_modify", order: 10, args: explorerPathArg }],
    run(accessor, filePath: unknown) {
        const target = (filePath as string | undefined) ?? accessor.get(ExplorerServiceDIToken).getSelectedPaths()[0];
        if (target) return accessor.get(FileOperationsServiceDIToken).runRename(target);
    },
};

/** For external changes the live watcher may have missed (network shares, ignored paths). */
export const refreshExplorerAction: CommandAction = {
    id: "workbench.files.action.refreshFilesExplorer",
    title: "File: Refresh Explorer",
    shortTitle: "Refresh Explorer",
    menus: [
        { menuId: MenuId.ExplorerContext, group: "5_refresh", order: 10 },
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 30,
            icon: REFRESH_ICON,
            visible: viewMenuVisible(EXPLORER_VIEW_ID),
        },
    ],
    run(accessor) {
        return accessor.get(ExplorerServiceDIToken).refresh();
    },
};

export const fileUndoAction: CommandAction = {
    id: "fileOperations.undo",
    title: "File: Undo",
    keybinding: parseKeybinding("mod+z"),
    when: "listFocus",
    run(accessor) {
        accessor.get(FileOperationsServiceDIToken).undoWorkspace();
    },
};

export const fileRedoAction: CommandAction = {
    id: "fileOperations.redo",
    title: "File: Redo",
    keybindings: [parseKeybinding("mod+shift+z"), parseKeybinding("ctrl+y")],
    when: "listFocus",
    run(accessor) {
        accessor.get(FileOperationsServiceDIToken).redoWorkspace();
    },
};
