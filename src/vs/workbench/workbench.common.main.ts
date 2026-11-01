import type { CommandAction } from "../platform/actions/common/commandAction.ts";
import type { MenuContribution } from "../platform/actions/common/iMenuContribution.ts";
import type { IContextKeyContributor } from "../platform/contextkey/common/contextKeyContributor.ts";
import type { Token } from "../platform/instantiation/common/diContainer.ts";

import { quitAction, reloadWindowAction, showAboutDialogAction } from "./browser/actions/appActions.ts";
import { clipboardCopyAction, clipboardCutAction, clipboardPasteAction } from "./browser/actions/clipboardActions.ts";
import { showEditorContextMenuAction } from "./browser/actions/contextMenuActions.ts";
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
    showLensesInCurrentLineAction,
    toggleInlayHintsAction,
    toggleWordWrapAction,
} from "./browser/actions/editorActions.ts";
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
} from "./browser/actions/editorEditActions.ts";
import { EDITOR_GROUP_ACTIONS } from "./browser/actions/editorGroupActions.ts";
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
} from "./browser/actions/inputActions.ts";
import {
    closePanelAction,
    decreaseSidebarWidthAction,
    decreaseViewSizeAction,
    increaseSidebarWidthAction,
    increaseViewSizeAction,
    resetSidebarWidthAction,
    revealActiveFileInExplorerAction,
    showExplorerAction,
    togglePanelAction,
    toggleProblemsAction,
    toggleSidebarAction,
} from "./browser/actions/layoutActions.ts";
import {
    listFocusFirstAction,
    listFocusLastAction,
    listFocusPageDownAction,
    listFocusPageUpAction,
} from "./browser/actions/listActions.ts";
import { MENUBAR_SUBMENUS, menuItemsOfAction } from "./browser/actions/menuContributions.ts";
import { navigateBackAction, navigateForwardAction } from "./browser/actions/navigationActions.ts";
import { clearNotificationsAction, focusNotificationAction } from "./browser/actions/notificationActions.ts";
import {
    closeActiveEditorAction,
    keepEditorAction,
    nextEditorAction,
    nextEditorInGroupAction,
    openPreviousRecentlyUsedEditorInGroupAction,
    previousEditorAction,
    previousEditorInGroupAction,
} from "./browser/actions/tabActions.ts";
import { TAB_CLOSE_ACTIONS } from "./browser/actions/tabCloseActions.ts";
import { VIEW_LOCATION_ACTIONS } from "./browser/actions/viewLocationActions.ts";
import { LanguageFeatureContextKeysDIToken } from "./browser/languageFeatureContextKeys.ts";
import { OpenFailureNotificationContributionDIToken } from "./browser/openFailureNotificationContribution.ts";
import { AUXILIARY_BAR_ACTIONS } from "./browser/parts/auxiliarybar/auxiliaryBarActions.ts";
import { AuxiliaryBarComponentDIToken } from "./browser/parts/auxiliarybar/auxiliaryBarComponent.ts";
import { AuxiliaryBarFocusContributionDIToken } from "./browser/parts/auxiliarybar/auxiliaryBarFocusContribution.ts";
import { EditorStatusContributionDIToken } from "./browser/parts/editor/editorStatusContribution.ts";
import { changeEncodingAction } from "./browser/parts/editor/encodingActions.ts";
import {
    changeEolAction,
    convertToCrlfAction,
    convertToLfAction,
    toggleEolAction,
} from "./browser/parts/editor/eolActions.ts";
import { TabSwitcherComponentDIToken } from "./browser/parts/editor/tabSwitcherComponent.ts";
import { PanelFocusContributionDIToken } from "./browser/parts/panel/panelFocusContribution.ts";
import { SidebarServiceDIToken } from "./browser/parts/sidebar/sidebarService.ts";
import { ProgressStatusBarContributionDIToken } from "./browser/parts/statusbar/progressStatusBarContribution.ts";
import { WindowTitleContributionDIToken } from "./browser/parts/titlebar/windowTitleContribution.ts";
import { ViewProgressContributionDIToken } from "./browser/parts/views/viewProgressContribution.ts";
import { ViewsServiceDIToken } from "./browser/parts/views/viewsService.ts";
import { ViewTitleActionsContributionDIToken } from "./browser/parts/views/viewTitleActionsContribution.ts";
import { SetContextCommandContributionDIToken } from "./browser/setContextCommandContribution.ts";
import { UndoRefusalNotificationContributionDIToken } from "./browser/undoRefusalNotificationContribution.ts";
import type { IWorkbenchContributionRegistration } from "./common/iWorkbenchContribution.ts";
import { CODE_ACTION_ACTIONS } from "./contrib/codeAction/browser/codeActionActions.ts";
import { COMMENT_ACTIONS } from "./contrib/comment/browser/commentActions.ts";
import { COMPARE_ACTIONS } from "./contrib/diff/browser/compareActions.ts";
import { DiffSnapshotRefreshContributionDIToken } from "./contrib/diff/browser/diffSnapshotRefreshContribution.ts";
import { VscodeDiffCommandContributionDIToken } from "./contrib/diff/browser/vscodeDiffCommandContribution.ts";
import { ExtensionAutoUpdateContributionDIToken } from "./contrib/extensions/browser/extensionAutoUpdate.ts";
import { EXTENSIONS_ACTIONS } from "./contrib/extensions/browser/extensionsActions.ts";
import { ExtensionsComponentDIToken } from "./contrib/extensions/browser/extensionsComponent.ts";
import { ExtensionUpdateContributionDIToken } from "./contrib/extensions/browser/extensionUpdateActions.ts";
import { ExtensionVersionContributionDIToken } from "./contrib/extensions/browser/extensionVersionActions.ts";
import { AutoRevealContributionDIToken } from "./contrib/files/browser/autoRevealContribution.ts";
import { ExplorerComponentDIToken } from "./contrib/files/browser/explorerComponent.ts";
import { ExplorerServiceDIToken } from "./contrib/files/browser/explorerService.ts";
import { FILES_ACTIONS } from "./contrib/files/browser/filesActions.ts";
import { InputWidgetServiceDIToken } from "./contrib/files/browser/inputWidgetService.ts";
import { OPEN_EDITORS_ACTIONS, OPEN_EDITORS_MENU_ITEMS } from "./contrib/files/browser/openEditorsActions.ts";
import { OpenEditorsViewDIToken } from "./contrib/files/browser/openEditorsView.ts";
import { OpenFileCommandContributionDIToken } from "./contrib/files/browser/openFileCommandContribution.ts";
import { FIND_ACTIONS } from "./contrib/find/browser/findActions.ts";
import { FindComponentDIToken } from "./contrib/find/browser/findComponent.ts";
import { FindServiceDIToken } from "./contrib/find/browser/findService.ts";
import { FOLDING_ACTIONS } from "./contrib/folding/browser/foldingActions.ts";
import { FORMAT_ACTIONS } from "./contrib/format/browser/formatActions.ts";
import { GOTO_DEFINITION_ACTIONS } from "./contrib/gotoDefinition/browser/gotoDefinitionActions.ts";
import { GoToLocationsCommandContributionDIToken } from "./contrib/gotoDefinition/browser/goToLocationsCommandContribution.ts";
import { HOVER_ACTIONS } from "./contrib/hover/browser/hoverActions.ts";
import { HoverComponentDIToken } from "./contrib/hover/browser/hoverComponent.ts";
import { HoverServiceDIToken } from "./contrib/hover/browser/hoverService.ts";
import { INLINE_COMPLETIONS_ACTIONS } from "./contrib/inlineCompletions/browser/inlineCompletionsActions.ts";
import { InlineCompletionsServiceDIToken } from "./contrib/inlineCompletions/browser/inlineCompletionsService.ts";
import { KEYBOARD_DOCTOR_ACTIONS } from "./contrib/keyboardDoctor/browser/keyboardDoctorActions.ts";
import { KeyboardDoctorComponentDIToken } from "./contrib/keyboardDoctor/browser/keyboardDoctorComponent.ts";
import { LanguageStatusContributionDIToken } from "./contrib/languageStatus/browser/languageStatus.ts";
import { LARGE_FILE_ACTIONS } from "./contrib/largeFile/browser/largeFileActions.ts";
import { LargeFileFollowStatusDIToken } from "./contrib/largeFile/browser/largeFileFollowStatus.ts";
import { LargeFileIndexingStatusDIToken } from "./contrib/largeFile/browser/largeFileIndexingStatus.ts";
import { LargeFileOptimizationsWarnerDIToken } from "./contrib/largeFile/browser/largeFileOptimizationsWarner.ts";
import { LINES_OPERATIONS_ACTIONS } from "./contrib/linesOperations/browser/linesOperationsActions.ts";
import { DiagnosticsServiceDIToken } from "./contrib/markers/browser/diagnosticsService.ts";
import { ProblemsComponentDIToken } from "./contrib/markers/browser/problemsComponent.ts";
import { MULTI_CURSOR_ACTIONS } from "./contrib/multicursor/browser/multiCursorActions.ts";
import { OUTPUT_ACTIONS } from "./contrib/output/browser/outputActions.ts";
import { OutputChannelActionsDIToken } from "./contrib/output/browser/outputChannelActions.ts";
import { OutputComponentDIToken } from "./contrib/output/browser/outputComponent.ts";
import { PARAMETER_HINTS_ACTIONS } from "./contrib/parameterHints/browser/parameterHintsActions.ts";
import { ParameterHintsComponentDIToken } from "./contrib/parameterHints/browser/parameterHintsComponent.ts";
import { ParameterHintsServiceDIToken } from "./contrib/parameterHints/browser/parameterHintsService.ts";
import { KeybindingRecorderComponentDIToken } from "./contrib/preferences/browser/keybindingRecorderComponent.ts";
import { PREFERENCES_ACTIONS } from "./contrib/preferences/browser/preferencesActions.ts";
import { QUICK_ACCESS_ACTIONS } from "./contrib/quickaccess/browser/quickOpenActions.ts";
import { QuickOpenServiceDIToken } from "./contrib/quickaccess/browser/quickOpenService.ts";
import { REFERENCES_ACTIONS } from "./contrib/references/browser/referencesActions.ts";
import { ReferencesComponentDIToken } from "./contrib/references/browser/referencesComponent.ts";
import { RENAME_ACTIONS } from "./contrib/rename/browser/renameActions.ts";
import { ChangesComponentDIToken } from "./contrib/scm/browser/changesComponent.ts";
import { GIT_MENU_SUBMENUS } from "./contrib/scm/browser/gitMenus.ts";
import { GraphViewComponentDIToken } from "./contrib/scm/browser/graphViewComponent.ts";
import { QuickDiffServiceDIToken } from "./contrib/scm/browser/quickDiffService.ts";
import { ScmRepoStateServiceDIToken } from "./contrib/scm/browser/repoStateService.ts";
import { SCM_ACTIONS } from "./contrib/scm/browser/scmActions.ts";
import { ScmBusyContextContributionDIToken } from "./contrib/scm/browser/scmBusyContextContribution.ts";
import { ScmInputComponentDIToken } from "./contrib/scm/browser/scmInputComponent.ts";
import { ScmStatusBarContributionDIToken } from "./contrib/scm/browser/scmStatusBarContribution.ts";
import { SEARCH_ACTIONS } from "./contrib/search/browser/searchActions.ts";
import { SearchComponentDIToken } from "./contrib/search/browser/searchComponent.ts";
import { SMART_SELECT_ACTIONS } from "./contrib/smartSelect/browser/smartSelectActions.ts";
import { CompletionServiceDIToken } from "./contrib/suggest/browser/completionService.ts";
import { SUGGEST_ACTIONS } from "./contrib/suggest/browser/suggestActions.ts";
import { SuggestComponentDIToken } from "./contrib/suggest/browser/suggestComponent.ts";
import { TASKS_ACTIONS } from "./contrib/tasks/browser/taskActions.ts";
import { TaskServiceDIToken } from "./contrib/tasks/browser/taskService.ts";
import { TaskStatusBarContributionDIToken } from "./contrib/tasks/browser/taskStatusBarContribution.ts";
import { TERMINAL_ACTIONS } from "./contrib/terminal/browser/terminalActions.ts";
import { TerminalEditorServiceDIToken } from "./contrib/terminal/browser/terminalEditorService.ts";
import { TerminalKeyRoutingDIToken } from "./contrib/terminal/browser/terminalKeyRouting.ts";
import { TerminalPanelComponentDIToken } from "./contrib/terminal/browser/terminalPanelComponent.ts";
import { TerminalServiceDIToken } from "./contrib/terminal/browser/terminalService.ts";
import { TERMINAL_LINK_ACTIONS } from "./contrib/terminalContrib/links/browser/terminalLinkActions.ts";
import { THEME_ACTIONS } from "./contrib/themes/browser/themeActions.ts";
import { ThemeConfigContributionDIToken } from "./contrib/themes/browser/themeConfigContribution.ts";
import { URL_ACTIONS } from "./contrib/url/browser/urlActions.ts";
import { USER_DATA_PROFILE_ACTIONS } from "./contrib/userDataProfile/browser/userDataProfileActions.ts";
import { WORD_HIGHLIGHTER_ACTIONS } from "./contrib/wordHighlighter/browser/wordHighlighterActions.ts";
import { EditorHistoryServiceDIToken } from "./services/history/browser/editorHistoryService.ts";
import { HistoryServiceDIToken } from "./services/history/browser/historyService.ts";
import { TerminalEnvContextKeysContributionDIToken } from "./services/terminalEnvironment/node/terminalEnvContextKeysContribution.ts";
import { TerminalEnvStatusContributionDIToken } from "./services/terminalEnvironment/node/terminalEnvStatusContribution.ts";

