import type { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { BodyElement } from "@tuidom/elements/body/bodyElement";

import { CommandActionsDIToken, registerAction } from "../../platform/actions/common/commandAction.ts";
import type { CommandRegistry } from "../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import { IConfigurationServiceDIToken } from "../../platform/configuration/common/iConfigurationServiceDIToken.ts";
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
import { bindWidgetGlyphs } from "../../platform/theme/browser/widgetGlyphs.ts";
import { ProductIconServiceDIToken } from "../../platform/theme/common/productIconService.ts";
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
 * Feature wiring lives in workbench contributions, not here; the root runs them
 * through the `LifecycleService` phases. The startup sequence
 * (mount → activate → open/restore) is driven by `diode/workbenchStartup.ts`.
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
     * Tells bootstrap (where `activate()` awaits the tree load) apart from a root change
     * in the live app, where {@link setWorkspaceFolder} must populate the tree itself.
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
        // The root view goes first: feature overlays create sessions on its layer in their
        // constructors, so the root must be attached before any feature is resolved.
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
        // The `blockStartup` phase runs right here: after the root view (the overlay host)
        // is attached and before bootstrap's setWorkspaceFolder.
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
        // The capture phase runs before the focused widget: mid-chord, keys are
        // swallowed before they reach the editor. Registered BEFORE the main menu: mnemonics
        // listen on the same root, and a node's listeners run in subscription order —
        // so a keybinding (including `alt+<letter>`) beats a mnemonic, as in VS Code.
        // markIfConsumed is a dirty-gate safety net: a consumed keybinding may change
        // state bypassing the markDirty setters (scrollLineUp, unfold). It fires only
        // when nothing has been marked — otherwise every consumed key would cause
        // full-screen damage.
        const markIfConsumed =
            (handler: (event: TUIKeyboardEvent) => void) =>
            (event: TUIKeyboardEvent): void => {
                handler(event);
                if (event.defaultPrevented && !this.view.isLayoutDirty) this.view.markDirty();
            };
        // Stryker disable ObjectLiteral,BooleanLiteral: capture vs bubble only differs for a widget that swallows keydown in the target phase mid-chord; printable keys and default actions are suppressed anyway (keypress capture, preventDefault), and the dispatcher bypasses modal overlays
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
        // Upstream `SashSettingsController`: the delay applies live, without a restart.
        const configuration = accessor.get(IConfigurationServiceDIToken);
        const applySashHoverDelay = (): void => {
            this.workbenchLayout.setSashHoverDelay(configuration.get("workbench.sash.hoverDelay"));
        };
        applySashHoverDelay();
        this.register(
            configuration.onDidChangeConfiguration((event) => {
                // Stryker disable next-line ConditionalExpression: equivalent — re-applying the unchanged delay on another key's change is a no-op
                if (event.affectsConfiguration("workbench.sash.hoverDelay")) applySashHoverDelay();
            }),
        );
        this.workbenchLayout.setCenterContent(this.editorPartComponent.view);
        this.workbenchLayout.setBottomPanel(panelComponent.view);
        // Full-height right column (upstream puts it on the side opposite the sidebar).
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
        // The user layer beats default and extension, and removals (`-command`) drop
        // bindings whenever those get registered.
        this.register(accessor.get(KeybindingsEditorServiceDIToken)).applyUserKeybindings(userKeybindings);

        const menuBarComponent = this.register(accessor.get(MenuBarComponentDIToken));
        this.view.setMenuBar(menuBarComponent.view);

        // The single "theme → root var scope" point (N3).
        this.register(
            this.themeService.onThemeChange((theme) => {
                applyThemeVars(this.view, theme);
            }),
        );
        this.view.style = { fg: "foreground", bg: "editor.background" };
        // Glyphs tuidom widgets draw themselves (chevrons, tab lock, completion kinds) follow
        // `diode.icons.nerdFont` the same way, through the root.
        this.register(bindWidgetGlyphs(this.view, accessor.get(ProductIconServiceDIToken)));
    }

    public mount(): void {
        this.mounted = true;
        // Before restoreLayout() at the end of the method: bootstrap calls setWorkspaceFolder BEFORE mount.
        this.viewsService.attachRegisteredContainers();
        // Strictly AFTER the containers are assembled: there is nothing to apply to until panels exist.
        // So the restore in setWorkspaceFolder is a no-op on bootstrap — it is for Open Folder.
        this.viewsService.restoreViewsState();
        this.lifecycleService.setPhase("ready");
        this.view.addEventListener("focus", this.workbenchContextKeys.handleFocusChange, { capture: true });
        this.view.addEventListener("blur", this.workbenchContextKeys.handleFocusChange, { capture: true });
        // Before the first frame; the workspace store is already open (setWorkspaceFolder runs before mount()).
        this.layoutService.restoreLayout();
    }

    public async activate(): Promise<void> {
        // The terminal tier is detected synchronously in the env service constructor, so keys
        // are correct from the first keystroke; the keyboard protocol probe upgrades it later.
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

    /** Only when the user passed NO files on the CLI: explicit files override the session. */
    public restoreOpenEditors(): void {
        this.workbenchState.restoreOpenEditors();
        this.workbenchContextKeys.update();
    }

    /**
     * Called from bootstrap (before `mount()`) and from Open Folder (after) — nothing
     * here may be one-shot.
     */
    public setWorkspaceFolder(dirPath: string): void {
        // Set FIRST: everything below (including onDidChangeWorkspaceFolders subscribers)
        // must already see the new folder.
        this.openWorkspaceFolder(dirPath, this.workspaceContext.setWorkspaceFolder(dirPath));
    }

    /** The folder is the one named in the file; the project identity comes from the file path. */
    public openWorkspaceFile(filePath: string, contents: IWorkspaceFileContents): void {
        this.openWorkspaceFolder(contents.folder, this.workspaceContext.setWorkspaceFile(filePath, contents));
    }

    private openWorkspaceFolder(dirPath: string, workspaceId: WorkspaceId): void {
        this.explorerService.setRootPath(dirPath);
        this.terminalService.setWorkingDirectory(dirPath);
        // Keyed by the workspace IDENTITY, not the folder path (resolveWorkspaceStorageDir).
        this.workbenchState.openWorkspace(workspaceId);
        // Features restore their view state themselves on `onDidOpenWorkspace`,
        // synchronously inside openWorkspace. The index builds in the background without blocking the first frame.
        void this.fileSearchService.activate(dirPath);
        // `setRootPath` only recreates the provider; nodes are loaded only by refresh() —
        // without it Open Folder left an empty panel. On bootstrap `activate()` awaits the load.
        if (this.mounted) void this.explorerService.refresh();
    }

    public get fileIndexReady(): Promise<void> {
        return this.fileSearchService.ready;
    }

    public focusEditor(): void {
        this.editorService.focusEditor();
    }
}
