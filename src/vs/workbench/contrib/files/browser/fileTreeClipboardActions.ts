import * as path from "node:path";

import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { ClipboardDIToken } from "../../../../platform/clipboard/common/iClipboard.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { IWorkspaceContextServiceDIToken } from "../../../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import {
    editorTabIsFile,
    editorTabPathArg,
    explorerCanPaste,
    explorerPathArg,
} from "../../../browser/actions/menuContexts.ts";

import { ExplorerServiceDIToken } from "./explorerService.ts";
import { FileOperationsServiceDIToken } from "./fileOperationsService.ts";

/** All under `listFocus`, so ctrl+c/x/v don't clash with the editor's (those are under `textInputFocus`). */
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
        return accessor.get(FileOperationsServiceDIToken).paste();
    },
};

/**
 * VS Code binds Shift+Alt+C; without extended keys the terminal doesn't pass Shift under Alt, so an
 * unconditional Ctrl+K Alt+C sits next to it (paired with copyRelativePath's Ctrl+K Ctrl+C).
 */
export const fileCopyPathAction: CommandAction = {
    id: "fileOperations.copyPath",
    title: "File: Copy Path",
    shortTitle: "Copy Path",
    keybinding: parseChord("ctrl+k alt+c"),
    keybindings: [{ keys: parseKeybinding("shift+alt+c"), when: "tier != 'legacy'" }],
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
        if (filePath) return accessor.get(ClipboardDIToken).writeText(filePath);
    },
};

/** Without extended keys the second part of the Ctrl+K Ctrl+Shift+C chord can't tell Shift apart — hence the Ctrl+K Ctrl+C fallback. */
export const fileCopyRelativePathAction: CommandAction = {
    id: "fileOperations.copyRelativePath",
    title: "File: Copy Relative Path",
    shortTitle: "Copy Relative Path",
    keybinding: parseChord("ctrl+k ctrl+shift+c"),
    keybindings: [parseChord("ctrl+k ctrl+c")],
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
        // `folders.at(0)` narrows to a single folder (in multi-root the base is the file's folder, stage F in docs/TODO/MultiRoot.md).
        const root = accessor.get(IWorkspaceContextServiceDIToken).getWorkspace().folders.at(0)?.uri.fsPath;
        const relative = root === undefined ? filePath : path.relative(root, filePath);
        return accessor.get(ClipboardDIToken).writeText(relative);
    },
};
