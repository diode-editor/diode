import type { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { BodyElement } from "@tuidom/elements/body/bodyElement";

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
import type { WorkspaceId } from "../../platform/workspace/common/iWorkspaceContextService.ts";
import type { WorkspaceContextService } from "../../platform/workspace/common/workspaceContextService.ts";
import { WorkspaceContextServiceDIToken } from "../../platform/workspace/common/workspaceContextService.ts";
import type { IWorkspaceFileContents } from "../../platform/workspace/common/workspaceFile.ts";
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
import { AuxiliaryBarComponentDIToken } from "./parts/auxiliarybar/auxiliaryBarComponent.ts";
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
import { WorkbenchLayoutElement } from "./workbenchLayoutElement.ts";
import type { WorkbenchStateService } from "./workbenchStateService.ts";
import { WorkbenchStateServiceDIToken } from "./workbenchStateService.ts";

export const WorkbenchComponentDIToken = token<WorkbenchComponent>("WorkbenchComponent");

/**
 * Фич-проводка живёт не здесь, а в workbench-contribution'ах, которые корень
 * прогоняет по фазам `LifecycleService`. Стартовую последовательность
 * (mount → activate → open/restore) ведёт `diode/workbenchStartup.ts`.
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
     * Отличает бутстрап (там загрузку дерева await'ит `activate()`) от смены
     * корня на живом приложении, где наполнить дерево обязан {@link setWorkspaceFolder}.
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
        // конструкторах, поэтому корень обязан быть прикреплён до резолва любой фичи.
        this.view = new BodyElement();
        this.view.id = "workbench";
        this.layoutService = this.register(accessor.get(LayoutServiceDIToken));
        this.layoutService.attachRoot(this.view);
        this.themeService = themeService;
        this.terminalEnv = terminalEnv;
        this.dialogService = this.register(dialogService);
        this.lifecycleService = lifecycleService;
        lifecycleService.registerShutdownParticipant(editorService);
        this.editorService = this.register(editorService);
        this.editorPartComponent = this.register(accessor.get(EditorPartComponentDIToken));
        this.workspaceContext = accessor.get(WorkspaceContextServiceDIToken);
        // Фаза `blockStartup` — прямо здесь: после прикрепления корневой view
        // (хост оверлеев) и до setWorkspaceFolder бутстрапа.
        const contributionsRegistry = this.register(accessor.get(WorkbenchContributionsRegistryDIToken));
        contributionsRegistry.instantiateByPhase("blockStartup");
        this.register(
            lifecycleService.onDidChangePhase((phase) => {
                contributionsRegistry.instantiateByPhase(phase);
            }),
        );
        this.explorerService = accessor.get(ExplorerServiceDIToken);
        this.terminalService = accessor.get(TerminalServiceDIToken);
        this.dispatcher = this.register(accessor.get(KeybindingDispatcherDIToken));
        this.dispatcher.hasKeyboardCapturingOverlay = () => this.view.overlayLayer.hasKeyboardCapturingOverlay();
        // Capture-фаза идёт раньше виджета в фокусе: посреди аккорда клавиши
        // глотаются, не доходя до редактора. Вешаются ДО главного меню: мнемоники
        // слушаются на том же корне, а слушатели узла идут в порядке подписки —
        // так кейбинд (в т.ч. `alt+<буква>`) сильнее мнемоники, как в VS Code.
        // markIfConsumed — страховка dirty-гейта: съеденный кейбинд мог поменять
        // состояние мимо markDirty-сеттеров (scrollLineUp, unfold). Срабатывает,
        // только если никто ничего не пометил, — иначе каждая съеденная клавиша
        // давала бы полноэкранный damage.
        const markIfConsumed =
            (handler: (event: TUIKeyboardEvent) => void) =>
            (event: TUIKeyboardEvent): void => {
                handler(event);
                if (event.defaultPrevented && !this.view.isLayoutDirty) this.view.markDirty();
            };
        // Stryker disable ObjectLiteral,BooleanLiteral: capture против bubble различим только для виджета, глушащего keydown в target-фазе посреди аккорда; печатные клавиши и дефолтные действия глушатся и так (keypress-capture, preventDefault), а модальные оверлеи диспетчер обходит
        this.view.addEventListener("keydown", markIfConsumed(this.dispatcher.handleKeyDownCapture), {
            capture: true,
        });
        // Stryker restore ObjectLiteral,BooleanLiteral
        this.view.addEventListener("keypress", this.dispatcher.handleKeyPressCapture, { capture: true });
        this.view.addEventListener("keydown", markIfConsumed(this.dispatcher.handleKeyDown));
        this.view.addEventListener("keyup", this.dispatcher.handleKeyUp);
        this.fileSearchService = this.register(accessor.get(FileSearchServiceDIToken));
        const quickInputComponent = this.register(accessor.get(QuickInputComponentDIToken));
        this.quickInput = accessor.get(QuickInputServiceDIToken);
        this.statusBarComponent = this.register(statusBarComponent);
        const panelComponent = this.register(accessor.get(PanelComponentDIToken));
        this.sidebarService = accessor.get(SidebarServiceDIToken);
        this.viewsService = accessor.get(ViewsServiceDIToken);
        this.workbenchContextKeys = this.register(accessor.get(WorkbenchContextKeysDIToken));

        this.workbenchLayout = new WorkbenchLayoutElement();
        this.workbenchLayout.setCenterContent(this.editorPartComponent.view);
        this.workbenchLayout.setBottomPanel(panelComponent.view);
        // Правая колонка во всю высоту (у эталона — со стороны, противоположной сайдбару).
        this.workbenchLayout.setRightPanel(this.register(accessor.get(AuxiliaryBarComponentDIToken)).view);
        this.layoutService.attachLayout(this.workbenchLayout);
        this.workbenchState = this.register(accessor.get(WorkbenchStateServiceDIToken));
        this.workbenchState.attachEditorLayout(this.editorPartComponent);
        this.editorPartComponent.onDidChangeGroupLayout = () => {
            this.workbenchState.captureOpenEditors();
        };

        this.dialogService.attachHost(this.view);
        this.view.setContent(this.workbenchLayout);
        this.view.setStatusBar(this.statusBarComponent.view);
        this.workbenchContextKeys.attachView(this.view);

        quickInputComponent.attachHost(this.view);
        this.register(accessor.get(TabSwitcherComponentDIToken)).attachHost(this.view);
        this.notificationsComponent = this.register(accessor.get(NotificationsComponentDIToken));
        this.notificationsComponent.attachHost(this.view);
        for (const action of accessor.get(CommandActionsDIToken)) {
            this.register(registerAction(commands, keybindings, accessor, withMacKeybindings(action)));
        }
        // Слой user сильнее default и extension, а снятия (`-command`) убирают
        // бинды, когда бы те ни зарегистрировались.
        this.register(accessor.get(KeybindingsEditorServiceDIToken)).applyUserKeybindings(userKeybindings);

        const menuBarComponent = this.register(accessor.get(MenuBarComponentDIToken));
        this.view.setMenuBar(menuBarComponent.view);

        // Единственная точка «тема → корневой var-scope» (Н3).
        this.register(
            this.themeService.onThemeChange((theme) => {
                applyThemeVars(this.view, theme);
            }),
        );
        this.view.style = { fg: "foreground", bg: "editor.background" };
    }

    public mount(): void {
        this.mounted = true;
        // До restoreLayout() в хвосте метода: бутстрап зовёт setWorkspaceFolder ДО mount.
        this.viewsService.attachRegisteredContainers();
        // Строго ПОСЛЕ сборки контейнеров: применять не на что, пока панелей нет.
        // restore в setWorkspaceFolder на бутстрапе поэтому впустую — он для Open Folder.
        this.viewsService.restoreViewsState();
        this.lifecycleService.setPhase("ready");
        this.view.addEventListener("focus", this.workbenchContextKeys.handleFocusChange, { capture: true });
        this.view.addEventListener("blur", this.workbenchContextKeys.handleFocusChange, { capture: true });
        // До первого кадра; workspace-стор уже открыт (setWorkspaceFolder идёт до mount()).
        this.layoutService.restoreLayout();
    }

    public async activate(): Promise<void> {
        // Тир терминала определён синхронно в конструкторе env-сервиса — ключи
        // верны с первой клавиши; проба протокола клавиатуры апгрейдит его позже.
        this.workbenchContextKeys.update();
        this.terminalEnv.detect();
        await this.editorService.activate();
        await this.explorerService.refresh();
    }

    public openFile(filePath: string): void {
        this.editorService.openFile(filePath);
        this.workbenchContextKeys.update();
    }

    public getOpenEditorsToRestore(): string[] {
        return this.workbenchState.getOpenEditorsToRestore();
    }

    /** Только если пользователь НЕ передал файлы в CLI: явные файлы перебивают сессию. */
    public restoreOpenEditors(): void {
        this.workbenchState.restoreOpenEditors();
        this.workbenchContextKeys.update();
    }

    /**
     * Зовётся из бутстрапа (до `mount()`) и из Open Folder (после) — ничего
     * «одноразового» тут быть не должно.
     */
    public setWorkspaceFolder(dirPath: string): void {
        // Ставится ПЕРВЫМ: всё ниже (и подписчики onDidChangeWorkspaceFolders)
        // обязано видеть уже новую папку.
        this.openWorkspaceFolder(dirPath, this.workspaceContext.setWorkspaceFolder(dirPath));
    }

    /** Папка — названная в файле, идентичность проекта — от пути файла. */
    public openWorkspaceFile(filePath: string, contents: IWorkspaceFileContents): void {
        this.openWorkspaceFolder(contents.folder, this.workspaceContext.setWorkspaceFile(filePath, contents));
    }

    private openWorkspaceFolder(dirPath: string, workspaceId: WorkspaceId): void {
        this.explorerService.setRootPath(dirPath);
        this.terminalService.setWorkingDirectory(dirPath);
        // Адресуется ИДЕНТИЧНОСТЬЮ воркспейса, а не путём папки (resolveWorkspaceStorageDir).
        this.workbenchState.openWorkspace(workspaceId);
        // Состояние view фичи восстанавливают сами по `onDidOpenWorkspace` —
        // синхронно внутри openWorkspace. Индекс строится в фоне, не блокируя первый кадр.
        void this.fileSearchService.activate(dirPath);
        // `setRootPath` только пересоздаёт провайдер, узлы грузит лишь refresh() —
        // без него Open Folder оставлял пустую панель. На бутстрапе загрузку await'ит `activate()`.
        if (this.mounted) void this.explorerService.refresh();
    }

    public get fileIndexReady(): Promise<void> {
        return this.fileSearchService.ready;
    }

    public focusEditor(): void {
        this.editorService.focusEditor();
    }
}
