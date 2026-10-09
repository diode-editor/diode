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
    increaseSidebarWidthAction,
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
import { LanguageFeatureContextKeysDIToken } from "./browser/languageFeatureContextKeys.ts";
import { OpenFailureNotificationContributionDIToken } from "./browser/openFailureNotificationContribution.ts";
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
import { ViewProgressContributionDIToken } from "./browser/parts/views/viewProgressContribution.ts";
import { ViewTitleActionsContributionDIToken } from "./browser/parts/views/viewTitleActionsContribution.ts";
import { SetContextCommandContributionDIToken } from "./browser/setContextCommandContribution.ts";
import type { IWorkbenchContributionRegistration } from "./common/iWorkbenchContribution.ts";
import { CODE_ACTION_ACTIONS } from "./contrib/codeAction/browser/codeActionActions.ts";
import { COMMENT_ACTIONS } from "./contrib/comment/browser/commentActions.ts";
import { COMPARE_ACTIONS } from "./contrib/diff/browser/compareActions.ts";
import { DiffSnapshotRefreshContributionDIToken } from "./contrib/diff/browser/diffSnapshotRefreshContribution.ts";
import { VscodeDiffCommandContributionDIToken } from "./contrib/diff/browser/vscodeDiffCommandContribution.ts";
import { EXTENSIONS_ACTIONS } from "./contrib/extensions/browser/extensionsActions.ts";
import { ExtensionsComponentDIToken } from "./contrib/extensions/browser/extensionsComponent.ts";
import { AutoRevealContributionDIToken } from "./contrib/files/browser/autoRevealContribution.ts";
import { ExplorerComponentDIToken } from "./contrib/files/browser/explorerComponent.ts";
import { ExplorerServiceDIToken } from "./contrib/files/browser/explorerService.ts";
import { FILES_ACTIONS } from "./contrib/files/browser/filesActions.ts";
import { InputWidgetServiceDIToken } from "./contrib/files/browser/inputWidgetService.ts";
import { OpenFileCommandContributionDIToken } from "./contrib/files/browser/openFileCommandContribution.ts";
import { FIND_ACTIONS } from "./contrib/find/browser/findActions.ts";
import { FindComponentDIToken } from "./contrib/find/browser/findComponent.ts";
import { FindServiceDIToken } from "./contrib/find/browser/findService.ts";
import { FOLDING_ACTIONS } from "./contrib/folding/browser/foldingActions.ts";
import { FORMAT_ACTIONS } from "./contrib/format/browser/formatActions.ts";
import { GOTO_DEFINITION_ACTIONS } from "./contrib/gotoDefinition/browser/gotoDefinitionActions.ts";
import { HOVER_ACTIONS } from "./contrib/hover/browser/hoverActions.ts";
import { HoverComponentDIToken } from "./contrib/hover/browser/hoverComponent.ts";
import { HoverServiceDIToken } from "./contrib/hover/browser/hoverService.ts";
import { INLINE_COMPLETIONS_ACTIONS } from "./contrib/inlineCompletions/browser/inlineCompletionsActions.ts";
import { InlineCompletionsServiceDIToken } from "./contrib/inlineCompletions/browser/inlineCompletionsService.ts";
import { KEYBOARD_DOCTOR_ACTIONS } from "./contrib/keyboardDoctor/browser/keyboardDoctorActions.ts";
import { KeyboardDoctorComponentDIToken } from "./contrib/keyboardDoctor/browser/keyboardDoctorComponent.ts";
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
import { CompletionServiceDIToken } from "./contrib/suggest/browser/completionService.ts";
import { SUGGEST_ACTIONS } from "./contrib/suggest/browser/suggestActions.ts";
import { SuggestComponentDIToken } from "./contrib/suggest/browser/suggestComponent.ts";
import { TASKS_ACTIONS } from "./contrib/tasks/browser/taskActions.ts";
import { TaskServiceDIToken } from "./contrib/tasks/browser/taskService.ts";
import { TaskStatusBarContributionDIToken } from "./contrib/tasks/browser/taskStatusBarContribution.ts";
import { TERMINAL_ACTIONS } from "./contrib/terminal/browser/terminalActions.ts";
import { TerminalPanelComponentDIToken } from "./contrib/terminal/browser/terminalPanelComponent.ts";
import { TerminalServiceDIToken } from "./contrib/terminal/browser/terminalService.ts";
import { THEME_ACTIONS } from "./contrib/themes/browser/themeActions.ts";
import { ThemeConfigContributionDIToken } from "./contrib/themes/browser/themeConfigContribution.ts";
import { HistoryServiceDIToken } from "./services/history/browser/historyService.ts";
import { TerminalEnvContextKeysContributionDIToken } from "./services/terminalEnvironment/node/terminalEnvContextKeysContribution.ts";
import { TerminalEnvStatusContributionDIToken } from "./services/terminalEnvironment/node/terminalEnvStatusContribution.ts";

