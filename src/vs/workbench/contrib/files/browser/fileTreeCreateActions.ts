import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { explorerPathArg, viewMenuVisible } from "../../../browser/actions/menuContexts.ts";

import { EXPLORER_VIEW_ID } from "./explorerComponent.ts";
import { FileOperationsServiceDIToken } from "./fileOperationsService.ts";

/** nf-cod-new_file — inline-кнопка заголовка Explorer'а. */
const NEW_FILE_ICON = "";
/** nf-cod-new_folder — она же для каталога. */
const NEW_FOLDER_ICON = "";

/**
 * Команды создания в explorer поверх `FileOperationsService.runCreate` (промпт
 * имени + обратимое создание). Без кейбиндингов: вызываются из контекст-меню
 * дерева и палитры команд, как `explorer.newFile`/`explorer.newFolder` в VS Code.
 * Под `listFocus`.
 */
export const explorerNewFileAction: CommandAction = {
    id: "explorer.newFile",
    title: "File: New File",
    shortTitle: "New File...",
    when: "listFocus",
    menus: [
        { menuId: MenuId.ExplorerContext, group: "1_new", order: 10, args: explorerPathArg },
        // В меню-баре и в заголовке контекст открытия не несёт пути — без args
        // (создание в корне воркспейса).
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
        void accessor.get(FileOperationsServiceDIToken).runCreate("file", args[0] as string | undefined);
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
        void accessor.get(FileOperationsServiceDIToken).runCreate("folder", args[0] as string | undefined);
    },
};