/**
 * The only place in the core allowed to know all features (`scripts/check-layers.mjs`).
 * Order within a phase = instantiation order.
 */
export const WORKBENCH_CONTRIBUTIONS: readonly IWorkbenchContributionRegistration[] = [
    // Tab and viewlet order is set by the containers' `order`, while the order of suggest/hover/parameterHints
    // overlay sessions is the entry order: the layer draws them in creation order.
    { token: ExplorerServiceDIToken, phase: "blockStartup" },
    { token: ExplorerComponentDIToken, phase: "blockStartup" },
    { token: OpenEditorsViewDIToken, phase: "blockStartup" },
    { token: SearchComponentDIToken, phase: "blockStartup" },
    { token: ExtensionsComponentDIToken, phase: "blockStartup" },
    { token: ExtensionVersionContributionDIToken, phase: "blockStartup" },
    { token: ExtensionUpdateContributionDIToken, phase: "blockStartup" },
    { token: ReferencesComponentDIToken, phase: "blockStartup" },
    { token: QuickOpenServiceDIToken, phase: "blockStartup" },
    // Stryker disable next-line ObjectLiteral,StringLiteral: the component is resolved anyway (CompletionService in the next entry holds it) — the entry only hands lifetime ownership to the registry, which a unit test can't observe
    { token: SuggestComponentDIToken, phase: "blockStartup" },
    { token: CompletionServiceDIToken, phase: "blockStartup" },
    // Stryker disable next-line ObjectLiteral,StringLiteral: the component is resolved anyway (HoverService in the next entry holds it) — the entry only hands over lifetime ownership
    { token: HoverComponentDIToken, phase: "blockStartup" },
    // Stryker disable next-line ObjectLiteral,StringLiteral: the service is resolved anyway (WorkbenchContextKeys holds it) — the entry only hands over lifetime ownership
    { token: HoverServiceDIToken, phase: "blockStartup" },
    // Stryker disable next-line ObjectLiteral,StringLiteral: the component is resolved anyway (ParameterHintsService in the next entry holds it) — the entry only hands over lifetime ownership
    { token: ParameterHintsComponentDIToken, phase: "blockStartup" },
    // Stryker disable next-line ObjectLiteral,StringLiteral: like the hover service, resolved via WorkbenchContextKeys — the entry only hands over lifetime ownership
    { token: ParameterHintsServiceDIToken, phase: "blockStartup" },
    // Stryker disable next-line ObjectLiteral,StringLiteral: also resolved via WorkbenchContextKeys — the entry only hands over lifetime ownership
    { token: InlineCompletionsServiceDIToken, phase: "blockStartup" },
    // Stryker disable next-line ObjectLiteral,StringLiteral: the component is resolved anyway (FindService in the next entry holds it) — the entry only hands over lifetime ownership
    { token: FindComponentDIToken, phase: "blockStartup" },
    { token: FindServiceDIToken, phase: "blockStartup" },
    { token: DiagnosticsServiceDIToken, phase: "blockStartup" },
    { token: ProblemsComponentDIToken, phase: "blockStartup" },
    { token: OutputComponentDIToken, phase: "blockStartup" },
    // Their `diode.scm.publish*` commands must exist before the git extension activates.
    { token: ChangesComponentDIToken, phase: "blockStartup" },
    { token: GraphViewComponentDIToken, phase: "blockStartup" },
    { token: ScmInputComponentDIToken, phase: "blockStartup" },
    { token: ScmRepoStateServiceDIToken, phase: "blockStartup" },
    { token: TerminalServiceDIToken, phase: "blockStartup" },
    { token: TerminalPanelComponentDIToken, phase: "blockStartup" },
    // Keys in the terminal are routed from the first key press.
    { token: TerminalKeyRoutingDIToken, phase: "blockStartup" },
    // Task providers register on the first extension activation.
    { token: TaskServiceDIToken, phase: "blockStartup" },
    // Stryker disable next-line ObjectLiteral,StringLiteral: without the entry the recorder resolves lazily on the first recording command — the entry only hands over lifetime ownership
    { token: KeybindingRecorderComponentDIToken, phase: "blockStartup" },
    // Stryker disable next-line ObjectLiteral,StringLiteral: same — the doctor resolves lazily on the launch command
    { token: KeyboardDoctorComponentDIToken, phase: "blockStartup" },
    // `vscode.diff`: the extension host calls it by id — the command is needed before extensions start.
    { token: VscodeDiffCommandContributionDIToken, phase: "blockStartup" },

    // `afterRestored` is what upstream keeps on `LifecyclePhase.Restored`
    // (`OutputContribution`, `QuickDiffWorkbenchController`, `SCMActiveRepositoryController`,
    // `TaskStatusBarContributions`).
    { token: EditorStatusContributionDIToken, phase: "ready" },
    { token: TerminalEnvStatusContributionDIToken, phase: "ready" },
    // Environment keys are needed before the first key press.
    { token: TerminalEnvContextKeysContributionDIToken, phase: "ready" },
    { token: AutoRevealContributionDIToken, phase: "ready" },
    { token: ThemeConfigContributionDIToken, phase: "ready" },
    { token: WindowTitleContributionDIToken, phase: "ready" },
    { token: OpenFileCommandContributionDIToken, phase: "ready" },
    // An extension may call these from activate() or a code lens before any user action.
    { token: GoToLocationsCommandContributionDIToken, phase: "ready" },
    // An extension may call `setContext` in activate(), before any user action.
    // Stryker disable next-line ObjectLiteral,StringLiteral: removing the entry is unobservable in a unit test; without it there is no command, which the extension-storage e2e scenario catches (the extension's key doesn't come alive after Arm)
    { token: SetContextCommandContributionDIToken, phase: "ready" },
    { token: PanelFocusContributionDIToken, phase: "ready" },
    { token: AuxiliaryBarFocusContributionDIToken, phase: "ready" },
    // Subscribe before the first open, otherwise the very first failure goes unnoticed.
    // Stryker disable next-line ObjectLiteral,StringLiteral: removing the entry is unobservable in a unit test; without it the toast doesn't appear, which the virtualDocument e2e scenario catches
    { token: OpenFailureNotificationContributionDIToken, phase: "ready" },
    { token: LargeFileOptimizationsWarnerDIToken, phase: "ready" },
    // Stryker disable next-line ObjectLiteral,StringLiteral: removing the entry is unobservable in a unit test; without it there is no progress, which the large-file-on-disk e2e scenario catches
    { token: LargeFileIndexingStatusDIToken, phase: "ready" },
    // Stryker disable next-line ObjectLiteral,StringLiteral: removing the entry is unobservable in a unit test; without it there is no Language Status segment, which the language-status e2e scenario catches
    { token: LanguageStatusContributionDIToken, phase: "ready" },
    // Stryker disable next-line ObjectLiteral,StringLiteral: removing the entry is unobservable in a unit test; without it there is no Follow entry, which the large-file-follow e2e scenario catches
    { token: LargeFileFollowStatusDIToken, phase: "ready" },
    // Stryker disable next-line ObjectLiteral,StringLiteral: removing the entry is unobservable in a unit test; without it there is no toast, which the move-to-new-file-undo e2e scenario catches
    { token: UndoRefusalNotificationContributionDIToken, phase: "ready" },
    // Subscribe before the first operation, otherwise its start is missed.
    // Stryker disable next-line ObjectLiteral,StringLiteral: see HistoryService below — removing the entry is unobservable in a unit test, the wiring is checked by app startup
    { token: ViewProgressContributionDIToken, phase: "ready" },
    // Stryker disable next-line ObjectLiteral,StringLiteral: see HistoryService below — removing the entry is unobservable in a unit test, the wiring is checked by app startup
    { token: ProgressStatusBarContributionDIToken, phase: "ready" },
    // Stryker disable next-line ObjectLiteral,StringLiteral: see HistoryService below — removing the entry is unobservable in a unit test, the wiring is checked by app startup
    { token: ViewTitleActionsContributionDIToken, phase: "ready" },
    // Subscribe before the first file opens. Currently the service comes up earlier anyway (workbenchContextKeys
    // reads it), but we don't rely on someone else's detail — the entry is explicit.
    // Stryker disable next-line ObjectLiteral,StringLiteral: see above — removing the entry is unobservable
    { token: HistoryServiceDIToken, phase: "ready" },
    // Same reason: the restored active editor and the first opened file go on top of the recent-files list.
    // Stryker disable next-line ObjectLiteral,StringLiteral: see above — removing the entry is unobservable in a unit test
    { token: EditorHistoryServiceDIToken, phase: "ready" },
    { token: OutputChannelActionsDIToken, phase: "afterRestored" },
    // Diffs can be computed only once editors exist.
    { token: QuickDiffServiceDIToken, phase: "afterRestored" },
    { token: DiffSnapshotRefreshContributionDIToken, phase: "ready" },
    { token: ScmStatusBarContributionDIToken, phase: "afterRestored" },
    // Stryker disable next-line ObjectLiteral,StringLiteral: see HistoryService above — removing the entry is unobservable in a unit test, the wiring is checked by app startup
    { token: ScmBusyContextContributionDIToken, phase: "ready" },
    { token: TaskStatusBarContributionDIToken, phase: "afterRestored" },
    // The background extension checks: never at startup, after the first frame (ExtensionUpdates stage 3).
    { token: ExtensionAutoUpdateContributionDIToken, phase: "eventually" },
];

