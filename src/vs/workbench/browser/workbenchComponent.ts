import type { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { WorkbenchLayoutElement } from "@tuidom/elements/workbenchlayout/workbenchLayoutElement";

import { CommandActionsDIToken, registerAction } from "../../platform/actions/common/commandAction.ts";
import type { CommandRegistry } from "../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import { ContextMenuServiceDIToken } from "../../platform/contextview/browser/contextMenuService.ts";
import type { ServiceAccessor } from "../../platform/instantiation/common/diContainer.ts";
import { token } from "../../platform/instantiation/common/diContainer.ts";
import { ServiceAccessorDIToken } from "../../platform/instantiation/common/diContainer.ts";
import type { KeybindingRegistry } from "../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingRegistryDIToken } from "../../platform/keybinding/common/keybindingRegistry.ts";
import type { IUserKeybindingRule } from "../../platform/keybinding/common/userKeybindings.ts";
import { UserKeybindingsDIToken } from "../../platform/keybinding/common/userKeybindings.ts";
import { TuiApplicationDIToken } from "../../platform/layout/browser/tuiApplicationDIToken.ts";
import { applyThemeVars } from "../../platform/theme/browser/themeStyleVars.ts";
import type { WorkspaceContextService } from "../../platform/workspace/common/workspaceContextService.ts";
import { WorkspaceContextServiceDIToken } from "../../platform/workspace/common/workspaceContextService.ts";
import {
    WorkbenchContributionsRegistry,
    WorkbenchContributionsRegistryDIToken,
} from "../common/workbenchContributionsRegistry.ts";
import { ExplorerService, ExplorerServiceDIToken } from "../contrib/files/browser/explorerService.ts";
import { type TerminalService, TerminalServiceDIToken } from "../contrib/terminal/browser/terminalService.ts";
import type { DialogService } from "../services/dialogs/browser/dialogService.ts";
import { DialogServiceDIToken } from "../services/dialogs/browser/dialogService.ts";
import type { IEditorService } from "../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";
import type { KeybindingDispatcher } from "../services/keybinding/browser/keybindingDispatcher.ts";
import { KeybindingDispatcherDIToken } from "../services/keybinding/browser/keybindingDispatcher.ts";
import { KeybindingsEditorServiceDIToken } from "../services/keybinding/common/iKeybindingsEditorService.ts";
import type { LayoutService } from "../services/layout/browser/layoutService.ts";
import { LayoutServiceDIToken } from "../services/layout/browser/layoutService.ts";
import type { LifecycleService } from "../services/lifecycle/browser/lifecycleService.ts";
import { LifecycleServiceDIToken } from "../services/lifecycle/browser/lifecycleService.ts";
import type { IFileSearchService } from "../services/search/common/fileSearch.ts";
import { FileSearchServiceDIToken } from "../services/search/common/fileSearch.ts";
import type { TerminalEnvironmentService } from "../services/terminalEnvironment/node/terminalEnvironmentService.ts";
import { TerminalEnvironmentServiceDIToken } from "../services/terminalEnvironment/node/terminalEnvironmentService.ts";
import type { ThemeService } from "../services/themes/common/themeService.ts";
import { ThemeServiceDIToken } from "../services/themes/common/themeTokens.ts";

import { withMacKeybindings } from "./actions/macKeybindings.ts";
import { Component } from "./component.ts";
import { MenuBarComponentDIToken } from "./menuBarComponent.ts";
import { EditorPartComponent, EditorPartComponentDIToken } from "./parts/editor/editorPartComponent.ts";
import { TabSwitcherComponentDIToken } from "./parts/editor/tabSwitcherComponent.ts";
import {
    type NotificationsComponent,
    NotificationsComponentDIToken,
} from "./parts/notifications/notificationsComponent.ts";
import { PanelComponentDIToken } from "./parts/panel/panelComponent.ts";
import { QuickInputComponentDIToken } from "./parts/quickinput/quickInputComponent.ts";
import type { QuickInputService } from "./parts/quickinput/quickInputService.ts";
import { QuickInputServiceDIToken } from "./parts/quickinput/quickInputService.ts";
import { type SidebarService, SidebarServiceDIToken } from "./parts/sidebar/sidebarService.ts";
import { StatusBarComponent, StatusBarComponentDIToken } from "./parts/statusbar/statusBarComponent.ts";
import { type ViewsService, ViewsServiceDIToken } from "./parts/views/viewsService.ts";
import type { WorkbenchContextKeys } from "./workbenchContextKeys.ts";
import { WorkbenchContextKeysDIToken } from "./workbenchContextKeys.ts";
import type { WorkbenchStateService } from "./workbenchStateService.ts";
import { WorkbenchStateServiceDIToken } from "./workbenchStateService.ts";

export const WorkbenchComponentDIToken = token<WorkbenchComponent>("WorkbenchComponent");

/**
 * Корневой компонент приложения (аналог Workbench-части в VS Code): владеет
 * корневой view (`BodyElement` + `WorkbenchLayoutElement`), вставляет в неё view
 * компонентов, прикрепляет late-init швы (`attachHost`/`attachLayout`/
 * `attachView`), регистрирует встроенные экшены (`CommandActionsDIToken`, список — `WORKBENCH_ACTIONS` агрегатора) и красит
 * собственные контролы (BodyElement/сэши) в {@link updateStyles}. Логика живёт
 * в сервисах Workbench.
 *
 * Фич-проводка (подписки на события, live-reload темы, контекст-меню и т.п.) —
 * НЕ здесь, а в самодостаточных workbench-contribution'ах: корень лишь прогоняет
 * их по фазам `LifecycleService` через реестр (`ready` двигает {@link mount},
 * `eventually` — стартовая последовательность после первого кадра).
 *
 * Единственный компонент с жизненным циклом за пределами конструктора: у корня
 * есть реальная стартовая последовательность, которую ведёт `diode/workbenchStartup.ts`
 * (mount → activate → open/restore файлов) — см. {@link mount}/{@link activate}.
 * Выхода здесь нет: его ведут `quitAction` и `LifecycleService.shutdown`.
 */
export class WorkbenchComponent extends Component {
    public static dependencies = [
        EditorServiceDIToken,
        CommandRegistryDIToken,
        KeybindingRegistryDIToken,
        ServiceAccessorDIToken,
        StatusBarComponentDIToken,
        ThemeServiceDIToken,
        TerminalEnvironmentServiceDIToken,
        UserKeybindingsDIToken,
        DialogServiceDIToken,
        LifecycleServiceDIToken,
    ] as const;
    public readonly view: BodyElement;
    private readonly themeService: ThemeService;
    public readonly workbenchLayout: WorkbenchLayoutElement;

    private editorService: IEditorService;
    private editorPartComponent: EditorPartComponent;
    private dialogService: DialogService;
    private workspaceContext: WorkspaceContextService;
    private explorerService: ExplorerService;
    private sidebarService: SidebarService;
    private viewsService: ViewsService;
    private fileSearchService: IFileSearchService;
    private quickInput: QuickInputService;
    private statusBarComponent: StatusBarComponent;
    private notificationsComponent: NotificationsComponent;
    private terminalService: TerminalService;
    private layoutService: LayoutService;
    private workbenchContextKeys: WorkbenchContextKeys;
    private workbenchState: WorkbenchStateService;
    private terminalEnv: TerminalEnvironmentService;
    private dispatcher: KeybindingDispatcher;
    private lifecycleService: LifecycleService;
    /**
     * Взведён в {@link mount}. Отличает бутстрап (там единственную загрузку
     * дерева await'ит `activate()`) от смены корня на живом приложении, где
     * наполнить дерево обязан сам {@link setWorkspaceFolder}.
     */
    private mounted = false;

    public constructor(
        editorService: IEditorService,
        commands: CommandRegistry,
        keybindings: KeybindingRegistry,
        accessor: ServiceAccessor,
        statusBarComponent: StatusBarComponent,
        themeService: ThemeService,
        terminalEnv: TerminalEnvironmentService,
        userKeybindings: readonly IUserKeybindingRule[],
        dialogService: DialogService,
        lifecycleService: LifecycleService,
    ) {
        super();
        // Корневая view — первой: оверлеи фич создают сессии на её слое в своих
        // конструкторах (`LayoutService.mainContainer`), поэтому корень обязан
        // быть прикреплён до резолва любой фичи.
        this.view = new BodyElement();
        this.view.id = "workbench";
        this.layoutService = this.register(accessor.get(LayoutServiceDIToken));
        this.layoutService.attachRoot(this.view);
        this.themeService = themeService;
        this.terminalEnv = terminalEnv;
        this.dialogService = this.register(dialogService);
        this.lifecycleService = lifecycleService;
        // Несохранённые редакторы участвуют в confirm-save последовательности выхода.
        lifecycleService.registerShutdownParticipant(editorService);
        this.editorService = this.register(editorService);
        // Editor-кластер: компонент группового контрола (tab strip + контент
        // активного редактора) поверх IEditorService.
        this.editorPartComponent = this.register(accessor.get(EditorPartComponentDIToken));
        // Единственный источник правды о папках воркспейса: владельцем набора
        // папок является этот компонент (см. setWorkspaceFolder), все остальные
        // читают IWorkspaceContextService.
        this.workspaceContext = accessor.get(WorkspaceContextServiceDIToken);
        // Реестр workbench-contributions (агрегатор — `workbench.common.main.ts`):
        // фич-компоненты и их сервисы — фаза `blockStartup`, прямо здесь, после
        // прикрепления корневой view (хост оверлеев) и до setWorkspaceFolder
        // бутстрапа; фич-проводка — по фазам жизненного цикла, синхронно в
        // момент перехода: `ready` наступает в mount(), `eventually` — после
        // первого кадра (workbenchStartup). Реестр владеет их жизнью.
        const contributionsRegistry = this.register(accessor.get(WorkbenchContributionsRegistryDIToken));
        contributionsRegistry.instantiateByPhase("blockStartup");
        this.register(
            lifecycleService.onDidChangePhase((phase) => {
                contributionsRegistry.instantiateByPhase(phase);
            }),
        );
        // Ссылки на фичи, которые корень ещё дёргает сам: корень дерева Explorer'а
        // и cwd терминала берут ровно ту строку пути, что открыли (см.
        // setWorkspaceFolder), — владеет ими реестр, здесь только кэш DI.
        this.explorerService = accessor.get(ExplorerServiceDIToken);
        this.terminalService = accessor.get(TerminalServiceDIToken);
        // Клавиатурный диспатчер: WorkbenchComponent владеет его жизнью и подключает
        // view-хук модальных оверлеев (хук контекст-ключей замыкает на себя
        // WorkbenchContextKeys) — сам сервис про view ничего не знает.
        this.dispatcher = this.register(accessor.get(KeybindingDispatcherDIToken));
        this.dispatcher.hasKeyboardCapturingOverlay = () => this.view.overlayLayer.hasKeyboardCapturingOverlay();
        // QuickInput-кластер: файловый индекс, общий виджет-компонент (host
        // прикрепляется ниже, после постройки view) и InputBox/list-pick сервис.
        // WorkbenchComponent владеет их жизнью.
        this.fileSearchService = this.register(accessor.get(FileSearchServiceDIToken));
        const quickInputComponent = this.register(accessor.get(QuickInputComponentDIToken));
        this.quickInput = accessor.get(QuickInputServiceDIToken);
        this.statusBarComponent = this.register(statusBarComponent);
        // Реестр вкладок нижней панели; вкладки — контейнеры фич (см. mount()).
        const panelComponent = this.register(accessor.get(PanelComponentDIToken));
        // Layout-логика (сайдбар/панель + персист layout'а) и контекст-ключи
        // workbench'а (фокус/сервисы → ContextKeyService; замыкают хук
        // dispatcher.updateContextKeys). Сам layout-элемент и корневую view
        // прикрепляем ниже, как только они построены.
        this.sidebarService = accessor.get(SidebarServiceDIToken);
        this.viewsService = accessor.get(ViewsServiceDIToken);
        this.workbenchContextKeys = this.register(accessor.get(WorkbenchContextKeysDIToken));

        this.workbenchLayout = new WorkbenchLayoutElement();
        this.workbenchLayout.setCenterContent(this.editorPartComponent.view);
        this.workbenchLayout.setBottomPanel(panelComponent.view);
        this.layoutService.attachLayout(this.workbenchLayout);
        // Персист открытых редакторов (write-through подписан на IEditorService
        // внутри сервиса; layout персистит LayoutService через onDidChangeLayout).
        this.workbenchState = this.register(accessor.get(WorkbenchStateServiceDIToken));
        // Персист раскладки групп: срез view-части (ось/доли/вместимость) +
        // write-through по действиям пользователя (drag саша, resize, тумблер оси).
        this.workbenchState.attachEditorLayout(this.editorPartComponent);
        this.editorPartComponent.onDidChangeGroupLayout = () => {
            this.workbenchState.captureOpenEditors();
        };

        this.dialogService.attachHost(this.view);
        // Темизированные стили контекстных меню: сервис показывает попапы сам,
        // тему знает только workbench — прикрепляем поставщика (как attachHost).
        this.view.setContent(this.workbenchLayout);
        this.view.setStatusBar(this.statusBarComponent.view);
        // Источник фокуса для контекст-ключей — FocusManager корневой view.
        this.workbenchContextKeys.attachView(this.view);

        // Общий виджет QuickInput/QuickOpen живёт в overlay-слое корневой view.
        quickInputComponent.attachHost(this.view);
        // Оверлей серии Ctrl+Tab (MRU-список вкладок) — passthrough-сессия
        // того же слоя; показ/скрытие ведут события IEditorService.
        this.register(accessor.get(TabSwitcherComponentDIToken)).attachHost(this.view);
        // Сообщения: стек тостов в правом нижнем углу (passthrough) и окно
        // модального сообщения по центру — тот же слой.
        this.notificationsComponent = this.register(accessor.get(NotificationsComponentDIToken));
        this.notificationsComponent.attachHost(this.view);
        for (const action of accessor.get(CommandActionsDIToken)) {
            // Мак-дельты (таблица macKeybindings.ts) — поверх объявленных биндов.
            this.register(registerAction(commands, keybindings, accessor, withMacKeybindings(action)));
        }
        // Слой user реестра: его бинды сильнее default и extension, а снятия
        // (`-command`) убирают дефолты и бинды расширений — когда бы те ни
        // зарегистрировались. Слоем владеет KeybindingsEditorService: правки во
        // вкладке шорткатов пересобирают его из записанного keybindings.json.
        this.register(accessor.get(KeybindingsEditorServiceDIToken)).applyUserKeybindings(userKeybindings);

        // Главное меню строится ПОСЛЕ применения user keybindings: шорткаты
        // пунктов резолвятся из реестра биндингов на момент постройки модели.
        const menuBarComponent = this.register(accessor.get(MenuBarComponentDIToken));
        this.view.setMenuBar(menuBarComponent.view);

        // Единственная точка «тема → корневой var-scope» (Н3): onThemeChange
        // файрит сразу с текущей темой, дальше цвета расходятся каскадом токенов.
        this.register(
            this.themeService.onThemeChange((theme) => {
                applyThemeVars(this.view, theme);
            }),
        );
        this.view.style = { fg: "foreground", bg: "editor.background" };
    }

    public mount(): void {
        this.mounted = true;
        // Сайдбар собирается до restoreLayout() в хвосте этого же метода —
        // порядок тот же, что был, когда контейнеры жили в setWorkspaceFolder
        // (бутстрап зовёт его ДО mount).
        this.viewsService.attachRegisteredContainers();
        // Свёрнутость/веса/скрытость секций — строго ПОСЛЕ сборки контейнеров:
        // применять их не на что, пока панелей нет. Собственный restore в
        // setWorkspaceFolder на бутстрапе именно поэтому и впустую — он нужен
        // команде Open Folder, которая меняет воркспейс на уже собранном сайдбаре.
        this.viewsService.restoreViewsState();
        // Фаза Ready: view построена, лёгкие сервисы готовы — реестр инстанцирует
        // contribution'ы этой фазы (статус-бар и пр.). Между конструктором и mount
        // ни один редактор не открывается → эквивалентно прежней проводке в ctor.
        this.lifecycleService.setPhase("ready");
        // Capture-phase listeners run before the focused widget (the target),
        // so while a chord is in progress they can swallow keys entirely —
        // keeping them out of the editor whether or not they match a command.
        // Сама обработка живёт в KeybindingDispatcher; WorkbenchComponent лишь
        // вешает его листенеры на корневое дерево, которым владеет. Фокус-
        // события уходят в WorkbenchContextKeys (пересчёт контекст-ключей).
        // Страховка dirty-гейта кадра ввода: съеденный кейбинд (defaultPrevented)
        // мог выполнить команду, меняющую состояние мимо всех markDirty-сеттеров
        // (scrollLineUp пишет viewState.scrollTop напрямую, unfold — регионы).
        // Fallback-вариант под damage-tracking: срабатывает, только если ни один
        // обработчик ничего не пометил, — иначе markDirty корня превращал бы
        // каждую съеденную клавишу в полноэкранный damage. Команда, честно
        // пометившая виджет, даёт частичный кадр; забытый markDirty по-прежнему
        // даёт полный (rect корня накрывает всё).
        const markIfConsumed =
            (handler: (event: TUIKeyboardEvent) => void) =>
            (event: TUIKeyboardEvent): void => {
                handler(event);
                if (event.defaultPrevented && !this.view.isLayoutDirty) this.view.markDirty();
            };
        this.view.addEventListener("keydown", markIfConsumed(this.dispatcher.handleKeyDownCapture), {
            capture: true,
        });
        this.view.addEventListener("keypress", this.dispatcher.handleKeyPressCapture, { capture: true });
        this.view.addEventListener("keydown", markIfConsumed(this.dispatcher.handleKeyDown));
        this.view.addEventListener("keyup", this.dispatcher.handleKeyUp);
        this.view.addEventListener("focus", this.workbenchContextKeys.handleFocusChange, { capture: true });
        this.view.addEventListener("blur", this.workbenchContextKeys.handleFocusChange, { capture: true });
        // Применяем сохранённый layout до первого кадра (run() идёт после mount()).
        // Workspace-стор уже открыт: setWorkspaceFolder вызывается до mount().
        // restoreLayout также синхронизирует истину видимости панели в PanelService.
        this.layoutService.restoreLayout();
    }

    public async activate(): Promise<void> {
        // Terminal tier/modes are already detected synchronously (env vars) in the env
        // service constructor, so context keys are correct from the first keypress —
        // push them now. Then kick off the fire-and-forget keyboard-protocol probe; if it
        // confirms richer support it upgrades the tier via onDidChange. Nothing blocks here.
        this.workbenchContextKeys.update();
        this.terminalEnv.detect();
        await this.editorService.activate();
        await this.explorerService.refresh();
    }

    public openFile(filePath: string): void {
        this.editorService.openFile(filePath);
        this.workbenchContextKeys.update();
    }

    /** Пути, которые откроет {@link restoreOpenEditors} — бутстрапу для прогрева грамматик. */
    public getOpenEditorsToRestore(): string[] {
        return this.workbenchState.getOpenEditorsToRestore();
    }

    /**
     * Восстанавливает открытые в прошлой сессии файлы этого воркспейса (реплей
     * сохранённых путей + активная вкладка). Вызывается из `main.ts`, только если
     * пользователь НЕ передал файлы в CLI (явные файлы перебивают сессию).
     */
    public restoreOpenEditors(): void {
        this.workbenchState.restoreOpenEditors();
        this.workbenchContextKeys.update();
    }

    /**
     * Открывает папку как воркспейс. Здесь остаётся ТОЛЬКО то, что зависит от
     * папки: контейнеры сайдбара живут своей жизнью (их собирает `mount()`).
     * Зовётся из бутстрапа (до `mount()`) и из команды Open Folder (после), так
     * что ничего «одноразового» тут быть не должно.
     */
    public setWorkspaceFolder(dirPath: string): void {
        // Источник правды о папках — IWorkspaceContextService, и ставится он
        // ПЕРВЫМ: всё ниже (и подписчики onDidChangeWorkspaceFolders) обязано
        // видеть уже новую папку. Здесь же считается идентичность проекта.
        const workspaceId = this.workspaceContext.setWorkspaceFolder(dirPath);
        this.explorerService.setRootPath(dirPath);
        // Новые терминалы спавнятся в папке воркспейса.
        this.terminalService.setWorkingDirectory(dirPath);
        // Открыть per-project стор состояния этого проекта (переключение флашит
        // предыдущий). Адресуется ИДЕНТИЧНОСТЬЮ воркспейса, а не путём папки —
        // см. resolveWorkspaceStorageDir. Дальше layout/открытые файлы
        // читаются/пишутся в него.
        this.workbenchState.openWorkspace(workspaceId);
        // Состояние view (режим поиска и SCM, черновик коммита, свёрнутость/веса
        // секций) фичи восстанавливают сами по `IStateService.onDidOpenWorkspace`
        // — синхронно внутри openWorkspace, то есть уже из стора проекта.
        // Fire-and-forget: the index builds in the background so startup and the
        // first render are not blocked. `fileIndexReady` exposes completion for
        // callers (and tests) that need the index populated.
        void this.fileSearchService.activate(dirPath);
        // Смена корня на живом приложении обязана наполнить дерево: `setRootPath`
        // только пересоздаёт провайдер, а `TreeViewElement`, который строит по
        // этому событию ExplorerComponent, грузит узлы ИСКЛЮЧИТЕЛЬНО через
        // refresh() — без него Open Folder оставлял пустую панель. На бутстрапе
        // (до mount) не зовём: там единственную загрузку await'ит `activate()`.
        if (this.mounted) void this.explorerService.refresh();
    }

    /** Resolves when the background file index has finished its initial build. */
    public get fileIndexReady(): Promise<void> {
        return this.fileSearchService.ready;
    }

    public focusEditor(): void {
        this.editorService.focusEditor();
    }
}
