import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { CODE_ACTION_ACTIONS } from "../../contrib/codeAction/browser/codeActionActions.ts";
import { COMMENT_ACTIONS } from "../../contrib/comment/browser/commentActions.ts";
import { COMPARE_ACTIONS } from "../../contrib/diff/browser/compareActions.ts";
import { EXTENSIONS_ACTIONS } from "../../contrib/extensions/browser/extensionsActions.ts";
import { FILES_ACTIONS } from "../../contrib/files/browser/filesActions.ts";
import { FIND_ACTIONS } from "../../contrib/find/browser/findActions.ts";
import { FOLDING_ACTIONS } from "../../contrib/folding/browser/foldingActions.ts";
import { FORMAT_ACTIONS } from "../../contrib/format/browser/formatActions.ts";
import { GOTO_DEFINITION_ACTIONS } from "../../contrib/gotoDefinition/browser/gotoDefinitionActions.ts";
import { HOVER_ACTIONS } from "../../contrib/hover/browser/hoverActions.ts";
import { INLINE_COMPLETIONS_ACTIONS } from "../../contrib/inlineCompletions/browser/inlineCompletionsActions.ts";
import { KEYBOARD_DOCTOR_ACTIONS } from "../../contrib/keyboardDoctor/browser/keyboardDoctorActions.ts";
import { LINES_OPERATIONS_ACTIONS } from "../../contrib/linesOperations/browser/linesOperationsActions.ts";
import { MULTI_CURSOR_ACTIONS } from "../../contrib/multicursor/browser/multiCursorActions.ts";
import { OUTPUT_ACTIONS } from "../../contrib/output/browser/outputActions.ts";
import { PARAMETER_HINTS_ACTIONS } from "../../contrib/parameterHints/browser/parameterHintsActions.ts";
import { PREFERENCES_ACTIONS } from "../../contrib/preferences/browser/preferencesActions.ts";
import { QUICK_ACCESS_ACTIONS } from "../../contrib/quickaccess/browser/quickOpenActions.ts";
import { REFERENCES_ACTIONS } from "../../contrib/references/browser/referencesActions.ts";
import { SCM_ACTIONS } from "../../contrib/scm/browser/scmActions.ts";
import { SEARCH_ACTIONS } from "../../contrib/search/browser/searchActions.ts";
import { SUGGEST_ACTIONS } from "../../contrib/suggest/browser/suggestActions.ts";
import { TERMINAL_ACTIONS } from "../../contrib/terminal/browser/terminalActions.ts";
import { THEME_ACTIONS } from "../../contrib/themes/browser/themeActions.ts";
import { changeEncodingAction } from "../parts/editor/encodingActions.ts";
import {
    changeEolAction,
    convertToCrlfAction,
    convertToLfAction,
    toggleEolAction,
} from "../parts/editor/eolActions.ts";

import { quitAction, reloadWindowAction, showAboutDialogAction } from "./appActions.ts";
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
    cursorLineEndAction,
    cursorLineStartAction,
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
    toggleWordWrapAction,
} from "./editorActions.ts";
import {
    deleteAllLeftAction,
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
import { EDITOR_GROUP_ACTIONS } from "./editorGroupActions.ts";
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
    closePanelAction,
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
import { navigateBackAction, navigateForwardAction } from "./navigationActions.ts";
import { clearNotificationsAction, focusNotificationAction } from "./notificationActions.ts";
import {
    closeActiveEditorAction,
    nextEditorAction,
    nextEditorInGroupAction,
    openPreviousRecentlyUsedEditorInGroupAction,
    previousEditorAction,
    previousEditorInGroupAction,
} from "./tabActions.ts";
import { TAB_CLOSE_ACTIONS } from "./tabCloseActions.ts";

/**
 * Реестр встроенных экшенов Workbench'а. Регистрирует их владелец приложения
 * (`WorkbenchComponent`) единым циклом `registerAction`. Порядок здесь
 * поведения не держит: кто получит клавишу из команд на одной комбинации,
 * решает вес правила (`CommandAction.weight`, `KeybindingWeight`).
 * `builtinKeybindings.slice.test.ts` фиксирует старшинство и проверяет, что
 * обратный порядок массива его не меняет.
 */
export const builtinActions: readonly CommandAction[] = [
    ...FILES_ACTIONS,
    ...PREFERENCES_ACTIONS,
    ...KEYBOARD_DOCTOR_ACTIONS,
    showAboutDialogAction,
    reloadWindowAction,
    quitAction,
    ...QUICK_ACCESS_ACTIONS,
    ...THEME_ACTIONS,
    changeEncodingAction,
    changeEolAction,
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
    cursorLineStartAction,
    cursorLineEndAction,
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
    toggleWordWrapAction,
    ...MULTI_CURSOR_ACTIONS,
    deleteLeftAction,
    deleteRightAction,
    deleteWordLeftAction,
    deleteWordRightAction,
    deleteAllLeftAction,
    undoAction,
    redoAction,
    selectAllAction,
    indentLinesAction,
    outdentLinesAction,
    ...LINES_OPERATIONS_ACTIONS,
    ...COMMENT_ACTIONS,
    convertToLfAction,
    convertToCrlfAction,
    toggleEolAction,
    ...FOLDING_ACTIONS,
    ...SUGGEST_ACTIONS,
    ...GOTO_DEFINITION_ACTIONS,
    ...HOVER_ACTIONS,
    ...PARAMETER_HINTS_ACTIONS,
    ...FORMAT_ACTIONS,
    ...CODE_ACTION_ACTIONS,
    clipboardCopyAction,
    clipboardCutAction,
    clipboardPasteAction,
    showEditorContextMenuAction,
    listFocusPageDownAction,
    listFocusPageUpAction,
    listFocusFirstAction,
    listFocusLastAction,
    navigateBackAction,
    navigateForwardAction,
    nextEditorAction,
    nextEditorInGroupAction,
    previousEditorAction,
    previousEditorInGroupAction,
    openPreviousRecentlyUsedEditorInGroupAction,
    closeActiveEditorAction,
    ...TAB_CLOSE_ACTIONS,
    ...EDITOR_GROUP_ACTIONS,
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
    ...FIND_ACTIONS,
    ...INLINE_COMPLETIONS_ACTIONS,
    toggleSidebarAction,
    showExplorerAction,
    ...SEARCH_ACTIONS,
    revealActiveFileInExplorerAction,
    increaseSidebarWidthAction,
    decreaseSidebarWidthAction,
    resetSidebarWidthAction,
    togglePanelAction,
    closePanelAction,
    toggleProblemsAction,
    ...OUTPUT_ACTIONS,
    ...TERMINAL_ACTIONS,
    clearNotificationsAction,
    focusNotificationAction,
    ...COMPARE_ACTIONS,
    ...SCM_ACTIONS,
    ...EXTENSIONS_ACTIONS,
    ...REFERENCES_ACTIONS,
];
