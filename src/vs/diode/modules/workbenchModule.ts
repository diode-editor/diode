import {
    ContextMenuController as EditorContextMenuController,
    ContextMenuControllerDIToken as EditorContextMenuControllerDIToken,
} from "../../editor/contrib/contextmenu/browser/contextMenuController.ts";
import { CommandActionsDIToken } from "../../platform/actions/common/commandAction.ts";
import { MenuContributionsDIToken } from "../../platform/actions/common/iMenuContribution.ts";
import { MenuRegistry, MenuRegistryDIToken } from "../../platform/actions/common/menuRegistry.ts";
import { MenuService, MenuServiceDIToken } from "../../platform/actions/common/menuService.ts";
import { ClipboardDIToken } from "../../platform/clipboard/common/iClipboard.ts";
import { CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import { ContextKeyContributorsDIToken } from "../../platform/contextkey/common/contextKeyContributor.ts";
import {
    ContextMenuService,
    ContextMenuServiceDIToken,
} from "../../platform/contextview/browser/contextMenuService.ts";
import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import { ProgressService, ProgressServiceDIToken } from "../../platform/progress/common/progressService.ts";
import { MenuBarComponent, MenuBarComponentDIToken } from "../../workbench/browser/menuBarComponent.ts";
import {
    OpenFailureNotificationContribution,
    OpenFailureNotificationContributionDIToken,
} from "../../workbench/browser/openFailureNotificationContribution.ts";
import {
    EditorPartComponent,
    EditorPartComponentDIToken,
} from "../../workbench/browser/parts/editor/editorPartComponent.ts";
import {
    ActiveEditorStatusSourceDIToken,
    EditorStatusContribution,
    EditorStatusContributionDIToken,
} from "../../workbench/browser/parts/editor/editorStatusContribution.ts";
import {
    TabSwitcherComponent,
    TabSwitcherComponentDIToken,
} from "../../workbench/browser/parts/editor/tabSwitcherComponent.ts";
import {
    NotificationsComponent,
    NotificationsComponentDIToken,
} from "../../workbench/browser/parts/notifications/notificationsComponent.ts";
import { PanelComponent, PanelComponentDIToken } from "../../workbench/browser/parts/panel/panelComponent.ts";
import {
    PanelFocusContribution,
    PanelFocusContributionDIToken,
} from "../../workbench/browser/parts/panel/panelFocusContribution.ts";
import { PanelService, PanelServiceDIToken } from "../../workbench/browser/parts/panel/panelService.ts";
import {
    QuickInputComponent,
    QuickInputComponentDIToken,
} from "../../workbench/browser/parts/quickinput/quickInputComponent.ts";
import {
    QuickInputService,
    QuickInputServiceDIToken,
} from "../../workbench/browser/parts/quickinput/quickInputService.ts";
import { SidebarService, SidebarServiceDIToken } from "../../workbench/browser/parts/sidebar/sidebarService.ts";
import {
    ProgressStatusBarContribution,
    ProgressStatusBarContributionDIToken,
} from "../../workbench/browser/parts/statusbar/progressStatusBarContribution.ts";
import {
    StatusBarComponent,
    StatusBarComponentDIToken,
} from "../../workbench/browser/parts/statusbar/statusBarComponent.ts";
import {
    ViewProgressContribution,
    ViewProgressContributionDIToken,
} from "../../workbench/browser/parts/views/viewProgressContribution.ts";
import { ViewsService, ViewsServiceDIToken } from "../../workbench/browser/parts/views/viewsService.ts";
import {
    ViewTitleActionsContribution,
    ViewTitleActionsContributionDIToken,
} from "../../workbench/browser/parts/views/viewTitleActionsContribution.ts";
import {
    SetContextCommandContribution,
    SetContextCommandContributionDIToken,
} from "../../workbench/browser/setContextCommandContribution.ts";
import { WorkbenchComponent, WorkbenchComponentDIToken } from "../../workbench/browser/workbenchComponent.ts";
import { WorkbenchContextKeys, WorkbenchContextKeysDIToken } from "../../workbench/browser/workbenchContextKeys.ts";
import { WorkbenchStateService, WorkbenchStateServiceDIToken } from "../../workbench/browser/workbenchStateService.ts";
import {
    WorkbenchContributionsDIToken,
    WorkbenchContributionsRegistry,
    WorkbenchContributionsRegistryDIToken,
} from "../../workbench/common/workbenchContributionsRegistry.ts";
import { BulkEditBuffers } from "../../workbench/contrib/bulkEdit/browser/bulkEditBuffers.ts";
import { IBulkEditBuffersDIToken } from "../../workbench/contrib/bulkEdit/common/iBulkEditBuffers.ts";
import { createDiffEditorPaneFactory } from "../../workbench/contrib/diff/browser/diffEditorPaneFactory.ts";
import {
    DiffSnapshotRefreshContribution,
    DiffSnapshotRefreshContributionDIToken,
} from "../../workbench/contrib/diff/browser/diffSnapshotRefreshContribution.ts";
import {
    VscodeDiffCommandContribution,
    VscodeDiffCommandContributionDIToken,
} from "../../workbench/contrib/diff/browser/vscodeDiffCommandContribution.ts";
import {
    AutoRevealContribution,
    AutoRevealContributionDIToken,
} from "../../workbench/contrib/files/browser/autoRevealContribution.ts";
import {
    ExplorerComponent,
    ExplorerComponentDIToken,
} from "../../workbench/contrib/files/browser/explorerComponent.ts";
import { ExplorerService, ExplorerServiceDIToken } from "../../workbench/contrib/files/browser/explorerService.ts";
import { WorkspaceFolderOpenerDIToken } from "../../workbench/contrib/files/browser/fileActions.ts";
import {
    FileOperationsService,
    FileOperationsServiceDIToken,
} from "../../workbench/contrib/files/browser/fileOperationsService.ts";
import {
    InputWidgetService,
    InputWidgetServiceDIToken,
} from "../../workbench/contrib/files/browser/inputWidgetService.ts";
import {
    OpenFileCommandContribution,
    OpenFileCommandContributionDIToken,
} from "../../workbench/contrib/files/browser/openFileCommandContribution.ts";
import { FindComponent, FindComponentDIToken } from "../../workbench/contrib/find/browser/findComponent.ts";
import { FindService, FindServiceDIToken } from "../../workbench/contrib/find/browser/findService.ts";
import {
    DefinitionService,
    DefinitionServiceDIToken,
} from "../../workbench/contrib/gotoDefinition/browser/definitionService.ts";
import { HoverComponent, HoverComponentDIToken } from "../../workbench/contrib/hover/browser/hoverComponent.ts";
import { HoverService, HoverServiceDIToken } from "../../workbench/contrib/hover/browser/hoverService.ts";
import {
    InlineCompletionsService,
    InlineCompletionsServiceDIToken,
} from "../../workbench/contrib/inlineCompletions/browser/inlineCompletionsService.ts";
import {
    DiagnosticsEditorSourceDIToken,
    DiagnosticsService,
    DiagnosticsServiceDIToken,
} from "../../workbench/contrib/markers/browser/diagnosticsService.ts";
import {
    MarkerRevealTargetDIToken,
    ProblemsComponent,
    ProblemsComponentDIToken,
} from "../../workbench/contrib/markers/browser/problemsComponent.ts";
import {
    OutputChannelActions,
    OutputChannelActionsDIToken,
} from "../../workbench/contrib/output/browser/outputChannelActions.ts";
import { OutputComponent, OutputComponentDIToken } from "../../workbench/contrib/output/browser/outputComponent.ts";
import {
    ParameterHintsComponent,
    ParameterHintsComponentDIToken,
} from "../../workbench/contrib/parameterHints/browser/parameterHintsComponent.ts";
import {
    ParameterHintsService,
    ParameterHintsServiceDIToken,
} from "../../workbench/contrib/parameterHints/browser/parameterHintsService.ts";
import { createKeybindingsEditorPaneFactory } from "../../workbench/contrib/preferences/browser/keybindingsEditorPaneFactory.ts";
import {
    CommandsQuickAccessProvider,
    CommandsQuickAccessProviderDIToken,
} from "../../workbench/contrib/quickaccess/browser/commandsQuickAccessProvider.ts";
import {
    FilesQuickAccessProvider,
    FilesQuickAccessProviderDIToken,
} from "../../workbench/contrib/quickaccess/browser/filesQuickAccessProvider.ts";
import {
    GotoLineEditorSourceDIToken,
    GotoLineQuickAccessProvider,
    GotoLineQuickAccessProviderDIToken,
} from "../../workbench/contrib/quickaccess/browser/gotoLineQuickAccessProvider.ts";
import {
    OpenEditorsQuickAccessProvider,
    OpenEditorsQuickAccessProviderDIToken,
    OpenEditorsSourceDIToken,
} from "../../workbench/contrib/quickaccess/browser/openEditorsQuickAccessProvider.ts";
import { QUICK_ACCESS_PROVIDERS } from "../../workbench/contrib/quickaccess/browser/quickAccessProviders.ts";
import {
    QuickOpenService,
    QuickOpenServiceDIToken,
} from "../../workbench/contrib/quickaccess/browser/quickOpenService.ts";
import {
    QuickAccessProvidersDIToken,
    QuickAccessRegistry,
    QuickAccessRegistryDIToken,
} from "../../workbench/contrib/quickaccess/common/quickAccessRegistry.ts";
import {
    ReferencesComponent,
    ReferencesComponentDIToken,
    ReferencesRevealTargetDIToken,
} from "../../workbench/contrib/references/browser/referencesComponent.ts";
import {
    ReferencesService,
    ReferencesServiceDIToken,
} from "../../workbench/contrib/references/browser/referencesService.ts";
import { RenameService, RenameServiceDIToken } from "../../workbench/contrib/rename/browser/renameService.ts";
import { ChangesComponent, ChangesComponentDIToken } from "../../workbench/contrib/scm/browser/changesComponent.ts";
import { ScmChangesService, ScmChangesServiceDIToken } from "../../workbench/contrib/scm/browser/changesService.ts";
import { CommandOriginalResourceProvider } from "../../workbench/contrib/scm/browser/commandOriginalResourceProvider.ts";
import { ScmGraphService, ScmGraphServiceDIToken } from "../../workbench/contrib/scm/browser/graphService.ts";
import {
    GraphViewComponent,
    GraphViewComponentDIToken,
} from "../../workbench/contrib/scm/browser/graphViewComponent.ts";
import {
    OriginalResourceProviderDIToken,
    QuickDiffEditorSourceDIToken,
    QuickDiffService,
    QuickDiffServiceDIToken,
} from "../../workbench/contrib/scm/browser/quickDiffService.ts";
import {
    ScmRepoStateService,
    ScmRepoStateServiceDIToken,
} from "../../workbench/contrib/scm/browser/repoStateService.ts";
import {
    ScmBusyContextContribution,
    ScmBusyContextContributionDIToken,
} from "../../workbench/contrib/scm/browser/scmBusyContextContribution.ts";
import { ScmInputComponent, ScmInputComponentDIToken } from "../../workbench/contrib/scm/browser/scmInputComponent.ts";
import {
    ScmStatusBarContribution,
    ScmStatusBarContributionDIToken,
} from "../../workbench/contrib/scm/browser/scmStatusBarContribution.ts";
import {
    SearchComponent,
    SearchComponentDIToken,
    SearchRevealTargetDIToken,
} from "../../workbench/contrib/search/browser/searchComponent.ts";
import {
    CompletionService,
    CompletionServiceDIToken,
} from "../../workbench/contrib/suggest/browser/completionService.ts";
import { SuggestComponent, SuggestComponentDIToken } from "../../workbench/contrib/suggest/browser/suggestComponent.ts";
import {
    TerminalFocusFallbackDIToken,
    TerminalPanelComponent,
    TerminalPanelComponentDIToken,
} from "../../workbench/contrib/terminal/browser/terminalPanelComponent.ts";
import { TerminalService, TerminalServiceDIToken } from "../../workbench/contrib/terminal/browser/terminalService.ts";
import { TerminalSessionFactoryDIToken } from "../../workbench/contrib/terminal/common/terminalSessionFactory.ts";
import { EmbeddedTerminalSession } from "../../workbench/contrib/terminal/node/embeddedTerminalSession.ts";
import {
    ThemeConfigContribution,
    ThemeConfigContributionDIToken,
} from "../../workbench/contrib/themes/browser/themeConfigContribution.ts";
import { DialogService, DialogServiceDIToken } from "../../workbench/services/dialogs/browser/dialogService.ts";
import {
    EditorPaneFactoriesDIToken,
    type EditorPaneFactoryCtor,
} from "../../workbench/services/editor/browser/editorPaneFactory.ts";
import { EditorService, EditorServiceDIToken } from "../../workbench/services/editor/browser/editorService.ts";
import {
    TextEditorPaneBuilder,
    TextEditorPaneBuilderDIToken,
} from "../../workbench/services/editor/browser/textEditorPaneBuilder.ts";
import { ExternalOpenerDIToken } from "../../workbench/services/externalOpener/common/iExternalOpener.ts";
import {
    ExternalOpenerService,
    spawnDetached,
} from "../../workbench/services/externalOpener/node/externalOpenerService.ts";
import { FocusTracker, FocusTrackerDIToken } from "../../workbench/services/focus/browser/focusTracker.ts";
import {
    HistoryEditorSourceDIToken,
    HistoryService,
    HistoryServiceDIToken,
    JumpRecorderDIToken,
} from "../../workbench/services/history/browser/historyService.ts";
import {
    KeybindingDispatcher,
    KeybindingDispatcherDIToken,
} from "../../workbench/services/keybinding/browser/keybindingDispatcher.ts";
import { LayoutService, LayoutServiceDIToken } from "../../workbench/services/layout/browser/layoutService.ts";
import {
    LifecycleService,
    LifecycleServiceDIToken,
} from "../../workbench/services/lifecycle/browser/lifecycleService.ts";
import {
    NotificationService,
    NotificationServiceDIToken,
} from "../../workbench/services/notification/browser/notificationService.ts";
import { OutputChannelRegistryDIToken } from "../../workbench/services/output/common/output.ts";
import { OutputChannelRegistry } from "../../workbench/services/output/common/outputChannelRegistry.ts";
import { OutputService, OutputServiceDIToken } from "../../workbench/services/output/common/outputService.ts";
import { FileSearchServiceDIToken } from "../../workbench/services/search/common/fileSearch.ts";
import { TextSearchServiceDIToken } from "../../workbench/services/search/common/textSearch.ts";
import { FileSearchService } from "../../workbench/services/search/node/fileSearchService.ts";
import { TextSearchService } from "../../workbench/services/search/node/textSearchService.ts";
import {
    StatusBarService,
    StatusBarServiceDIToken,
} from "../../workbench/services/statusbar/common/statusBarService.ts";
import {
    TerminalEnvContextKeysContribution,
    TerminalEnvContextKeysContributionDIToken,
} from "../../workbench/services/terminalEnvironment/node/terminalEnvContextKeysContribution.ts";
import {
    TerminalEnvStatusContribution,
    TerminalEnvStatusContributionDIToken,
} from "../../workbench/services/terminalEnvironment/node/terminalEnvStatusContribution.ts";
import {
    TextFileModelService,
    TextFileModelServiceDIToken,
} from "../../workbench/services/textfile/common/textFileModelService.ts";
import {
    MENU_CONTRIBUTIONS,
    WORKBENCH_ACTIONS,
    WORKBENCH_CONTEXT_KEY_CONTRIBUTORS,
    WORKBENCH_CONTRIBUTIONS,
} from "../../workbench/workbench.common.main.ts";

/** Фабрики вкладок из contrib — по одной на вид вкладки (см. `IEditorPaneFactory`). */
const EDITOR_PANE_FACTORIES: readonly EditorPaneFactoryCtor[] = [
    createKeybindingsEditorPaneFactory,
    createDiffEditorPaneFactory,
];

/**
 * Пары Service ↔ Component слоя Workbench (пилот — статус-бар, этап 4
 * рефакторинга; Panel-кластер — этап 6; Editor-кластер — этап 9) плюс корневой
 * `WorkbenchComponent` (этап 12). Здесь же — интерфейсные швы Workbench:
 * `EditorService` выполняет их структурно (`ActiveEditorStatusSourceDIToken` /
 * `DiagnosticsEditorSourceDIToken` / `MarkerRevealTargetDIToken` /
 * `GotoLineEditorSourceDIToken` / `TerminalFocusFallbackDIToken`), смену папки воркспейса (Open Folder)
 * структурно выполняет `WorkbenchComponent` (`WorkspaceFolderOpenerDIToken`).
 */
export const workbenchModule: ContainerModule = (container) => {
    container.bind(StatusBarServiceDIToken, StatusBarService);
    // Прогресс длительных операций: модель + общий такт спиннеров (кадры
    // разбирают потребители — заголовки view и статус-бар).
    container.bind(ProgressServiceDIToken, ProgressService);
    container.bind(ProgressStatusBarContributionDIToken, ProgressStatusBarContribution);
    // Клавиатурный диспатчер: чорды/armory/swallow + chord-хинт в статус-баре.
    // View-хуки (updateContextKeys, hasKeyboardCapturingOverlay) подключает владелец
    // корневого дерева — WorkbenchComponent.
    container.bind(KeybindingDispatcherDIToken, KeybindingDispatcher);
    // Модальные диалоги: хост (BodyElement с overlay-слоем) прикрепляет владелец
    // корневого дерева — WorkbenchComponent — через attachHost() после построения view.
    container.bind(DialogServiceDIToken, DialogService);
    // Сообщения человеку: сервис (очередь показов и самогашение) + компонент
    // (стек тостов над статус-баром и окно модального сообщения; overlay-хост
    // прикрепляет WorkbenchComponent через attachHost).
    container.bind(NotificationServiceDIToken, NotificationService);
    container.bind(NotificationsComponentDIToken, NotificationsComponent);
    // Неудача открытия ресурса — человеку тостом (см. EditorService.onDidFailOpen).
    container.bind(OpenFailureNotificationContributionDIToken, OpenFailureNotificationContribution);
    // Открытие внешних ссылок (env.openExternal расширений): системный
    // обработчик, а без графического сеанса — URL в буфер и сообщением на экран.
    // Швы отдаём колбэками: сервис в `node`, а поверхность сообщений в `browser`.
    container.bind(ExternalOpenerDIToken, () => {
        const notifications = container.get(NotificationServiceDIToken);
        return new ExternalOpenerService({
            platform: process.platform,
            env: process.env,
            launch: spawnDetached,
            clipboard: container.get(ClipboardDIToken),
            showInfo: (message) => {
                notifications.show({ severity: "info", message, modal: false, items: [] });
            },
        });
    });
    // Shutdown-протокол: confirm-save участников (WorkbenchComponent записывает
    // EditorService) и единое прощание — участники подписываются там, где создаются.
    container.bind(LifecycleServiceDIToken, LifecycleService);
    // Explorer-кластер (этап 7): сервис (корень/провайдер/reveal/декорации),
    // компонент (дерево + контекст-меню), файловые операции и целевой сервис
    // input-команд (активный InputElement; читают экшены Actions/InputActions).
    container.bind(ExplorerServiceDIToken, ExplorerService);
    container.bind(ExplorerComponentDIToken, ExplorerComponent);
    container.bind(TextSearchServiceDIToken, TextSearchService);
    container.bind(SearchComponentDIToken, SearchComponent);
    container.bind(FileOperationsServiceDIToken, FileOperationsService);
    container.bind(InputWidgetServiceDIToken, InputWidgetService);
    // QuickInput-кластер (этап 8): общий виджет-компонент (host прикрепляет
    // WorkbenchComponent через attachHost), InputBox/list-pick сервис и Quick Open
    // (файлы/команды/goto-line) поверх файлового индекса. Швы: активный редактор
    // для goto-line — EditorService, смена папки воркспейса (Open Folder) —
    // WorkbenchComponent структурно.
    container.bind(QuickInputComponentDIToken, QuickInputComponent);
    container.bind(QuickInputServiceDIToken, QuickInputService);
    container.bind(FileSearchServiceDIToken, FileSearchService);
    container.bind(GotoLineEditorSourceDIToken, () => container.get(EditorServiceDIToken));
    // Швы пикера открытых редакторов: список вкладок и переход — EditorService.
    // Папки воркспейса для путей-описаний пикер берёт из IWorkspaceContextService
    // сам — отдельного шва под «корень» больше нет.
    container.bind(OpenEditorsSourceDIToken, () => container.get(EditorServiceDIToken));
    // Quick-access-провайдеры: явный список (QUICK_ACCESS_PROVIDERS) + реестр,
    // выбирающий провайдера по префиксу запроса; QuickOpenService — контроллер
    // показа, о конкретных префиксах не знает.
    container.bind(FilesQuickAccessProviderDIToken, FilesQuickAccessProvider);
    container.bind(CommandsQuickAccessProviderDIToken, CommandsQuickAccessProvider);
    container.bind(GotoLineQuickAccessProviderDIToken, GotoLineQuickAccessProvider);
    container.bind(OpenEditorsQuickAccessProviderDIToken, OpenEditorsQuickAccessProvider);
    container.bind(QuickAccessProvidersDIToken, () => QUICK_ACCESS_PROVIDERS);
    container.bind(QuickAccessRegistryDIToken, QuickAccessRegistry);
    container.bind(QuickOpenServiceDIToken, QuickOpenService);
    container.bind(WorkspaceFolderOpenerDIToken, () => container.get(WorkbenchComponentDIToken));
    // Editor-кластер (этап 9b): логика полосы групп редакторов (открытые
    // TextEditorPane-пары, активная вкладка, MRU) + часть «область редактора»
    // (по групповому контролу tab strip + контент на группу).
    // Модели файлов и сборка вью вкладок — отдельно от EditorService (E1):
    // группам и диффу они нужны без полосы вкладок.
    container.bind(TextFileModelServiceDIToken, TextFileModelService);
    container.bind(TextEditorPaneBuilderDIToken, TextEditorPaneBuilder);
    container.bind(EditorServiceDIToken, EditorService);
    // Фабрики вкладок из contrib (рецепт вкладки для сплита и рестора сессии) —
    // явный список; фабрика ходит в контейнер лениво, в момент открытия.
    container.bind(EditorPaneFactoriesDIToken, () => EDITOR_PANE_FACTORIES.map((create) => create(container)));
    // `workspace.applyEdit` правит ОТКРЫТЫЙ ресурс через его буфер, а не через
    // диск (иначе буфер и файл разъехались бы), и кладёт свой единственный шаг
    // отмены в бакет тронутой вкладки. И то и другое знает только полоса групп
    // редакторов, а исполнитель правок живёт в node-слое — доступ он получает
    // отсюда.
    container.bind(
        IBulkEditBuffersDIToken,
        () => new BulkEditBuffers(container.get(EditorServiceDIToken), container.get(TextFileModelServiceDIToken)),
    );
    container.bind(EditorPartComponentDIToken, EditorPartComponent);
    // Оверлей серии Ctrl+Tab: видимый MRU-список вкладок текущей группы.
    container.bind(TabSwitcherComponentDIToken, TabSwitcherComponent);
    // Find/Suggest-кластер (этап 10): компоненты владеют виджетами и
    // overlay-сессиями (suggest — глобальный body-слой у каретки, find —
    // локальный слой группы; host'ы прикрепляет WorkbenchComponent через attachHost),
    // сервисы — логикой (FindService: query→matches→index; CompletionService:
    // источники/триггеры/accept, item.command → CommandRegistry напрямую).
    container.bind(SuggestComponentDIToken, SuggestComponent);
    container.bind(CompletionServiceDIToken, CompletionService);
    // Призрачные подсказки (inline suggest): сервис без компонента — ghost text
    // рисует сам редактор (TextEditorPane.setGhostText), источник — провайдеры
    // расширений из реестра inlineCompletionsProvider.
    container.bind(InlineCompletionsServiceDIToken, InlineCompletionsService);
    // Go to Definition: сервис без компонента — цели отдают definition-провайдеры
    // реестра ILanguageFeaturesService, навигация — паттерн Problems reveal.
    container.bind(DefinitionServiceDIToken, DefinitionService);
    // Hover: пара по образцу suggest — компонент владеет попапом и его
    // overlay-сессией (host прикрепляет WorkbenchComponent), сервис — логикой
    // (hover-провайдеры реестра, стрип markdown, закрытие по фокусу/каретке).
    container.bind(HoverComponentDIToken, HoverComponent);
    container.bind(HoverServiceDIToken, HoverService);
    // Подсказка параметров: та же пара — компонент владеет попапом у каретки,
    // сервис спрашивает signature-help-провайдеров реестра и ловит набор триггер-символов.
    container.bind(ParameterHintsComponentDIToken, ParameterHintsComponent);
    container.bind(ParameterHintsServiceDIToken, ParameterHintsService);
    // References: вьюлет сайдбара со ссылками + сервис, который его наполняет
    // (references-провайдеры реестра → текст строк → панель).
    container.bind(ReferencesComponentDIToken, ReferencesComponent);
    container.bind(ReferencesServiceDIToken, ReferencesService);
    // Rename Symbol: сервис поверх реестра rename-провайдеров (поле нового
    // имени — quick input, правки накладывает провайдер через workspace.applyEdit).
    container.bind(RenameServiceDIToken, RenameService);
    // История навигации (Go Back / Go Forward): сервис поверх той же полосы групп.
    // Он же IJumpRecorder — шов, которым сайты прыжков сообщают о переходе.
    container.bind(HistoryEditorSourceDIToken, () => container.get(EditorServiceDIToken));
    container.bind(HistoryServiceDIToken, HistoryService);
    container.bind(JumpRecorderDIToken, () => container.get(HistoryServiceDIToken));
    container.bind(FindComponentDIToken, FindComponent);
    container.bind(FindServiceDIToken, FindService);
    container.bind(ActiveEditorStatusSourceDIToken, () => container.get(EditorServiceDIToken));
    container.bind(EditorStatusContributionDIToken, EditorStatusContribution);
    container.bind(TerminalEnvStatusContributionDIToken, TerminalEnvStatusContribution);
    container.bind(TerminalEnvContextKeysContributionDIToken, TerminalEnvContextKeysContribution);
    container.bind(StatusBarComponentDIToken, StatusBarComponent);
    // Реестр workbench-contributions: явный список (WORKBENCH_CONTRIBUTIONS) +
    // сам реестр, инстанцирующий их по фазам LifecycleService (подписку держит
    // WorkbenchComponent): ready — в mount(), eventually — после первого кадра.
    container.bind(WorkbenchContributionsDIToken, () => WORKBENCH_CONTRIBUTIONS);
    container.bind(WorkbenchContributionsRegistryDIToken, WorkbenchContributionsRegistry);
    // Реестр declarative menu-contributions: явный список MENU_CONTRIBUTIONS +
    // реестр (данные) + MenuService (живые IMenu), из которых собираются
    // контекст-меню (редактор, Explorer) и меню-бар.
    container.bind(MenuContributionsDIToken, () => MENU_CONTRIBUTIONS);
    // Встроенные экшены (WORKBENCH_ACTIONS агрегатора) — их регистрирует WorkbenchComponent.
    container.bind(CommandActionsDIToken, () => WORKBENCH_ACTIONS);
    container.bind(MenuRegistryDIToken, MenuRegistry);
    container.bind(MenuServiceDIToken, MenuService);
    container.bind(ContextMenuServiceDIToken, ContextMenuService);
    // Пилот editor-скоупа DI: политика контекстного меню редактора живёт в
    // editor/contrib (как у vscode), биндится здесь как обычный сервис.
    container.bind(EditorContextMenuControllerDIToken, EditorContextMenuController);
    container.bind(AutoRevealContributionDIToken, AutoRevealContribution);
    container.bind(ThemeConfigContributionDIToken, ThemeConfigContribution);
    container.bind(OpenFileCommandContributionDIToken, OpenFileCommandContribution);
    // Stryker disable next-line ArrowFunction: биндинг DI без юнита; сквозняк — e2e-сценарий extension-storage
    container.bind(SetContextCommandContributionDIToken, SetContextCommandContribution);
    // Panel-кластер (этап 6): реестр вкладок нижней панели + компонент-контрол,
    // Problems-дерево и встроенный терминал (сервис инстансов + view-владелец).
    container.bind(PanelServiceDIToken, PanelService);
    container.bind(PanelComponentDIToken, PanelComponent);
    container.bind(PanelFocusContributionDIToken, PanelFocusContribution);
    container.bind(ProblemsComponentDIToken, ProblemsComponent);
    // Output-кластер: реестр каналов (аналог IOutputChannelRegistry), модель
    // панели и её view-владелец. Человекочитаемое имя канала объявляет его
    // создатель (`createLogger(id, { label })`) — OutputService переносит его из
    // лога; незаявленные доберёт сам с `label = id`.
    container.bind(OutputChannelRegistryDIToken, () => new OutputChannelRegistry());
    container.bind(OutputServiceDIToken, OutputService);
    container.bind(OutputComponentDIToken, OutputComponent);
    container.bind(OutputChannelActionsDIToken, OutputChannelActions);
    // Прод-фабрика сессий терминала: реальная связка node-pty + @xterm/headless.
    // Тестовый профиль перебивает биндинг на FakeTerminalSurface (см. TestProfile).
    container.bind(TerminalSessionFactoryDIToken, () => (options) => new EmbeddedTerminalSession(options));
    container.bind(TerminalServiceDIToken, TerminalService);
    // Куда уходит фокус, когда последний шелл вышел и виджет ушёл со сцены.
    container.bind(TerminalFocusFallbackDIToken, () => container.get(EditorServiceDIToken));
    container.bind(TerminalPanelComponentDIToken, TerminalPanelComponent);
    // Диагностики: поставщики → MarkerService → потребители (squiggles, Problems).
    container.bind(DiagnosticsEditorSourceDIToken, () => container.get(EditorServiceDIToken));
    container.bind(MarkerRevealTargetDIToken, () => container.get(EditorServiceDIToken));
    // Открытие результата поиска на позиции — тот же структурный срез EditorService.
    container.bind(SearchRevealTargetDIToken, () => container.get(EditorServiceDIToken));
    // Открытие ссылки на позиции — тот же структурный срез EditorService.
    container.bind(ReferencesRevealTargetDIToken, () => container.get(EditorServiceDIToken));
    container.bind(DiagnosticsServiceDIToken, DiagnosticsService);
    // Quick diff: живые change-bars в гуттере. Оригинал спрашиваем у SCM-расширения
    // командой, читаем через реестр провайдеров ФС, диффаем против живого буфера.
    // Гейт detached: с дифф-вкладки v2 getActiveEditor() отдаёт её сторону —
    // класть quick-diff-бары в гуттер стороны (или Output) нельзя, у диффа
    // своя разметка. Событие смены активного редактора и так отдаёт null для
    // не-текстовых вкладок — фильтр нужен только опрашивающему пути.
    container.bind(QuickDiffEditorSourceDIToken, () => {
        const editors = container.get(EditorServiceDIToken);
        return {
            getActiveEditor: () => {
                const editor = editors.getActiveEditor();
                return editor !== null && !editor.detached ? editor : null;
            },
            onActiveEditorChanged: (listener) => editors.onActiveEditorChanged(listener),
        };
    });
    container.bind(
        OriginalResourceProviderDIToken,
        () => new CommandOriginalResourceProvider(container.get(CommandRegistryDIToken)),
    );
    container.bind(QuickDiffServiceDIToken, QuickDiffService);
    container.bind(DiffSnapshotRefreshContributionDIToken, DiffSnapshotRefreshContribution);
    container.bind(VscodeDiffCommandContributionDIToken, VscodeDiffCommandContribution);
    // Вкладка Changes: расширение пушит набор изменений в ScmChangesService
    // (команда `diode.scm.publishChanges`), ChangesComponent показывает его
    // списком в нижней Panel и по клику открывает дифф этапа 5.
    container.bind(ScmChangesServiceDIToken, ScmChangesService);
    container.bind(ChangesComponentDIToken, ChangesComponent);
    // View Graph: расширение пушит последние коммиты в ScmGraphService
    // (команда `diode.scm.publishLog`), GraphViewComponent — секция GRAPH.
    container.bind(ScmGraphServiceDIToken, ScmGraphService);
    container.bind(GraphViewComponentDIToken, GraphViewComponent);
    // Commit input box — header контейнера Source Control.
    container.bind(ScmInputComponentDIToken, ScmInputComponent);
    // Снимок состояния репозитория (ветка/remotes/merge-rebase) → when-ключи git*.
    container.bind(ScmRepoStateServiceDIToken, ScmRepoStateService);
    // Ветка + sync-счётчики в статус-баре.
    container.bind(ScmStatusBarContributionDIToken, ScmStatusBarContribution);
    container.bind(ScmBusyContextContributionDIToken, ScmBusyContextContribution);
    // Этап 11: layout-логика (сайдбар/панель + персист layout'а; сам
    // WorkbenchLayoutElement приходит от владельца view через attachLayout),
    // персист открытых редакторов, контекст-ключи workbench'а (замыкают
    // KeybindingDispatcher.updateContextKeys; корневая view — через attachView)
    // и главное меню (пункты — из MenuRegistry, контрол — MenuBarComponent).
    container.bind(LayoutServiceDIToken, LayoutService);
    // Сайдбар: реестр вьюлетов + переключатель Explorer ↔ Source Control
    // (activity bar'а нет, переключают команды workbench.view.*).
    container.bind(SidebarServiceDIToken, SidebarService);
    // View-секции внутри вьюлета (PaneView): реестр, сборка контейнера,
    // персист свёрнутости/весов, меню «⋯».
    container.bind(ViewsServiceDIToken, ViewsService);
    container.bind(ViewProgressContributionDIToken, ViewProgressContribution);
    container.bind(ViewTitleActionsContributionDIToken, ViewTitleActionsContribution);
    container.bind(WorkbenchStateServiceDIToken, WorkbenchStateService);
    // Смена фокуса как событие: на неё подписываются попапы редактора.
    container.bind(FocusTrackerDIToken, FocusTracker);
    // Фичи, которые сами выставляют свои контекст-ключи (опрашивает WorkbenchContextKeys).
    container.bind(ContextKeyContributorsDIToken, () => WORKBENCH_CONTEXT_KEY_CONTRIBUTORS);
    container.bind(WorkbenchContextKeysDIToken, WorkbenchContextKeys);
    container.bind(MenuBarComponentDIToken, MenuBarComponent);
    // Этап 12: корневой компонент приложения — владелец корневой view и
    // bootstrap-жизненного цикла (mount/activate ведёт main.ts).
    container.bind(WorkbenchComponentDIToken, WorkbenchComponent);
};
