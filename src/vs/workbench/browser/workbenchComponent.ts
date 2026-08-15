import type { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { WorkbenchLayoutElement } from "@tuidom/elements/workbenchlayout/workbenchLayoutElement";
import { registerAction } from "../../platform/actions/common/commandAction.ts";
import type { CommandRegistry } from "../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import { ContextMenuServiceDIToken } from "../../platform/contextview/browser/contextMenuService.ts";
import type { ServiceAccessor } from "../../platform/instantiation/common/diContainer.ts";
import { token } from "../../platform/instantiation/common/diContainer.ts";
import type { KeybindingRegistry } from "../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingRegistryDIToken } from "../../platform/keybinding/common/keybindingRegistry.ts";
import type { IUserKeybindingRule } from "../../platform/keybinding/node/keybindingsService.ts";
import { applyThemeVars } from "../../platform/theme/browser/themeStyleVars.ts";
import { UserKeybindingsDIToken } from "../../diode/modules/keybindingsModule.ts";
import { ServiceAccessorDIToken, TuiApplicationDIToken } from "../common/coreTokens.ts";
import {
    WorkbenchContributionsRegistry,
    WorkbenchContributionsRegistryDIToken,
} from "../common/workbenchContributionsRegistry.ts";
import { registerVscodeDiffCommand } from "../contrib/diff/browser/compareActions.ts";
import {
    EXPLORER_VIEWLET_ID,
    ExplorerComponent,
    ExplorerComponentDIToken,
} from "../contrib/files/browser/explorerComponent.ts";
import { ExplorerService, ExplorerServiceDIToken } from "../contrib/files/browser/explorerService.ts";
import { FileOperationsService, FileOperationsServiceDIToken } from "../contrib/files/browser/fileOperationsService.ts";
import { FindComponentDIToken } from "../contrib/find/browser/findComponent.ts";
import { FindServiceDIToken } from "../contrib/find/browser/findService.ts";
import { DiagnosticsServiceDIToken } from "../contrib/markers/browser/diagnosticsService.ts";
import { ProblemsComponentDIToken } from "../contrib/markers/browser/problemsComponent.ts";
import { OutputComponentDIToken } from "../contrib/output/browser/outputComponent.ts";
import { QuickOpenServiceDIToken } from "../contrib/quickaccess/browser/quickOpenService.ts";
import { ChangesComponent, ChangesComponentDIToken, SCM_VIEWLET_ID } from "../contrib/scm/browser/changesComponent.ts";
import { GraphViewComponentDIToken } from "../contrib/scm/browser/graphViewComponent.ts";
import { ScmRepoStateServiceDIToken } from "../contrib/scm/browser/repoStateService.ts";
import { ScmInputComponent, ScmInputComponentDIToken } from "../contrib/scm/browser/scmInputComponent.ts";
import {
    SEARCH_VIEWLET_ID,
    SearchComponent,
    SearchComponentDIToken,
} from "../contrib/search/browser/searchComponent.ts";
import { CompletionServiceDIToken } from "../contrib/suggest/browser/completionService.ts";
import { SuggestComponentDIToken } from "../contrib/suggest/browser/suggestComponent.ts";
import { TerminalPanelComponentDIToken } from "../contrib/terminal/browser/terminalPanelComponent.ts";
import { type TerminalService, TerminalServiceDIToken } from "../contrib/terminal/browser/terminalService.ts";
import type { DialogService } from "../services/dialogs/browser/dialogService.ts";
import { DialogServiceDIToken } from "../services/dialogs/browser/dialogService.ts";
import { EditorService, EditorServiceDIToken } from "../services/editor/browser/editorService.ts";
import type { KeybindingDispatcher } from "../services/keybinding/browser/keybindingDispatcher.ts";
import { KeybindingDispatcherDIToken } from "../services/keybinding/browser/keybindingDispatcher.ts";
import type { LayoutService } from "../services/layout/browser/layoutService.ts";
import { LayoutServiceDIToken } from "../services/layout/browser/layoutService.ts";
import type { LifecycleService } from "../services/lifecycle/browser/lifecycleService.ts";
import { LifecycleServiceDIToken } from "../services/lifecycle/browser/lifecycleService.ts";
import type { FileSearchService } from "../services/search/node/fileSearchService.ts";
import { FileSearchServiceDIToken } from "../services/search/node/fileSearchService.ts";
import type { TerminalEnvironmentService } from "../services/terminalEnvironment/node/terminalEnvironmentService.ts";
import { TerminalEnvironmentServiceDIToken } from "../services/terminalEnvironment/node/terminalEnvironmentService.ts";
import type { ThemeService } from "../services/themes/common/themeService.ts";
import { ThemeServiceDIToken } from "../services/themes/common/themeTokens.ts";

import { builtinActions } from "./actions/builtinActions.ts";
import { Component } from "./component.ts";
import { MenuBarComponentDIToken } from "./menuBarComponent.ts";
import { DiffEditorPane2 } from "./parts/editor/diffEditorPane2.ts";
import { EditorPartComponent, EditorPartComponentDIToken } from "./parts/editor/editorPartComponent.ts";
import { TextEditorPane } from "./parts/editor/textEditorPane.ts";
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
 * `attachView`), регистрирует встроенные экшены (`builtinActions`) и красит
 * собственные контролы (BodyElement/сэши) в {@link updateStyles}. Логика живёт
 * в сервисах Workbench.
 *
 * Фич-проводка (подписки на события, live-reload темы, контекст-меню и т.п.) —
 * НЕ здесь, а в самодостаточных workbench-contribution'ах: корень лишь прогоняет
 * их по фазам через реестр (`Restored` — в {@link mount}, `Eventually` — из
 * `main.ts` через {@link runEventuallyPhase}). См. `Contributions/`.
 *
 * Единственный компонент с жизненным циклом за пределами конструктора: у корня
 * есть реальная bootstrap-последовательность, которую ведёт `main.ts`
 * (mount → activate → open/restore файлов) — см. {@link mount}/{@link activate}.
 * Здесь же остаётся квит-флоу ({@link requestQuit} + doQuit: teardown TUI и
 * `process.exit`; вызывается через шов `QuitHandlerDIToken` из `quitAction`).
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

    private editorService: EditorService;
    private editorPartComponent: EditorPartComponent;
    private dialogService: DialogService;
    private lifecycleService: LifecycleService;
    private explorerService: ExplorerService;
    private explorerComponent: ExplorerComponent;
    private searchComponent: SearchComponent;
    private changesComponent: ChangesComponent;
    private scmInputComponent: ScmInputComponent;
    private sidebarService: SidebarService;
    private viewsService: ViewsService;
    private fileOperations: FileOperationsService;
    private fileSearchService: FileSearchService;
    private quickInput: QuickInputService;
    private statusBarComponent: StatusBarComponent;
    private terminalService: TerminalService;
    private layoutService: LayoutService;
    private workbenchContextKeys: WorkbenchContextKeys;
    private workbenchState: WorkbenchStateService;
    private terminalEnv: TerminalEnvironmentService;
    private dispatcher: KeybindingDispatcher;
    private contributionsRegistry: WorkbenchContributionsRegistry;

    public constructor(
        editorService: EditorService,
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
        this.themeService = themeService;
        this.terminalEnv = terminalEnv;
        this.dialogService = this.register(dialogService);
        this.lifecycleService = lifecycleService;
        // Несохранённые редакторы участвуют в confirm-save последовательности выхода.
        this.lifecycleService.registerShutdownParticipant(editorService);
        this.editorService = this.register(editorService);
        // Editor-кластер: компонент группового контрола (tab strip + контент
        // активного редактора) поверх EditorService.
        this.editorPartComponent = this.register(accessor.get(EditorPartComponentDIToken));
        // Explorer-кластер: сервис (корень/провайдер/reveal) и компонент
        // (дерево + контекст-меню). WorkbenchComponent владеет их жизнью.
        this.explorerService = this.register(accessor.get(ExplorerServiceDIToken));
        this.explorerComponent = this.register(accessor.get(ExplorerComponentDIToken));
        // Search-кластер: сервис поиска (spawn rg) внутри компонента; сам компонент —
        // ещё один вьюлет сайдбара (регистрируется в setWorkspaceFolder).
        this.searchComponent = this.register(accessor.get(SearchComponentDIToken));
        // Клавиатурный диспатчер: WorkbenchComponent владеет его жизнью и подключает
        // view-хук модальных оверлеев (хук контекст-ключей замыкает на себя
        // WorkbenchContextKeys) — сам сервис про view ничего не знает.
        this.dispatcher = this.register(accessor.get(KeybindingDispatcherDIToken));
        this.dispatcher.hasKeyboardCapturingOverlay = () => this.view.overlayLayer.hasKeyboardCapturingOverlay();
        // QuickInput-кластер: файловый индекс, общий виджет-компонент (host
        // прикрепляется ниже, после постройки view), InputBox/list-pick сервис и
        // Quick Open поверх них. WorkbenchComponent владеет их жизнью.
        this.fileSearchService = this.register(accessor.get(FileSearchServiceDIToken));
        const quickInputComponent = this.register(accessor.get(QuickInputComponentDIToken));
        this.quickInput = accessor.get(QuickInputServiceDIToken);
        this.register(accessor.get(QuickOpenServiceDIToken));
        // Файловые операции (Workbench-сервис): промпт имени/пути — QuickInputService
        // (шов IExplorerInputPrompt замкнут в DI).
        this.fileOperations = accessor.get(FileOperationsServiceDIToken);
        // Find/Suggest-кластер: компоненты владеют виджетами и overlay-сессиями
        // (host'ы прикрепляются ниже, после постройки view), сервисы — логикой
        // поиска/автодополнения. WorkbenchComponent владеет их жизнью.
        const suggestComponent = this.register(accessor.get(SuggestComponentDIToken));
        this.register(accessor.get(CompletionServiceDIToken));
        const findComponent = this.register(accessor.get(FindComponentDIToken));
        this.register(accessor.get(FindServiceDIToken));
        this.statusBarComponent = this.register(statusBarComponent);
        // Panel-кластер: диагностики (headless), реестр вкладок панели, Problems и
        // терминал. Порядок резолва задаёт порядок табов: PROBLEMS регистрирует
        // ProblemsComponent, TERMINAL — TerminalService.
        this.register(accessor.get(DiagnosticsServiceDIToken));
        this.register(accessor.get(ProblemsComponentDIToken));
        // Порядок резолва = порядок табов панели: PROBLEMS · OUTPUT · TERMINAL.
        this.register(accessor.get(OutputComponentDIToken));
        // ChangesComponent — секция CHANGES контейнера Source Control; резолв
        // подтягивает ScmChangesService, чья команда `diode.scm.publishChanges`
        // регистрируется до активации git-расширения, публикующего в неё набор.
        this.changesComponent = this.register(accessor.get(ChangesComponentDIToken));
        // Секция GRAPH того же контейнера (+ ScmGraphService с командой
        // `diode.scm.publishLog`); view записывается в реестр ViewsService здесь,
        // контейнер собирается в setWorkspaceFolder.
        this.register(accessor.get(GraphViewComponentDIToken));
        // Commit input box — header контейнера Source Control.
        this.scmInputComponent = this.register(accessor.get(ScmInputComponentDIToken));
        // Repo-state (ветка/remotes/merge-rebase → when-ключи git*): команда
        // diode.scm.publishRepoState должна существовать до активации расширения.
        this.register(accessor.get(ScmRepoStateServiceDIToken));
        this.terminalService = this.register(accessor.get(TerminalServiceDIToken));
        const panelComponent = this.register(accessor.get(PanelComponentDIToken));
        this.register(accessor.get(TerminalPanelComponentDIToken));
        // Layout-логика (сайдбар/панель + персист layout'а) и контекст-ключи
        // workbench'а (фокус/сервисы → ContextKeyService; замыкают хук
        // dispatcher.updateContextKeys). Сам layout-элемент и корневую view
        // прикрепляем ниже, как только они построены.
        this.layoutService = this.register(accessor.get(LayoutServiceDIToken));
        this.sidebarService = accessor.get(SidebarServiceDIToken);
        this.viewsService = accessor.get(ViewsServiceDIToken);
        this.workbenchContextKeys = this.register(accessor.get(WorkbenchContextKeysDIToken));
        // Реестр workbench-contributions: фич-проводка вынесена в самодостаточные
        // contribution-классы (статус-бар и пр.). Реестр инстанцирует их по фазам:
        // Restored — в mount(), Eventually — из main.ts после первого кадра.
        this.contributionsRegistry = this.register(accessor.get(WorkbenchContributionsRegistryDIToken));

        this.workbenchLayout = new WorkbenchLayoutElement();
        this.workbenchLayout.setCenterContent(this.editorPartComponent.view);
        this.workbenchLayout.setBottomPanel(panelComponent.view);
        this.layoutService.attachLayout(this.workbenchLayout);
        // Персист открытых редакторов (write-through подписан на EditorService
        // внутри сервиса; layout персистит LayoutService через onDidChangeLayout).
        this.workbenchState = this.register(accessor.get(WorkbenchStateServiceDIToken));
        // Персист раскладки групп: срез view-части (ось/доли/вместимость) +
        // write-through по действиям пользователя (drag саша, resize, тумблер оси).
        this.workbenchState.attachEditorLayout(this.editorPartComponent);
        this.editorPartComponent.onDidChangeGroupLayout = () => {
            this.workbenchState.captureOpenEditors();
        };

        this.view = new BodyElement();
        this.view.id = "workbench";
        this.dialogService.attachHost(this.view);
        // Темизированные стили контекстных меню: сервис показывает попапы сам,
        // тему знает только workbench — прикрепляем поставщика (как attachHost).
        this.view.setContent(this.workbenchLayout);
        this.view.setStatusBar(this.statusBarComponent.view);
        // Источник фокуса для контекст-ключей — FocusManager корневой view.
        this.workbenchContextKeys.attachView(this.view);

        // Общий виджет QuickInput/QuickOpen живёт в overlay-слое корневой view.
        quickInputComponent.attachHost(this.view);
        // Suggest-попап — в глобальном overlay-слое (у каретки), find-виджет —
        // в локальном слое группы редакторов. Закрытие при смене активного
        // редактора сервисы делают сами (подписки на onActiveEditorChanged).
        suggestComponent.attachHost(this.view);
        // Find-виджеты — по одному на группу, на локальном overlay-слое каждой;
        // компонент создаёт их лениво по первому Ctrl+F в группе.
        findComponent.hostProvider = (groupId) => this.editorPartComponent.groupOverlayHost(groupId);
        for (const action of builtinActions) {
            this.register(registerAction(commands, keybindings, accessor, action));
        }
        // `vscode.diff` — программный вход с контрактом VS Code: без title,
        // мимо палитры; ext-host исполняет её по id через мост команд.
        this.register(registerVscodeDiffCommand(commands, accessor));
        // Apply user keybindings AFTER all defaults so they take precedence (the registry
        // resolves the last-registered matching binding) and so `-command` unbinds can remove defaults.
        this.dispatcher.applyUserKeybindings(userKeybindings);

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
        // Фаза Restored: view построена, лёгкие сервисы готовы — инстанцируем
        // contribution'ы этой фазы (статус-бар и пр.). Между конструктором и mount
        // ни один редактор не открывается → эквивалентно прежней проводке в ctor.
        this.contributionsRegistry.instantiateByPhase("restored");
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
        this.editorService.onRequestConfirmClose = (group, index) => {
            // Диалог предлагает СОХРАНИТЬ, поэтому здесь сохраняемые поверхности
            // вкладки: сама текстовая панель либо dirty-стороны диффа v2, не
            // видимые больше нигде (untitled-пара, файл без обычной вкладки).
            // Координата — (группа, индекс): крестик работает и в неактивной группе.
            const pane = group.getPane(index);
            let saveTargets: TextEditorPane[];
            if (pane instanceof TextEditorPane) saveTargets = [pane];
            else if (pane instanceof DiffEditorPane2) saveTargets = this.editorService.dirtyExclusiveDiffSides(pane);
            /* v8 ignore start -- defensive: прочие вкладки не бывают изменёнными и сюда не попадают */
            else return;
            if (saveTargets.length === 0) return;
            /* v8 ignore stop */
            this.showConfirmSaveDialog(saveTargets.map((target) => target.label).join(", "), {
                onSave: () => {
                    // Explicit "Save" while closing a modified tab: honour the
                    // user's edits even against an external change (overwrite),
                    // so choosing Save never silently drops their work. A side
                    // that cannot be saved (untitled without a path — "no-file")
                    // keeps the tab open instead of silently dropping the text.
                    void (async () => {
                        for (const target of saveTargets) {
                            if ((await target.save({ overwrite: true })) !== "saved") return;
                        }
                        group.closeTab(index);
                    })();
                },
                onDontSave: () => {
                    group.closeTab(index);
                },
                /* v8 ignore start -- placeholder no-op: cancelling keeps the editor open, nothing to do */
                onCancel: () => {
                    // noop
                },
                /* v8 ignore stop */
            });
        };
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

    /**
     * Фаза Eventually: idle после первого кадра. Запускает `main.ts` через
     * `setImmediate` (mount() идёт до `app.run()`, поэтому из mount фаза сработала
     * бы раньше кадра). Инстанцирует отложенные/тяжёлые contribution'ы.
     */
    public runEventuallyPhase(): void {
        this.contributionsRegistry.instantiateByPhase("eventually");
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

    public setWorkspaceFolder(dirPath: string): void {
        this.explorerService.setRootPath(dirPath);
        // Новые терминалы спавнятся в папке воркспейса.
        this.terminalService.setWorkingDirectory(dirPath);
        // Собираем контейнеры сайдбара и показываем Explorer по умолчанию, не
        // трогая видимость сайдбара — её восстанавливает персист layout'а.
        // Все три идут одним путём: view записались в реестр из конструкторов
        // компонентов, ViewsService строит контейнер и отдаёт его сайдбару.
        this.viewsService.registerContainer({
            id: EXPLORER_VIEWLET_ID,
            title: "EXPLORER",
            location: "sidebar",
        });
        this.viewsService.attachContainer(EXPLORER_VIEWLET_ID);
        // Search — контейнер с единственной view: заголовок секции сам сливается
        // с заголовком контейнера (merged выводится из числа видимых секций),
        // «⋯»-меню из коробки; view записалась в реестр из конструктора
        // SearchComponent.
        this.viewsService.registerContainer({
            id: SEARCH_VIEWLET_ID,
            title: "SEARCH",
            location: "sidebar",
        });
        this.viewsService.attachContainer(SEARCH_VIEWLET_ID);
        // Source Control — контейнер view-секций (SOURCE CONTROL, GRAPH): сборку
        // и регистрацию вьюлета берёт на себя ViewsService; view записались в
        // реестр из конструкторов компонентов. Контролы коммита — внутри тела
        // первой секции, её собирает ChangesComponent.
        this.viewsService.registerContainer({
            id: SCM_VIEWLET_ID,
            title: "SOURCE CONTROL",
            location: "sidebar",
        });
        this.viewsService.attachContainer(SCM_VIEWLET_ID);
        this.sidebarService.showViewlet(EXPLORER_VIEWLET_ID, false);
        // Открыть per-project стор состояния для этой папки (переключение флашит
        // предыдущий). Дальше layout/открытые файлы читаются/пишутся в него.
        this.workbenchState.openWorkspace(dirPath);
        // Состояние view поиска (режим дерево/плоско, раскрытость include/exclude)
        // — из workspace-стора; строго после openWorkspace, иначе прочитается
        // global-стор.
        this.searchComponent.restoreViewState();
        this.changesComponent.restoreViewMode();
        // Черновик сообщения коммита — из workspace-стора.
        this.scmInputComponent.restoreDraft();
        // Свёрнутость/веса view-секций — тоже из workspace-стора.
        this.viewsService.restoreViewsState();
        // Fire-and-forget: the index builds in the background so startup and the
        // first render are not blocked. `fileIndexReady` exposes completion for
        // callers (and tests) that need the index populated.
        void this.fileSearchService.activate(dirPath);
    }

    /** Resolves when the background file index has finished its initial build. */
    public get fileIndexReady(): Promise<void> {
        return this.fileSearchService.ready;
    }

    public focusEditor(): void {
        this.editorService.focusEditor();
    }

    public showConfirmSaveDialog(
        filename: string,
        callbacks: { onSave: () => void; onDontSave: () => void; onCancel: () => void },
    ): void {
        this.dialogService.showConfirmSaveDialog(filename, callbacks);
    }

    private doQuit(accessor: ServiceAccessor): void {
        accessor.get(TuiApplicationDIToken).backend.teardown();
        process.exit(0);
    }

    public requestQuit(accessor: ServiceAccessor): void {
        // Последовательность confirm-save живёт в LifecycleService; сам выход
        // (teardown TUI + process.exit) остаётся колбэком владельца приложения.
        void this.lifecycleService.requestQuit(() => {
            this.doQuit(accessor);
        });
    }
}
