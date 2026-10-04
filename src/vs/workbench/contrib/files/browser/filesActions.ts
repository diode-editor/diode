import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";

import {
    fileOpenAction,
    fileOpenFolderAction,
    fileSaveAction,
    fileSaveAsAction,
    newUntitledFileAction,
    toggleActiveEditorReadonlyInSessionAction,
} from "./fileActions.ts";
import {
    fileDeleteAction,
    fileRedoAction,
    fileRenameAction,
    fileUndoAction,
    refreshExplorerAction,
} from "./fileTreeActions.ts";
import {
    fileCopyAction,
    fileCopyPathAction,
    fileCopyRelativePathAction,
    fileCutAction,
    filePasteAction,
} from "./fileTreeClipboardActions.ts";
import { explorerNewFileAction, explorerNewFolderAction } from "./fileTreeCreateActions.ts";

/**
 * Экшены фичи files одним массивом: файл (save/open/new) и операции дерева
 * Explorer (delete/rename/clipboard/create). Регистрирует агрегатор (`WORKBENCH_ACTIONS`).
 */
export const FILES_ACTIONS: readonly CommandAction[] = [
    fileSaveAction,
    fileSaveAsAction,
    newUntitledFileAction,
    fileOpenAction,
    fileOpenFolderAction,
    toggleActiveEditorReadonlyInSessionAction,
    fileDeleteAction,
    fileRenameAction,
    refreshExplorerAction,
    fileUndoAction,
    fileRedoAction,
    fileCopyAction,
    fileCutAction,
    filePasteAction,
    fileCopyPathAction,
    fileCopyRelativePathAction,
    explorerNewFileAction,
    explorerNewFolderAction,
];
