import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { explorerPathArg, viewMenuVisible } from "../../../browser/actions/menuContexts.ts";

import { EXPLORER_VIEW_ID, ExplorerComponentDIToken } from "./explorerComponent.ts";
import { ExplorerServiceDIToken } from "./explorerService.ts";
import { FileOperationsServiceDIToken } from "./fileOperationsService.ts";

/** nf-cod-refresh — inline-кнопка заголовка Explorer'а. */
const REFRESH_ICON = "\ueb37";

/**
 * Удаление файла/каталога из explorer'а: подтверждение + запись в историю отмены
 * (см. `FileOperationsService.requestDeleteFile`). Без аргумента берёт выбранный
 * в дереве путь.
 */
export const fileDeleteAction: CommandAction = {
    id: "fileOperations.deleteFile",
    title: "File: Delete",
    shortTitle: "Delete",
    keybinding: parseKeybinding("delete"),
    when: "listFocus",
    // Delete забинжен `delete`, но меню шортката не показывает — подавляем.
    menus: [{ menuId: MenuId.ExplorerContext, group: "4_modify", order: 20, args: explorerPathArg, shortcut: false }],
    run(accessor, filePath: unknown) {
        const target = (filePath as string | undefined) ?? accessor.get(ExplorerServiceDIToken).getSelectedPaths()[0];
        if (target) accessor.get(FileOperationsServiceDIToken).requestDeleteFile(target);
    },
};

/** Переименование файла/каталога (VS Code `renameFile`, F2) через промпт нового имени. */
export const fileRenameAction: CommandAction = {
    id: "fileOperations.rename",
    title: "File: Rename",
    shortTitle: "Rename...",
    keybinding: parseKeybinding("f2"),
    when: "listFocus",
    menus: [{ menuId: MenuId.ExplorerContext, group: "4_modify", order: 10, args: explorerPathArg }],
    run(accessor, filePath: unknown) {
        const target = (filePath as string | undefined) ?? accessor.get(ExplorerServiceDIToken).getSelectedPaths()[0];
        if (target) void accessor.get(FileOperationsServiceDIToken).runRename(target);
    },
};

/**
 * Перечитать содержимое дерева с диска (внешние изменения, которые live-watcher
 * мог пропустить — сетевые шары, игнорируемые пути). Без кейбиндинга: палитра
 * команд и контекстное меню дерева.
 */
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
        void accessor.get(ExplorerServiceDIToken).refresh();
    },
};

/** Отмена последней файловой операции (workspace-undo); деструктивную — переспрашивает. */
export const fileUndoAction: CommandAction = {
    id: "fileOperations.undo",
    title: "File: Undo",
    keybinding: parseKeybinding("ctrl+z"),
    when: "listFocus",
    run(accessor) {
        accessor.get(FileOperationsServiceDIToken).undoWorkspace();
    },
};

/** Повтор последней отменённой файловой операции (workspace-redo). */
export const fileRedoAction: CommandAction = {
    id: "fileOperations.redo",
    title: "File: Redo",
    keybindings: [parseKeybinding("ctrl+shift+z"), parseKeybinding("ctrl+y")],
    when: "listFocus",
    run(accessor) {
        accessor.get(FileOperationsServiceDIToken).redoWorkspace();
    },
};
