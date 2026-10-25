import { codicon } from "../../../../base/common/codicons.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { explorerPathArg, viewMenuVisible } from "../../../browser/actions/menuContexts.ts";

import { EXPLORER_VIEW_ID } from "./explorerComponent.ts";
import { FileOperationsServiceDIToken } from "./fileOperationsService.ts";

/** Inline buttons in the Explorer header. */
const NEW_FILE_ICON = codicon("new-file");
const NEW_FOLDER_ICON = codicon("new-folder");

/** No keybindings, like `explorer.newFile`/`explorer.newFolder` in VS Code. */
export const explorerNewFileAction: CommandAction = {
    id: "explorer.newFile",
    title: "File: New File",
    shortTitle: "New File...",
    when: "listFocus",
    menus: [
        { menuId: MenuId.ExplorerContext, group: "1_new", order: 10, args: explorerPathArg },
        // In the menu bar and the header the opening context carries no path — no args
        // (creates in the workspace root).
        { menuId: MenuId.MenubarFileMenu, group: "1_new", order: 20 },
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 10,
            icon: NEW_FILE_ICON,
            visible: viewMenuVisible(EXPLORER_VIEW_ID),
        },
    ],
    run(accessor, ...args) {
        return accessor.get(FileOperationsServiceDIToken).runCreate("file", args[0] as string | undefined);
    },
};

export const explorerNewFolderAction: CommandAction = {
    id: "explorer.newFolder",
    title: "File: New Folder",
    shortTitle: "New Folder...",
    when: "listFocus",
    menus: [
        { menuId: MenuId.ExplorerContext, group: "1_new", order: 20, args: explorerPathArg },
        { menuId: MenuId.MenubarFileMenu, group: "1_new", order: 30 },
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 20,
            icon: NEW_FOLDER_ICON,
            visible: viewMenuVisible(EXPLORER_VIEW_ID),
        },
    ],
    run(accessor, ...args) {
        return accessor.get(FileOperationsServiceDIToken).runCreate("folder", args[0] as string | undefined);
    },
};
