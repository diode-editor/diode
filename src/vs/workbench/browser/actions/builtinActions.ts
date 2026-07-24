import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import {
    fileOpenAction,
    fileOpenFolderAction,
    fileSaveAction,
    fileSaveAsAction,
    newUntitledFileAction,
    toggleActiveEditorReadonlyInSessionAction,
} from "../../contrib/files/browser/fileActions.ts";
import {
    fileDeleteAction,
    fileRedoAction,
    fileRenameAction,
    fileUndoAction,
    refreshExplorerAction,
    showExplorerContextMenuAction,
} from "../../contrib/files/browser/fileTreeActions.ts";
import {
    fileCopyAction,
    fileCopyPathAction,
    fileCopyRelativePathAction,
    fileCutAction,
    filePasteAction,
} from "../../contrib/files/browser/fileTreeClipboardActions.ts";
import { explorerNewFileAction, explorerNewFolderAction } from "../../contrib/files/browser/fileTreeCreateActions.ts";
import {
    closeFindWidgetAction,
    findAction,
    nextMatchAction,
    previousMatchAction,
} from "../../contrib/find/browser/findActions.ts";
import { toggleOutputAction } from "../../contrib/output/browser/outputActions.ts";
import { openKeybindingsAction, openSettingsAction } from "../../contrib/preferences/browser/preferencesActions.ts";
import {
    gotoLineAction,
    quickOpenAction,
    showCommandsAction,
} from "../../contrib/quickaccess/browser/quickOpenActions.ts";
import { showScmAction } from "../../contrib/scm/browser/changesActions.ts";
import { compareWithHeadAction } from "../../contrib/scm/browser/compareWithHeadAction.ts";
import {
    acceptSelectedSuggestionAction,
    hideSuggestWidgetAction,
    selectNextPageSuggestionAction,
    selectNextSuggestionAction,
    selectPrevPageSuggestionAction,
    selectPrevSuggestionAction,
    triggerSuggestAction,
} from "../../contrib/suggest/browser/suggestActions.ts";
import { newTerminalAction, toggleTerminalAction } from "../../contrib/terminal/browser/terminalActions.ts";
import { selectThemeAction } from "../../contrib/themes/browser/themeActions.ts";

import { quitAction, showAboutDialogAction } from "./appActions.ts";
import { clipboardCopyAction, clipboardCutAction, clipboardPasteAction } from "./clipboardActions.ts";
import { showEditorContextMenuAction } from "./contextMenuActions.ts";
import {
    cursorBottomAction,
    cursorBottomSelectAction,
    cursorDownAction,
    cursorDownSelectAction,
    cursorEndAction,
    cursorEndSelectAction,
    cursorHomeAction,
    cursorHomeSelectAction,
    cursorLeftAction,
    cursorLeftSelectAction,
    cursorPageDownAction,
    cursorPageDownSelectAction,
    cursorPageUpAction,
    cursorPageUpSelectAction,
    cursorRightAction,
    cursorRightSelectAction,
    cursorTopAction,
    cursorTopSelectAction,
    cursorUpAction,
    cursorUpSelectAction,
    cursorWordLeftAction,
    cursorWordLeftSelectAction,
    cursorWordRightAction,
    cursorWordRightSelectAction,
    scrollLineDownAction,
    scrollLineUpAction,
} from "./editorActions.ts";
import {
    deleteLeftAction,
    deleteRightAction,
    deleteWordLeftAction,
    deleteWordRightAction,
    indentLinesAction,
    outdentLinesAction,
    redoAction,
    selectAllAction,
    undoAction,
} from "./editorEditActions.ts";
import { changeEncodingAction } from "./encodingActions.ts";
import { changeEolAction, convertToCrlfAction, convertToLfAction, toggleEolAction } from "./eolActions.ts";
import {
    foldAction,
    foldAllAction,
    foldLevelActions,
    foldRecursivelyAction,
    gotoNextFoldAction,
    gotoPreviousFoldAction,
    toggleFoldAction,
    unfoldAction,
    unfoldAllAction,
    unfoldRecursivelyAction,
} from "./foldingActions.ts";
import {
    inputCopyAction,
    inputCursorEndAction,
    inputCursorHomeAction,
    inputCursorLeftAction,
    inputCursorRightAction,
    inputCursorWordLeftAction,
    inputCursorWordRightAction,
    inputCutAction,
    inputDeleteLeftAction,
    inputDeleteRightAction,
    inputDeleteWordLeftAction,
    inputDeleteWordRightAction,
    inputPasteAction,
    inputRedoAction,
    inputSelectAllAction,
    inputSelectLeftAction,
    inputSelectRightAction,
    inputSelectToEndAction,
    inputSelectToHomeAction,
    inputSelectWordLeftAction,
    inputSelectWordRightAction,
    inputUndoAction,
} from "./inputActions.ts";
import {
    decreaseSidebarWidthAction,
    increaseSidebarWidthAction,
    resetSidebarWidthAction,
    revealActiveFileInExplorerAction,
    showExplorerAction,
    togglePanelAction,
    toggleProblemsAction,
    toggleSidebarAction,
} from "./layoutActions.ts";
import {
    listFocusFirstAction,
    listFocusLastAction,
    listFocusPageDownAction,
    listFocusPageUpAction,
} from "./listActions.ts";
import { closeActiveEditorAction, nextEditorInGroupAction, previousEditorInGroupAction } from "./tabActions.ts";
import { insertFinalNewLineAction, trimTrailingWhitespaceAction } from "./whitespaceActions.ts";