/**
 * Агрегатор workbench'а (паритет имени с upstream `workbench.common.main.ts`):
 * единственное место ядра, которому разрешено знать все фичи (правило
 * направления в `scripts/check-layers.mjs`). Явный список workbench-contributions
 * (зеркало `WORKBENCH_ACTIONS` ниже, без import-side-effect саморегистрации). Порядок
 * внутри фазы = порядок инстанцирования. Новую фичу или проводку добавляем сюда,
 * а не строкой в конструктор `WorkbenchComponent`.
 */
export const WORKBENCH_CONTRIBUTIONS: readonly IWorkbenchContributionRegistration[] = [
    // ── blockStartup: фич-компоненты и их сервисы ─────────────────────────────
    // Инстанцируются в конструкторе корня — после прикрепления корневой view
    // (хост оверлеев), до setWorkspaceFolder бутстрапа и до старта extension
    // host'а. Порядок вкладок и вьюлетов от порядка записей НЕ зависит (его
    // задаёт `order` контейнеров); порядок overlay-сессий suggest/hover/
    // parameterHints (слой рисует их в порядке создания) — зависит.
    // Explorer-кластер: сервис (корень своего дерева/провайдер/reveal) и компонент.
    { token: ExplorerServiceDIToken, phase: "blockStartup" },
    { token: ExplorerComponentDIToken, phase: "blockStartup" },
    // Вьюлеты сайдбара: Search (rg), магазин (каталог — лениво, при первом
    // показе), References (наполняется по Find All References).
    { token: SearchComponentDIToken, phase: "blockStartup" },
    { token: ExtensionsComponentDIToken, phase: "blockStartup" },
    { token: ReferencesComponentDIToken, phase: "blockStartup" },
    { token: QuickOpenServiceDIToken, phase: "blockStartup" },
    // Пары «компонент владеет попапом, сервис — логикой»: suggest, hover,
    // подсказка параметров; призрачные подсказки рисуют прямо в редакторе.
    // Stryker disable next-line ObjectLiteral,StringLiteral: компонент всё равно резолвится (его держит CompletionService следующей записью) — запись только передаёт реестру владение жизнью, что юнитом не наблюдается
    { token: SuggestComponentDIToken, phase: "blockStartup" },
    { token: CompletionServiceDIToken, phase: "blockStartup" },
    // Stryker disable next-line ObjectLiteral,StringLiteral: компонент всё равно резолвится (его держит HoverService следующей записью) — запись только передаёт владение жизнью
    { token: HoverComponentDIToken, phase: "blockStartup" },
    // Stryker disable next-line ObjectLiteral,StringLiteral: сервис всё равно резолвится (его держит WorkbenchContextKeys) — запись только передаёт владение жизнью
    { token: HoverServiceDIToken, phase: "blockStartup" },
    // Stryker disable next-line ObjectLiteral,StringLiteral: компонент всё равно резолвится (его держит ParameterHintsService следующей записью) — запись только передаёт владение жизнью
    { token: ParameterHintsComponentDIToken, phase: "blockStartup" },
    // Stryker disable next-line ObjectLiteral,StringLiteral: как и hover-сервис, резолвится через WorkbenchContextKeys — запись лишь передаёт владение жизнью
    { token: ParameterHintsServiceDIToken, phase: "blockStartup" },
    // Stryker disable next-line ObjectLiteral,StringLiteral: резолвится и через WorkbenchContextKeys — запись лишь передаёт владение жизнью
    { token: InlineCompletionsServiceDIToken, phase: "blockStartup" },
    // Stryker disable next-line ObjectLiteral,StringLiteral: компонент всё равно резолвится (его держит FindService следующей записью) — запись только передаёт владение жизнью
    { token: FindComponentDIToken, phase: "blockStartup" },
    { token: FindServiceDIToken, phase: "blockStartup" },
    // Панель: диагностики (headless), PROBLEMS, OUTPUT.
    { token: DiagnosticsServiceDIToken, phase: "blockStartup" },
    { token: ProblemsComponentDIToken, phase: "blockStartup" },
    { token: OutputComponentDIToken, phase: "blockStartup" },
    // Source Control: секция CHANGES (команда `diode.scm.publishChanges`), GRAPH
    // (`diode.scm.publishLog`), commit input, repo-state (`diode.scm.publishRepoState`)
    // — команды обязаны существовать до активации git-расширения.
    { token: ChangesComponentDIToken, phase: "blockStartup" },
    { token: GraphViewComponentDIToken, phase: "blockStartup" },
    { token: ScmInputComponentDIToken, phase: "blockStartup" },
    { token: ScmRepoStateServiceDIToken, phase: "blockStartup" },
    // Терминал: сервис (вкладка TERMINAL, сессии) и его view.
    { token: TerminalServiceDIToken, phase: "blockStartup" },
    { token: TerminalPanelComponentDIToken, phase: "blockStartup" },
    // Задачи: провайдеры расширений регистрируются в сервисе с первой активацией.
    { token: TaskServiceDIToken, phase: "blockStartup" },
    // Модальные оверлеи вкладки Keyboard Shortcuts и Keyboard Doctor (сессию
    // создают лениво, при первом показе).
    // Stryker disable next-line ObjectLiteral,StringLiteral: без записи рекордер резолвится лениво первой же командой записи — запись лишь передаёт владение жизнью
    { token: KeybindingRecorderComponentDIToken, phase: "blockStartup" },
    // Stryker disable next-line ObjectLiteral,StringLiteral: то же — доктор резолвится лениво командой запуска
    { token: KeyboardDoctorComponentDIToken, phase: "blockStartup" },
    // `vscode.diff`: ext-host зовёт её по id — команда нужна до старта расширений.
    { token: VscodeDiffCommandContributionDIToken, phase: "blockStartup" },

    // ── ready и eventually: фич-проводка ──────────────────────────────────────
    { token: EditorStatusContributionDIToken, phase: "ready" },
    { token: TerminalEnvStatusContributionDIToken, phase: "ready" },
    // when-ключи окружения (tier/os/cap_*/mode_*/macKeys): до первого нажатия.
    { token: TerminalEnvContextKeysContributionDIToken, phase: "ready" },
    { token: AutoRevealContributionDIToken, phase: "ready" },
    { token: ThemeConfigContributionDIToken, phase: "ready" },
    { token: OpenFileCommandContributionDIToken, phase: "ready" },
    // Встроенная `setContext`: расширение может дёрнуть её в activate(), то есть
    // раньше любого пользовательского действия.
    // Stryker disable next-line ObjectLiteral,StringLiteral: снятие записи ненаблюдаемо юнитом; без неё команды нет, и это ловит e2e-сценарий extension-storage (клавиша расширения не оживает после Arm)
    { token: SetContextCommandContributionDIToken, phase: "ready" },
    { token: PanelFocusContributionDIToken, phase: "ready" },
    // Сообщение «ресурс открыть нечем»: подписка должна стоять до первого
    // открытия, иначе первая же неудача пройдёт молча.
    // Stryker disable next-line ObjectLiteral,StringLiteral: снятие записи ненаблюдаемо юнитом; без неё тост не появляется, и это ловит e2e-сценарий virtualDocument
    { token: OpenFailureNotificationContributionDIToken, phase: "ready" },
    // Спиннеры занятости в заголовках секций: подписка должна стоять до первой
    // операции, иначе её начало пройдёт мимо.
    // Stryker disable next-line ObjectLiteral,StringLiteral: см. HistoryService ниже — снятие записи ненаблюдаемо юнитом, проводку проверяет поднятие приложения
    { token: ViewProgressContributionDIToken, phase: "ready" },
    // Долгие сетевые операции видно и когда Source Control не показан.
    // Stryker disable next-line ObjectLiteral,StringLiteral: см. HistoryService ниже — снятие записи ненаблюдаемо юнитом, проводку проверяет поднятие приложения
    { token: ProgressStatusBarContributionDIToken, phase: "ready" },
    // Живой тулбар: кнопки заголовков реагируют на смену контекст-ключей.
    // Stryker disable next-line ObjectLiteral,StringLiteral: см. HistoryService ниже — снятие записи ненаблюдаемо юнитом, проводку проверяет поднятие приложения
    { token: ViewTitleActionsContributionDIToken, phase: "ready" },
    // История навигации: подписки должны стоять до открытия первого файла.
    // Убрать эту строку сейчас ничего не ломает — сервис всё равно поднимается
    // раньше, когда workbenchContextKeys читает canGoBack/canGoForward. Но такая
    // гарантия порядка держится на чужой детали, поэтому запись оставляем явной.
    // Stryker disable next-line ObjectLiteral,StringLiteral: см. выше — снятие записи ненаблюдаемо
    { token: HistoryServiceDIToken, phase: "ready" },
    // Каналы Output как команды + пункты submenu селектора.
    { token: OutputChannelActionsDIToken, phase: "ready" },
    // Живые change-bars: считать дифф можно только после того, как есть редакторы.
    { token: QuickDiffServiceDIToken, phase: "ready" },
    // Автоосвежение снимочных сторон дифф-вкладок по onDidChangeFile (US-31).
    { token: DiffSnapshotRefreshContributionDIToken, phase: "ready" },
    // Ветка + sync-счётчики в статус-баре (из repo-state git-расширения).
    { token: ScmStatusBarContributionDIToken, phase: "ready" },
    // Ключ занятости git: на нём висит enablement мутирующих команд.
    // Stryker disable next-line ObjectLiteral,StringLiteral: см. HistoryService ниже — снятие записи ненаблюдаемо юнитом, проводку проверяет поднятие приложения
    { token: ScmBusyContextContributionDIToken, phase: "ready" },
    // `$(tools) N` бегущих задач.
    { token: TaskStatusBarContributionDIToken, phase: "ready" },
];