/**
 * Order here doesn't affect behavior: a key on the same combination goes to the command
 * with the higher rule weight (`KeybindingWeight`) — `builtinKeybindings.slice.test.ts` checks this.
 */
export const WORKBENCH_ACTIONS: readonly CommandAction[] = [
    ...FILES_ACTIONS,
    ...OPEN_EDITORS_ACTIONS,
    ...LARGE_FILE_ACTIONS,
    ...PREFERENCES_ACTIONS,
    ...KEYBOARD_DOCTOR_ACTIONS,
    showAboutDialogAction,
    reloadWindowAction,
    quitAction,
    ...QUICK_ACCESS_ACTIONS,
    ...THEME_ACTIONS,
    ...USER_DATA_PROFILE_ACTIONS,
    ...URL_ACTIONS,
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
    showLensesInCurrentLineAction,
    toggleInlayHintsAction,
    toggleWordWrapAction,
    ...MULTI_CURSOR_ACTIONS,
    ...SMART_SELECT_ACTIONS,
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
    keepEditorAction,
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
    ...WORD_HIGHLIGHTER_ACTIONS,
    ...INLINE_COMPLETIONS_ACTIONS,
    toggleSidebarAction,
    showExplorerAction,
    ...SEARCH_ACTIONS,
    revealActiveFileInExplorerAction,
    increaseSidebarWidthAction,
    decreaseSidebarWidthAction,
    resetSidebarWidthAction,
    increaseViewSizeAction,
    decreaseViewSizeAction,
    togglePanelAction,
    closePanelAction,
    toggleProblemsAction,
    ...AUXILIARY_BAR_ACTIONS,
    ...VIEW_LOCATION_ACTIONS,
    ...OUTPUT_ACTIONS,
    ...TERMINAL_ACTIONS,
    ...TERMINAL_LINK_ACTIONS,
    ...TASKS_ACTIONS,
    clearNotificationsAction,
    focusNotificationAction,
    ...COMPARE_ACTIONS,
    ...SCM_ACTIONS,
    ...EXTENSIONS_ACTIONS,
    ...REFERENCES_ACTIONS,
    ...RENAME_ACTIONS,
];

