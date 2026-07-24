import { MenuContributionsDIToken } from "../../platform/actions/common/iMenuContribution.ts";
import { MenuRegistry, MenuRegistryDIToken } from "../../platform/actions/common/menuRegistry.ts";
import { MenuService, MenuServiceDIToken } from "../../platform/actions/common/menuService.ts";
import { CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import { QuitHandlerDIToken } from "../../workbench/browser/actions/appActions.ts";
import { MENU_CONTRIBUTIONS } from "../../workbench/browser/actions/menuContributions.ts";
import { MenuBarComponent, MenuBarComponentDIToken } from "../../workbench/browser/menuBarComponent.ts";
import {
    EditorContextMenuContribution,
    EditorContextMenuContributionDIToken,
} from "../../workbench/browser/parts/editor/editorContextMenuContribution.ts";
import {
    EditorGroupComponent,
    EditorGroupComponentDIToken,
} from "../../workbench/browser/parts/editor/editorGroupComponent.ts";
import {
    ActiveEditorStatusSourceDIToken,
    EditorStatusContribution,
    EditorStatusContributionDIToken,
} from "../../workbench/browser/parts/editor/editorStatusContribution.ts";
import { PanelComponent, PanelComponentDIToken } from "../../workbench/browser/parts/panel/panelComponent.ts";
import { SidebarService, SidebarServiceDIToken } from "../../workbench/browser/parts/sidebar/sidebarService.ts";
import {
    PanelFocusContribution,
    PanelFocusContributionDIToken,
} from "../../workbench/browser/parts/panel/panelFocusContribution.ts";
import { PanelService, PanelServiceDIToken } from "../../workbench/browser/parts/panel/panelService.ts";
import { OutputChannelActions, OutputChannelActionsDIToken } from "../../workbench/contrib/output/browser/outputChannelActions.ts";
import { OutputComponent, OutputComponentDIToken } from "../../workbench/contrib/output/browser/outputComponent.ts";
import { OutputChannelRegistryDIToken } from "../../workbench/services/output/common/output.ts";
import { OutputChannelRegistry } from "../../workbench/services/output/common/outputChannelRegistry.ts";
import { OutputService, OutputServiceDIToken } from "../../workbench/services/output/common/outputService.ts";
import {
    QuickInputComponent,
    QuickInputComponentDIToken,
} from "../../workbench/browser/parts/quickinput/quickInputComponent.ts";
import {
    QuickInputService,
    QuickInputServiceDIToken,
} from "../../workbench/browser/parts/quickinput/quickInputService.ts";
import {
    StatusBarComponent,
    StatusBarComponentDIToken,
} from "../../workbench/browser/parts/statusbar/statusBarComponent.ts";
import { WorkbenchComponent, WorkbenchComponentDIToken } from "../../workbench/browser/workbenchComponent.ts";
import { WorkbenchContextKeys, WorkbenchContextKeysDIToken } from "../../workbench/browser/workbenchContextKeys.ts";
import { WORKBENCH_CONTRIBUTIONS } from "../../workbench/browser/workbenchContributions.ts";
import { WorkbenchStateService, WorkbenchStateServiceDIToken } from "../../workbench/browser/workbenchStateService.ts";
import {
    WorkbenchContributionsDIToken,
    WorkbenchContributionsRegistry,
    WorkbenchContributionsRegistryDIToken,
} from "../../workbench/common/workbenchContributionsRegistry.ts";
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
import { ChangesComponent, ChangesComponentDIToken } from "../../workbench/contrib/scm/browser/changesComponent.ts";
import { ScmChangesService, ScmChangesServiceDIToken } from "../../workbench/contrib/scm/browser/changesService.ts";
import { CommandOriginalResourceProvider } from "../../workbench/contrib/scm/browser/commandOriginalResourceProvider.ts";
import {
    OriginalResourceProviderDIToken,
    QuickDiffEditorSourceDIToken,
    QuickDiffService,
    QuickDiffServiceDIToken,
} from "../../workbench/contrib/scm/browser/quickDiffService.ts";
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
import { EditorService, EditorServiceDIToken } from "../../workbench/services/editor/browser/editorService.ts";
import {
    KeybindingDispatcher,
    KeybindingDispatcherDIToken,
} from "../../workbench/services/keybinding/browser/keybindingDispatcher.ts";
import { LayoutService, LayoutServiceDIToken } from "../../workbench/services/layout/browser/layoutService.ts";
import {
    LifecycleService,
    LifecycleServiceDIToken,
} from "../../workbench/services/lifecycle/browser/lifecycleService.ts";
import { FileSearchService, FileSearchServiceDIToken } from "../../workbench/services/search/node/fileSearchService.ts";
import {
    StatusBarService,
    StatusBarServiceDIToken,
} from "../../workbench/services/statusbar/common/statusBarService.ts";
import {
    TerminalEnvStatusContribution,
    TerminalEnvStatusContributionDIToken,
} from "../../workbench/services/terminalEnvironment/node/terminalEnvStatusContribution.ts";

/**
 * Пары Service ↔ Component слоя Workbench (пилот — статус-бар, этап 4
 * рефакторинга; Panel-кластер — этап 6; Editor-кластер — этап 9) плюс корневой
 * `WorkbenchComponent` (этап 12). Здесь же — интерфейсные швы Workbench:
 * `EditorService` выполняет их структурно (`ActiveEditorStatusSourceDIToken` /
 * `DiagnosticsEditorSourceDIToken` / `MarkerRevealTargetDIToken` /
 * `GotoLineEditorSourceDIToken` / `TerminalFocusFallbackDIToken`), смену папки воркспейса (Open Folder)
 * структурно выполняет `WorkbenchComponent` (`WorkspaceFolderOpenerDIToken`).
 */
/**
 * Человекочитаемые имена каналов логов для селектора Output (аналог того, что в
 * VS Code даёт `ILoggerService.getRegisteredLoggers().name`). Канал, которого
 * здесь нет, всё равно появится в списке — но под своим сырым id.
 */
const KNOWN_OUTPUT_CHANNELS: readonly (readonly [id: string, label: string])[] = [
    ["bootstrap", "Bootstrap"],
    ["configuration", "Configuration"],
    ["extensions", "Extensions"],
    ["extensions.host", "Extension Host"],
    ["extensions.host.rpc", "Extension Host (RPC)"],
    ["extensions.host.stdout", "Extension Host (stdout)"],
    ["extensions.host.stderr", "Extension Host (stderr)"],
    ["files.watcher", "File Watcher"],
    ["filetree.watcher", "File Tree Watcher"],
    ["input.keybindings", "Keybindings"],
];

export const workbenchModule: ContainerModule = (container) => {
    container.bind(StatusBarServiceDIToken, () => new StatusBarService());
    // Клавиатурный диспатчер: чорды/armory/swallow + chord-хинт в статус-баре.
    // View-хуки (updateContextKeys, hasKeyboardCapturingOverlay) подключает владелец
    // корневого дерева — WorkbenchComponent.
    container.bind(KeybindingDispatcherDIToken, KeybindingDispatcher);
    // Модальные диалоги: хост (BodyElement с overlay-слоем) прикрепляет владелец
    // корневого дерева — WorkbenchComponent — через attachHost() после построения view.
    container.bind(DialogServiceDIToken, DialogService);
    // Shutdown-протокол: участников регистрирует владелец приложения (WorkbenchComponent
    // записывает EditorService), выход передаётся колбэком в requestQuit().
    container.bind(LifecycleServiceDIToken, LifecycleService);
    // Explorer-кластер (этап 7): сервис (корень/провайдер/reveal/декорации),
    // компонент (дерево + контекст-меню), файловые операции и целевой сервис
    // input-команд (активный InputElement; читают экшены Actions/InputActions).
    container.bind(ExplorerServiceDIToken, ExplorerService);
    container.bind(ExplorerComponentDIToken, ExplorerComponent);
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
    // Quick-access-провайдеры: явный список (QUICK_ACCESS_PROVIDERS) + реестр,
    // выбирающий провайдера по префиксу запроса; QuickOpenService — контроллер
    // показа, о конкретных префиксах не знает.
    container.bind(FilesQuickAccessProviderDIToken, FilesQuickAccessProvider);
    container.bind(CommandsQuickAccessProviderDIToken, CommandsQuickAccessProvider);
    container.bind(GotoLineQuickAccessProviderDIToken, GotoLineQuickAccessProvider);
    container.bind(QuickAccessProvidersDIToken, () => QUICK_ACCESS_PROVIDERS);
    container.bind(QuickAccessRegistryDIToken, QuickAccessRegistry);
    container.bind(QuickOpenServiceDIToken, QuickOpenService);
    container.bind(WorkspaceFolderOpenerDIToken, () => container.get(WorkbenchComponentDIToken));
    // Выход из приложения (Ctrl+Q / меню / палитра → quitAction) — структурно
    // выполняет WorkbenchComponent (confirm-save + teardown + exit).
    container.bind(QuitHandlerDIToken, () => container.get(WorkbenchComponentDIToken));
    // Editor-кластер (этап 9b): логика группы редакторов (открытые TextEditorPane-пары,
    // активная вкладка, MRU) + компонент группового контрола (tab strip + контент).
    container.bind(EditorServiceDIToken, EditorService);
    container.bind(EditorGroupComponentDIToken, EditorGroupComponent);
    // Find/Suggest-кластер (этап 10): компоненты владеют виджетами и
    // overlay-сессиями (suggest — глобальный body-слой у каретки, find —
    // локальный слой группы; host'ы прикрепляет WorkbenchComponent через attachHost),
    // сервисы — логикой (FindService: query→matches→index; CompletionService:
    // источники/триггеры/accept, item.command → CommandRegistry напрямую).
    container.bind(SuggestComponentDIToken, SuggestComponent);
    container.bind(CompletionServiceDIToken, CompletionService);
    container.bind(FindComponentDIToken, FindComponent);
    container.bind(FindServiceDIToken, FindService);
    container.bind(ActiveEditorStatusSourceDIToken, () => container.get(EditorServiceDIToken));
    container.bind(EditorStatusContributionDIToken, EditorStatusContribution);
    container.bind(TerminalEnvStatusContributionDIToken, TerminalEnvStatusContribution);
    container.bind(StatusBarComponentDIToken, StatusBarComponent);
    // Реестр workbench-contributions: явный список (WORKBENCH_CONTRIBUTIONS) +
    // сам реестр, инстанцирующий их по фазам. Фазы прогоняет WorkbenchComponent
    // (Restored — в mount()) и main.ts (Eventually — после первого кадра).
    container.bind(WorkbenchContributionsDIToken, () => WORKBENCH_CONTRIBUTIONS);
    container.bind(WorkbenchContributionsRegistryDIToken, WorkbenchContributionsRegistry);
    // Реестр declarative menu-contributions: явный список MENU_CONTRIBUTIONS +
    // реестр (данные) + MenuService (живые IMenu), из которых собираются
    // контекст-меню (редактор, Explorer) и меню-бар.
    container.bind(MenuContributionsDIToken, () => MENU_CONTRIBUTIONS);
    container.bind(MenuRegistryDIToken, MenuRegistry);
    container.bind(MenuServiceDIToken, MenuService);
    container.bind(AutoRevealContributionDIToken, AutoRevealContribution);
    container.bind(ThemeConfigContributionDIToken, ThemeConfigContribution);
    container.bind(EditorContextMenuContributionDIToken, EditorContextMenuContribution);
    container.bind(OpenFileCommandContributionDIToken, OpenFileCommandContribution);
    // Panel-кластер (этап 6): реестр вкладок нижней панели + компонент-контрол,
    // Problems-дерево и встроенный терминал (сервис инстансов + view-владелец).
    container.bind(PanelServiceDIToken, PanelService);
    container.bind(PanelComponentDIToken, PanelComponent);
    container.bind(PanelFocusContributionDIToken, PanelFocusContribution);
    container.bind(ProblemsComponentDIToken, ProblemsComponent);
    // Output-кластер: реестр каналов (аналог IOutputChannelRegistry), модель
    // панели и её view-владелец. Каналы с человекочитаемыми именами объявляются
    // здесь — `LogService.createLogger` заводит их ad hoc и имени не знает;
    // незаявленные OutputService доберёт сам с `label = id`.
    container.bind(OutputChannelRegistryDIToken, () => {
        const registry = new OutputChannelRegistry();
        for (const [id, label] of KNOWN_OUTPUT_CHANNELS) registry.registerChannel({ id, label });
        return registry;
    });
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
    container.bind(DiagnosticsServiceDIToken, DiagnosticsService);
    // Quick diff: живые change-bars в гуттере. Оригинал спрашиваем у SCM-расширения
    // командой, читаем через реестр провайдеров ФС, диффаем против живого буфера.
    container.bind(QuickDiffEditorSourceDIToken, () => container.get(EditorServiceDIToken));
    container.bind(
        OriginalResourceProviderDIToken,
        () => new CommandOriginalResourceProvider(container.get(CommandRegistryDIToken)),
    );
    container.bind(QuickDiffServiceDIToken, QuickDiffService);
    // Вкладка Changes: расширение пушит набор изменений в ScmChangesService
    // (команда `vexx.scm.publishChanges`), ChangesComponent показывает его
    // списком в нижней Panel и по клику открывает дифф этапа 5.
    container.bind(ScmChangesServiceDIToken, ScmChangesService);
    container.bind(ChangesComponentDIToken, ChangesComponent);
    // Этап 11: layout-логика (сайдбар/панель + персист layout'а; сам
    // WorkbenchLayoutElement приходит от владельца view через attachLayout),
    // персист открытых редакторов, контекст-ключи workbench'а (замыкают
    // KeybindingDispatcher.updateContextKeys; корневая view — через attachView)
    // и главное меню (пункты — из MenuRegistry, контрол — MenuBarComponent).
    container.bind(LayoutServiceDIToken, LayoutService);
    // Сайдбар: реестр вьюлетов + переключатель Explorer ↔ Source Control
    // (activity bar'а нет, переключают команды workbench.view.*).
    container.bind(SidebarServiceDIToken, SidebarService);
    container.bind(WorkbenchStateServiceDIToken, WorkbenchStateService);
    container.bind(WorkbenchContextKeysDIToken, WorkbenchContextKeys);
    container.bind(MenuBarComponentDIToken, MenuBarComponent);
    // Этап 12: корневой компонент приложения — владелец корневой view и
    // bootstrap-жизненного цикла (mount/activate ведёт main.ts).
    container.bind(WorkbenchComponentDIToken, WorkbenchComponent);
};