/**
 * Реестр встроенных экшенов Workbench'а. Регистрирует их владелец приложения
 * (`WorkbenchComponent`) единым циклом `registerAction`; ПОРЯДОК ВАЖЕН —
 * `KeybindingRegistry.resolveKey` берёт последний зарегистрированный биндинг с
 * проходящим `when` (см. комментарий у Find/Suggest-хвоста).
 */
export const builtinActions: readonly CommandAction[] = [
    // App
    fileSaveAction,
    fileSaveAsAction,
    newUntitledFileAction,
    fileOpenAction,
    fileOpenFolderAction,
    toggleActiveEditorReadonlyInSessionAction,
    openSettingsAction,
    openKeybindingsAction,
    showAboutDialogAction,
    quitAction,

    // Quick Open / пикеры (этап 8: run-обработчики живут в самих экшенах)
    quickOpenAction,
    showCommandsAction,
    gotoLineAction,
    selectThemeAction,
    changeEncodingAction,
    changeEolAction,

    // Cursor movement
    cursorLeftAction,
    cursorLeftSelectAction,
    cursorRightAction,
    cursorRightSelectAction,
    cursorUpAction,
    cursorUpSelectAction,
    cursorDownAction,
    cursorDownSelectAction,
    cursorHomeAction,
    cursorHomeSelectAction,
    cursorEndAction,
    cursorEndSelectAction,
    cursorTopAction,
    cursorTopSelectAction,
    cursorBottomAction,
    cursorBottomSelectAction,
    cursorWordLeftAction,
    cursorWordLeftSelectAction,
    cursorWordRightAction,
    cursorWordRightSelectAction,
    cursorPageDownAction,
    cursorPageDownSelectAction,
    cursorPageUpAction,
    cursorPageUpSelectAction,
    scrollLineUpAction,
    scrollLineDownAction,

    // Editing
    deleteLeftAction,
    deleteRightAction,
    deleteWordLeftAction,
    deleteWordRightAction,
    undoAction,
    redoAction,
    selectAllAction,
    indentLinesAction,
    outdentLinesAction,

    // End of line
    convertToLfAction,
    convertToCrlfAction,
    toggleEolAction,

    // Folding
    foldAction,
    unfoldAction,
    toggleFoldAction,
    foldAllAction,
    unfoldAllAction,
    foldRecursivelyAction,
    unfoldRecursivelyAction,
    ...foldLevelActions,
    gotoNextFoldAction,
    gotoPreviousFoldAction,

    // Whitespace
    trimTrailingWhitespaceAction,
    insertFinalNewLineAction,
    triggerSuggestAction,

    // Clipboard
    clipboardCopyAction,
    clipboardCutAction,
    clipboardPasteAction,

    // Context menu (Shift+F10)
    showEditorContextMenuAction,
    showExplorerContextMenuAction,

    // Explorer file operations (Workbench/Actions поверх Explorer/FileOperations-сервисов)
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

    // List
    listFocusPageDownAction,
    listFocusPageUpAction,
    listFocusFirstAction,
    listFocusLastAction,

    // Tabs
    nextEditorInGroupAction,
    previousEditorInGroupAction,
    closeActiveEditorAction,

    // Input widget
    inputCursorLeftAction,
    inputCursorRightAction,
    inputCursorHomeAction,
    inputCursorEndAction,
    inputCursorWordLeftAction,
    inputCursorWordRightAction,
    inputDeleteLeftAction,
    inputDeleteRightAction,
    inputDeleteWordLeftAction,
    inputDeleteWordRightAction,
    inputSelectLeftAction,
    inputSelectRightAction,
    inputSelectToHomeAction,
    inputSelectToEndAction,
    inputSelectWordLeftAction,
    inputSelectWordRightAction,
    inputSelectAllAction,
    inputCopyAction,
    inputCutAction,
    inputPasteAction,
    inputUndoAction,
    inputRedoAction,

    // Find / Suggest (этап 10: run-обработчики живут в самих экшенах поверх
    // FindService/CompletionService). Регистрируются ПОСЛЕДНИМИ, чтобы биндинги
    // `findWidgetVisible`/`suggestWidgetVisible` победили editor-команды
    // (cursorDown/indentLines и т.п.) — KeybindingRegistry.resolveKey берёт
    // последний зарегистрированный с проходящим `when`.
    findAction,
    nextMatchAction,
    previousMatchAction,
    closeFindWidgetAction,
    selectNextSuggestionAction,
    selectPrevSuggestionAction,
    selectNextPageSuggestionAction,
    selectPrevPageSuggestionAction,
    acceptSelectedSuggestionAction,
    hideSuggestWidgetAction,

    // Layout / Panel / Terminal (этап 11: run-обработчики поверх LayoutService/
    // PanelService/TerminalService). Ключи не пересекаются с editor/find/suggest-
    // биндингами, поэтому позиция после Find/Suggest-хвоста безопасна.
    toggleSidebarAction,
    showExplorerAction,
    revealActiveFileInExplorerAction,
    increaseSidebarWidthAction,
    decreaseSidebarWidthAction,
    resetSidebarWidthAction,
    togglePanelAction,
    toggleProblemsAction,
    toggleOutputAction,
    toggleTerminalAction,
    newTerminalAction,

    // SCM
    compareWithHeadAction,
    showScmAction,
];
