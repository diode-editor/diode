import { OpenFailureNotificationContributionDIToken } from "./browser/openFailureNotificationContribution.ts";
import { EditorStatusContributionDIToken } from "./browser/parts/editor/editorStatusContribution.ts";
import { PanelFocusContributionDIToken } from "./browser/parts/panel/panelFocusContribution.ts";
import { ProgressStatusBarContributionDIToken } from "./browser/parts/statusbar/progressStatusBarContribution.ts";
import { ViewProgressContributionDIToken } from "./browser/parts/views/viewProgressContribution.ts";
import { ViewTitleActionsContributionDIToken } from "./browser/parts/views/viewTitleActionsContribution.ts";
import { SetContextCommandContributionDIToken } from "./browser/setContextCommandContribution.ts";
import type { IWorkbenchContributionRegistration } from "./common/iWorkbenchContribution.ts";
import { DiffSnapshotRefreshContributionDIToken } from "./contrib/diff/browser/diffSnapshotRefreshContribution.ts";
import { VscodeDiffCommandContributionDIToken } from "./contrib/diff/browser/vscodeDiffCommandContribution.ts";
import { ExtensionsComponentDIToken } from "./contrib/extensions/browser/extensionsComponent.ts";
import { AutoRevealContributionDIToken } from "./contrib/files/browser/autoRevealContribution.ts";
import { ExplorerComponentDIToken } from "./contrib/files/browser/explorerComponent.ts";
import { ExplorerServiceDIToken } from "./contrib/files/browser/explorerService.ts";
import { OpenFileCommandContributionDIToken } from "./contrib/files/browser/openFileCommandContribution.ts";
import { FindComponentDIToken } from "./contrib/find/browser/findComponent.ts";
import { FindServiceDIToken } from "./contrib/find/browser/findService.ts";
import { HoverComponentDIToken } from "./contrib/hover/browser/hoverComponent.ts";
import { HoverServiceDIToken } from "./contrib/hover/browser/hoverService.ts";
import { InlineCompletionsServiceDIToken } from "./contrib/inlineCompletions/browser/inlineCompletionsService.ts";
import { KeyboardDoctorComponentDIToken } from "./contrib/keyboardDoctor/browser/keyboardDoctorComponent.ts";
import { DiagnosticsServiceDIToken } from "./contrib/markers/browser/diagnosticsService.ts";
import { ProblemsComponentDIToken } from "./contrib/markers/browser/problemsComponent.ts";
import { OutputChannelActionsDIToken } from "./contrib/output/browser/outputChannelActions.ts";
import { OutputComponentDIToken } from "./contrib/output/browser/outputComponent.ts";
import { ParameterHintsComponentDIToken } from "./contrib/parameterHints/browser/parameterHintsComponent.ts";
import { ParameterHintsServiceDIToken } from "./contrib/parameterHints/browser/parameterHintsService.ts";
import { KeybindingRecorderComponentDIToken } from "./contrib/preferences/browser/keybindingRecorderComponent.ts";
import { QuickOpenServiceDIToken } from "./contrib/quickaccess/browser/quickOpenService.ts";
import { ReferencesComponentDIToken } from "./contrib/references/browser/referencesComponent.ts";
import { ChangesComponentDIToken } from "./contrib/scm/browser/changesComponent.ts";
import { GraphViewComponentDIToken } from "./contrib/scm/browser/graphViewComponent.ts";
import { QuickDiffServiceDIToken } from "./contrib/scm/browser/quickDiffService.ts";
import { ScmRepoStateServiceDIToken } from "./contrib/scm/browser/repoStateService.ts";
import { ScmBusyContextContributionDIToken } from "./contrib/scm/browser/scmBusyContextContribution.ts";
import { ScmInputComponentDIToken } from "./contrib/scm/browser/scmInputComponent.ts";
import { ScmStatusBarContributionDIToken } from "./contrib/scm/browser/scmStatusBarContribution.ts";
import { SearchComponentDIToken } from "./contrib/search/browser/searchComponent.ts";
import { CompletionServiceDIToken } from "./contrib/suggest/browser/completionService.ts";
import { SuggestComponentDIToken } from "./contrib/suggest/browser/suggestComponent.ts";
import { TerminalPanelComponentDIToken } from "./contrib/terminal/browser/terminalPanelComponent.ts";
import { TerminalServiceDIToken } from "./contrib/terminal/browser/terminalService.ts";
import { ThemeConfigContributionDIToken } from "./contrib/themes/browser/themeConfigContribution.ts";
import { HistoryServiceDIToken } from "./services/history/browser/historyService.ts";
import { TerminalEnvContextKeysContributionDIToken } from "./services/terminalEnvironment/node/terminalEnvContextKeysContribution.ts";
import { TerminalEnvStatusContributionDIToken } from "./services/terminalEnvironment/node/terminalEnvStatusContribution.ts";

/**
 * Агрегатор workbench'а (паритет имени с upstream `workbench.common.main.ts`):
 * единственное место ядра, которому разрешено знать все фичи (правило
 * направления в `scripts/check-layers.mjs`). Явный список workbench-contributions
 * (зеркало `builtinActions`, без import-side-effect саморегистрации). Порядок
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
];