/**
 * Встроенные экшены Workbench'а: развёртки `<FEATURE>_ACTIONS` фич и экшены ядра. Регистрирует их владелец приложения
 * (`WorkbenchComponent`, через `CommandActionsDIToken`) единым циклом `registerAction`. Порядок здесь
 * поведения не держит: кто получит клавишу из команд на одной комбинации,
 * решает вес правила (`CommandAction.weight`, `KeybindingWeight`).
 * `builtinKeybindings.slice.test.ts` фиксирует старшинство и проверяет, что
 * обратный порядок массива его не меняет.
 */
export const WORKBENCH_ACTIONS: readonly CommandAction[] = [
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
    ...TASKS_ACTIONS,
    clearNotificationsAction,
    focusNotificationAction,
    ...COMPARE_ACTIONS,
    ...SCM_ACTIONS,
    ...EXTENSIONS_ACTIONS,
    ...REFERENCES_ACTIONS,
    // Rename Symbol (F2) — переименование rename-провайдерами расширений
    ...RENAME_ACTIONS,
];

/**
 * Явный полный список menu-contributions (зеркало `WORKBENCH_ACTIONS`/
 * `WORKBENCH_CONTRIBUTIONS`): структура меню-бара + деривация из размещений
 * встроенных экшенов. Пункты резолвит {@link MenuRegistry.getMenuItems}:
 * порядок — group/order с авто-разделителями, шорткат — из `KeybindingRegistry`.
 */