/** Menu item order is set by group/order, not by array order. */
export const MENU_CONTRIBUTIONS: readonly MenuContribution[] = [
    ...MENUBAR_SUBMENUS,
    ...GIT_MENU_SUBMENUS,
    ...OPEN_EDITORS_MENU_ITEMS,
    ...WORKBENCH_ACTIONS.flatMap(menuItemsOfAction),
];

/** `WorkbenchContextKeys` polls them in this order before resolving each binding and on focus change. */
export const WORKBENCH_CONTEXT_KEY_CONTRIBUTORS: readonly Token<IContextKeyContributor>[] = [
    SearchComponentDIToken,
    FindServiceDIToken,
    CompletionServiceDIToken,
    HoverServiceDIToken,
    ParameterHintsServiceDIToken,
    InlineCompletionsServiceDIToken,
    SidebarServiceDIToken,
    AuxiliaryBarComponentDIToken,
    ViewsServiceDIToken,
    ExplorerComponentDIToken,
    OpenEditorsViewDIToken,
    ScmInputComponentDIToken,
    TerminalServiceDIToken,
    TerminalPanelComponentDIToken,
    TerminalEditorServiceDIToken,
    TabSwitcherComponentDIToken,
    QuickOpenServiceDIToken,
    LanguageFeatureContextKeysDIToken,
    // Not keys, but the active input field for editing commands — in the same poll.
    InputWidgetServiceDIToken,
];
