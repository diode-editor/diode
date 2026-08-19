import * as path from "node:path";

import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import {
    editorTabIsFile,
    editorTabPathArg,
    explorerCanPaste,
    explorerPathArg,
} from "../../../browser/actions/menuContexts.ts";
import { ClipboardDIToken } from "../../../common/coreTokens.ts";

import { ExplorerServiceDIToken } from "./explorerService.ts";
import { FileOperationsServiceDIToken } from "./fileOperationsService.ts";

/**
 * Команды copy/cut/paste для explorer поверх `FileOperationsService` (файловый
 * буфер + обратимые правки). Все под `listFocus`, так что ctrl+c/x/v не
 * конфликтуют с редакторскими (те под `textInputFocus`).
 */
export const fileCopyAction: CommandAction = {
    id: "fileOperations.copy",
    title: "File: Copy",
    shortTitle: "Copy",
    keybinding: parseKeybinding("ctrl+c"),
    when: "listFocus",
    menus: [{ menuId: MenuId.ExplorerContext, group: "2_clipboard", order: 10 }],
    run(accessor) {
        accessor.get(FileOperationsServiceDIToken).copySelected();
    },
};

export const fileCutAction: CommandAction = {
    id: "fileOperations.cut",
    title: "File: Cut",
    shortTitle: "Cut",
    keybinding: parseKeybinding("ctrl+x"),
    when: "listFocus",
    menus: [{ menuId: MenuId.ExplorerContext, group: "2_clipboard", order: 20 }],
    run(accessor) {
        accessor.get(FileOperationsServiceDIToken).cutSelected();
    },
};

export const filePasteAction: CommandAction = {
    id: "fileOperations.paste",
    title: "File: Paste",
    shortTitle: "Paste",
    keybinding: parseKeybinding("ctrl+v"),
    when: "listFocus",
    menus: [{ menuId: MenuId.ExplorerContext, group: "2_clipboard", order: 30, visible: explorerCanPaste }],
    run(accessor) {
        accessor.get(FileOperationsServiceDIToken).paste();
    },
};

/**
 * Копирует полный (абсолютный) путь выбранного файла в системный буфер обмена.
 * Байнд VS Code — Shift+Alt+C (специально не Ctrl+*, чтобы не схлопнуться с
 * `fileOperations.copy` на Ctrl+C в legacy-терминалах).
 */
export const fileCopyPathAction: CommandAction = {
    id: "fileOperations.copyPath",
    title: "File: Copy Path",
    shortTitle: "Copy Path",
    keybinding: parseKeybinding("shift+alt+c"),
    when: "listFocus",
    menus: [
        { menuId: MenuId.ExplorerContext, group: "3_copypath", order: 10, args: explorerPathArg },
        {
            menuId: MenuId.EditorTitleContext,
            group: "3_copypath",
            order: 10,
            args: editorTabPathArg,
            visible: editorTabIsFile,
        },
    ],
    run(accessor, ...args) {
        const filePath = (args[0] as string | undefined) ?? accessor.get(ExplorerServiceDIToken).getSelectedPaths()[0];
        if (filePath) void accessor.get(ClipboardDIToken).writeText(filePath);
    },
};

/**
 * Копирует путь выбранного файла относительно корня workspace в системный буфер обмена.
 * Байнд VS Code — аккорд Ctrl+K Ctrl+Shift+C; в legacy-терминалах вторая часть
 * не различает Shift, поэтому там fallback на Ctrl+K Ctrl+C.
 */
export const fileCopyRelativePathAction: CommandAction = {
    id: "fileOperations.copyRelativePath",
    title: "File: Copy Relative Path",
    shortTitle: "Copy Relative Path",
    keybinding: parseChord("ctrl+k ctrl+shift+c"),
    keybindings: [{ keys: parseChord("ctrl+k ctrl+c"), when: "tier == 'legacy'" }],
    when: "listFocus",
    menus: [
        { menuId: MenuId.ExplorerContext, group: "3_copypath", order: 20, args: explorerPathArg },
        {
            menuId: MenuId.EditorTitleContext,
            group: "3_copypath",
            order: 20,
            args: editorTabPathArg,
            visible: editorTabIsFile,
        },
    ],
    run(accessor, ...args) {
        const explorer = accessor.get(ExplorerServiceDIToken);
        const filePath = (args[0] as string | undefined) ?? explorer.getSelectedPaths()[0];
        if (!filePath) return;
        const root = explorer.getRootPath();
        const relative = root ? path.relative(root, filePath) : filePath;
        void accessor.get(ClipboardDIToken).writeText(relative);
    },
};