export const MENU_CONTRIBUTIONS: readonly MenuContribution[] = [
    ...MENUBAR_SUBMENUS,
    ...GIT_MENU_SUBMENUS,
    ...WORKBENCH_ACTIONS.flatMap(menuItemsOfAction),
];

/**
 * Явный список фич, которые сами выставляют свои контекст-ключи (зеркало
 * `WORKBENCH_CONTRIBUTIONS`). `WorkbenchContextKeys` опрашивает их в этом
 * порядке перед резолвом каждого биндинга и на смене фокуса. Новый фичевый
 * ключ — метод `updateContextKeys` у фичи и строка здесь, а не правка центра.
 */
export const WORKBENCH_CONTEXT_KEY_CONTRIBUTORS: readonly Token<IContextKeyContributor>[] = [
    SearchComponentDIToken,
    // Виджеты над редактором: их *Visible-ключи гейтят Enter/Escape/Tab/стрелки.
    FindServiceDIToken,
    CompletionServiceDIToken,
    HoverServiceDIToken,
    ParameterHintsServiceDIToken,
    InlineCompletionsServiceDIToken,
    // Видимость вьюлетов: ключ объявляет дескриптор контейнера (visibleContextKey).
    SidebarServiceDIToken,
    ExplorerComponentDIToken,
    ScmInputComponentDIToken,
    TerminalServiceDIToken,
    TerminalPanelComponentDIToken,
    TabSwitcherComponentDIToken,
    // «У документа есть провайдер такой-то фичи» — видимость пунктов контекст-меню.
    LanguageFeatureContextKeysDIToken,
    // Не ключи, а активное поле ввода для редактирующих команд — в том же опросе.
    InputWidgetServiceDIToken,
];
