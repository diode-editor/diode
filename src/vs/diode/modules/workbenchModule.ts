import { getSystemShell } from "../../base/node/shell.ts";
import {
    ContextMenuController as EditorContextMenuController,
    ContextMenuControllerDIToken as EditorContextMenuControllerDIToken,
} from "../../editor/contrib/contextmenu/browser/contextMenuController.ts";
import {
    DocumentSemanticTokensFeature,
    DocumentSemanticTokensFeatureDIToken,
} from "../../editor/contrib/semanticTokens/browser/documentSemanticTokens.ts";
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
import { type ContainerModule, ServiceAccessorDIToken } from "../../platform/instantiation/common/diContainer.ts";
import { ILogServiceDIToken } from "../../platform/log/common/iLogServiceDIToken.ts";
import { ProgressService, ProgressServiceDIToken } from "../../platform/progress/common/progressService.ts";
import { URLService, URLServiceDIToken } from "../../platform/url/common/url.ts";
import { IUserDataProfilesServiceDIToken } from "../../platform/userDataProfile/common/userDataProfile.ts";
import { IWorkspaceContextServiceDIToken } from "../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import {
    ExtensionViewWelcomes,
    ExtensionViewWelcomesDIToken,
} from "../../workbench/api/browser/extensionViewWelcomes.ts";
import {
    LanguageFeatureContextKeys,
    LanguageFeatureContextKeysDIToken,
} from "../../workbench/browser/languageFeatureContextKeys.ts";
import { MenuBarComponent, MenuBarComponentDIToken } from "../../workbench/browser/menuBarComponent.ts";
import {
    OpenFailureNotificationContribution,
    OpenFailureNotificationContributionDIToken,
} from "../../workbench/browser/openFailureNotificationContribution.ts";
import {
    AuxiliaryBarComponent,
    AuxiliaryBarComponentDIToken,
} from "../../workbench/browser/parts/auxiliarybar/auxiliaryBarComponent.ts";
import {
    AuxiliaryBarFocusContribution,
    AuxiliaryBarFocusContributionDIToken,
} from "../../workbench/browser/parts/auxiliarybar/auxiliaryBarFocusContribution.ts";
import {
    AuxiliaryBarService,
    AuxiliaryBarServiceDIToken,
} from "../../workbench/browser/parts/auxiliarybar/auxiliaryBarService.ts";
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
    WindowTitleContribution,
    WindowTitleContributionDIToken,
} from "../../workbench/browser/parts/titlebar/windowTitleContribution.ts";
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
import {
    UndoRefusalNotificationContribution,
    UndoRefusalNotificationContributionDIToken,
} from "../../workbench/browser/undoRefusalNotificationContribution.ts";
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
import { OpenEditorsView, OpenEditorsViewDIToken } from "../../workbench/contrib/files/browser/openEditorsView.ts";
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
import {
    GoToLocationsCommandContribution,
    GoToLocationsCommandContributionDIToken,
} from "../../workbench/contrib/gotoDefinition/browser/goToLocationsCommandContribution.ts";
import { HoverComponent, HoverComponentDIToken } from "../../workbench/contrib/hover/browser/hoverComponent.ts";
import { HoverService, HoverServiceDIToken } from "../../workbench/contrib/hover/browser/hoverService.ts";
import {
    InlineCompletionsService,
    InlineCompletionsServiceDIToken,
} from "../../workbench/contrib/inlineCompletions/browser/inlineCompletionsService.ts";
import {
    LanguageStatusContribution,
    LanguageStatusContributionDIToken,
} from "../../workbench/contrib/languageStatus/browser/languageStatus.ts";
import {
    LargeFileFollowStatus,
    LargeFileFollowStatusDIToken,
} from "../../workbench/contrib/largeFile/browser/largeFileFollowStatus.ts";
import {
    LargeFileIndexingStatus,
    LargeFileIndexingStatusDIToken,
} from "../../workbench/contrib/largeFile/browser/largeFileIndexingStatus.ts";
import {
    LargeFileOptimizationsWarner,
    LargeFileOptimizationsWarnerDIToken,
} from "../../workbench/contrib/largeFile/browser/largeFileOptimizationsWarner.ts";
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
    CallHierarchyComponent,
    CallHierarchyComponentDIToken,
} from "../../workbench/contrib/references/browser/callHierarchyComponent.ts";
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
    SmartSelectService,
    SmartSelectServiceDIToken,
} from "../../workbench/contrib/smartSelect/browser/smartSelectService.ts";
import {
    CompletionService,
    CompletionServiceDIToken,
} from "../../workbench/contrib/suggest/browser/completionService.ts";
import { SuggestComponent, SuggestComponentDIToken } from "../../workbench/contrib/suggest/browser/suggestComponent.ts";
import { TaskService, TaskServiceDIToken } from "../../workbench/contrib/tasks/browser/taskService.ts";
import {
    TaskStatusBarContribution,
    TaskStatusBarContributionDIToken,
} from "../../workbench/contrib/tasks/browser/taskStatusBarContribution.ts";
import {
    ProblemMatcherRegistry,
    ProblemMatcherRegistryDIToken,
} from "../../workbench/contrib/tasks/common/problemMatcherRegistry.ts";
import {
    TerminalColorsService,
    TerminalColorsServiceDIToken,
} from "../../workbench/contrib/terminal/browser/terminalColorsService.ts";
import { createTerminalEditorPaneFactory } from "../../workbench/contrib/terminal/browser/terminalEditorPaneFactory.ts";
import {
    TerminalEditorService,
    TerminalEditorServiceDIToken,
} from "../../workbench/contrib/terminal/browser/terminalEditorService.ts";
import {
    TerminalKeyRouting,
    TerminalKeyRoutingDIToken,
} from "../../workbench/contrib/terminal/browser/terminalKeyRouting.ts";
import {
    TerminalFocusFallbackDIToken,
    TerminalPanelComponent,
    TerminalPanelComponentDIToken,
} from "../../workbench/contrib/terminal/browser/terminalPanelComponent.ts";
import { TerminalService, TerminalServiceDIToken } from "../../workbench/contrib/terminal/browser/terminalService.ts";
import { TerminalWidgetFactoryDIToken } from "../../workbench/contrib/terminal/browser/terminalWidgetFactory.ts";
import { DefaultShellResolverDIToken } from "../../workbench/contrib/terminal/common/defaultShell.ts";
import {
    EnvironmentVariableService,
    EnvironmentVariableServiceDIToken,
} from "../../workbench/contrib/terminal/common/environmentVariableService.ts";
import { createExtensionEnvironmentContributor } from "../../workbench/contrib/terminal/common/extensionEnvironment.ts";
import {
    ExtensionPtySessionFactoryDIToken,
    TerminalSessionFactoryDIToken,
} from "../../workbench/contrib/terminal/common/terminalSessionFactory.ts";
import { EmbeddedTerminalSession } from "../../workbench/contrib/terminal/node/embeddedTerminalSession.ts";
import { ExtensionPtySession } from "../../workbench/contrib/terminal/node/extensionPtySession.ts";
import { TerminalLinkOpener } from "../../workbench/contrib/terminalContrib/links/browser/terminalLinkOpener.ts";
import {
    TerminalLinkQuickpick,
    TerminalLinkQuickpickDIToken,
} from "../../workbench/contrib/terminalContrib/links/browser/terminalLinkQuickpick.ts";
import {
    TerminalLinkOpenerDIToken,
    TerminalLinkService,
    TerminalLinkServiceDIToken,
} from "../../workbench/contrib/terminalContrib/links/browser/terminalLinkService.ts";
import {
    ThemeConfigContribution,
    ThemeConfigContributionDIToken,
} from "../../workbench/contrib/themes/browser/themeConfigContribution.ts";
import { UserDataProfileWorkspaceOpener } from "../../workbench/contrib/userDataProfile/browser/userDataProfileWorkspaceOpener.ts";
import { DialogService, DialogServiceDIToken } from "../../workbench/services/dialogs/browser/dialogService.ts";
import {
    FileDialogService,
    FileDialogServiceDIToken,
} from "../../workbench/services/dialogs/browser/fileDialogService.ts";
import { EditorGroupsService } from "../../workbench/services/editor/browser/editorGroupsService.ts";
import {
    EditorPaneFactoriesDIToken,
    type EditorPaneFactoryCtor,
} from "../../workbench/services/editor/browser/editorPaneFactory.ts";
import { EditorService } from "../../workbench/services/editor/browser/editorService.ts";
import {
    TextEditorPaneBuilder,
    TextEditorPaneBuilderDIToken,
} from "../../workbench/services/editor/browser/textEditorPaneBuilder.ts";
import { EditorGroupsServiceDIToken } from "../../workbench/services/editor/common/editorGroupsService.ts";
import { EditorServiceDIToken } from "../../workbench/services/editor/common/editorService.ts";
import { ExternalOpenerDIToken } from "../../workbench/services/externalOpener/common/iExternalOpener.ts";
import {
    ExternalOpenerService,
    spawnDetached,
} from "../../workbench/services/externalOpener/node/externalOpenerService.ts";
import { FocusTracker, FocusTrackerDIToken } from "../../workbench/services/focus/browser/focusTracker.ts";
import {
    EditorHistoryService,
    EditorHistoryServiceDIToken,
} from "../../workbench/services/history/browser/editorHistoryService.ts";
import {
    HistoryEditorSourceDIToken,
    HistoryGroupsSourceDIToken,
    HistoryService,
    HistoryServiceDIToken,
    JumpRecorderDIToken,
} from "../../workbench/services/history/browser/historyService.ts";
import {
    KeybindingDispatcher,
    KeybindingDispatcherDIToken,
} from "../../workbench/services/keybinding/browser/keybindingDispatcher.ts";
import {
    LanguageStatusService,
    LanguageStatusServiceDIToken,
} from "../../workbench/services/languageStatus/common/languageStatusService.ts";
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
    HostColorSchemeService,
    HostColorSchemeServiceDIToken,
} from "../../workbench/services/themes/browser/hostColorSchemeService.ts";
import { IUserDataProfileServiceDIToken } from "../../workbench/services/userDataProfile/common/userDataProfile.ts";
import {
    MENU_CONTRIBUTIONS,
    WORKBENCH_ACTIONS,
    WORKBENCH_CONTEXT_KEY_CONTRIBUTORS,
    WORKBENCH_CONTRIBUTIONS,
} from "../../workbench/workbench.common.main.ts";

const EDITOR_PANE_FACTORIES: readonly EditorPaneFactoryCtor[] = [
    createKeybindingsEditorPaneFactory,
    createDiffEditorPaneFactory,
    createTerminalEditorPaneFactory,
];

export const workbenchModule: ContainerModule = (container) => {
    container.bind(StatusBarServiceDIToken, StatusBarService);
    container.bind(ProgressServiceDIToken, ProgressService);
    container.bind(ProgressStatusBarContributionDIToken, ProgressStatusBarContribution);
    container.bind(KeybindingDispatcherDIToken, KeybindingDispatcher);
    container.bind(DialogServiceDIToken, DialogService);
    container.bind(FileDialogServiceDIToken, FileDialogService);
    container.bind(NotificationServiceDIToken, NotificationService);
    container.bind(NotificationsComponentDIToken, NotificationsComponent);
    container.bind(OpenFailureNotificationContributionDIToken, OpenFailureNotificationContribution);
    container.bind(LargeFileOptimizationsWarnerDIToken, LargeFileOptimizationsWarner);
    container.bind(LargeFileIndexingStatusDIToken, LargeFileIndexingStatus);
    container.bind(LanguageStatusServiceDIToken, LanguageStatusService);
    container.bind(LanguageStatusContributionDIToken, LanguageStatusContribution);
    container.bind(LargeFileFollowStatusDIToken, LargeFileFollowStatus);
    container.bind(UndoRefusalNotificationContributionDIToken, UndoRefusalNotificationContribution);
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
    container.bind(URLServiceDIToken, URLService);
    container.bind(LifecycleServiceDIToken, LifecycleService);
    container.bind(ExplorerServiceDIToken, ExplorerService);
    container.bind(ExplorerComponentDIToken, ExplorerComponent);
    container.bind(OpenEditorsViewDIToken, OpenEditorsView);
    container.bind(TextSearchServiceDIToken, TextSearchService);
    container.bind(SearchComponentDIToken, SearchComponent);
    container.bind(FileOperationsServiceDIToken, FileOperationsService);
    container.bind(LanguageFeatureContextKeysDIToken, LanguageFeatureContextKeys);
    container.bind(InputWidgetServiceDIToken, InputWidgetService);
    container.bind(QuickInputComponentDIToken, QuickInputComponent);
    container.bind(QuickInputServiceDIToken, QuickInputService);
    container.bind(FileSearchServiceDIToken, FileSearchService);
    container.bind(GotoLineEditorSourceDIToken, () => container.get(EditorServiceDIToken));
    container.bind(OpenEditorsSourceDIToken, () => {
        const editors = container.get(EditorServiceDIToken);
        const groups = container.get(EditorGroupsServiceDIToken);
        return {
            getOpenEditorsMru: () => groups.getOpenEditorsMru(),
            displayName: (editor) => editors.displayName(editor),
            revealPane: (editor) => {
                groups.revealPane(editor);
            },
        };
    });
    container.bind(FilesQuickAccessProviderDIToken, FilesQuickAccessProvider);
    container.bind(CommandsQuickAccessProviderDIToken, CommandsQuickAccessProvider);
    container.bind(GotoLineQuickAccessProviderDIToken, GotoLineQuickAccessProvider);
    container.bind(OpenEditorsQuickAccessProviderDIToken, OpenEditorsQuickAccessProvider);
    container.bind(QuickAccessProvidersDIToken, () => QUICK_ACCESS_PROVIDERS);
    container.bind(QuickAccessRegistryDIToken, QuickAccessRegistry);
    container.bind(QuickOpenServiceDIToken, QuickOpenService);
    // A new folder with a different profile reloads the window into it instead of switching folders: the profile is fixed per process.
    container.bind(
        WorkspaceFolderOpenerDIToken,
        () =>
            new UserDataProfileWorkspaceOpener(
                container.get(WorkbenchComponentDIToken),
                container.get(IUserDataProfilesServiceDIToken),
                container.get(IUserDataProfileServiceDIToken),
                container.get(ServiceAccessorDIToken),
                // Stryker disable next-line StringLiteral: log channel name
                container.get(ILogServiceDIToken).createLogger("profiles"),
            ),
    );
    container.bind(TextFileModelServiceDIToken, TextFileModelService);
    container.bind(TextEditorPaneBuilderDIToken, TextEditorPaneBuilder);
    container.bind(DocumentSemanticTokensFeatureDIToken, DocumentSemanticTokensFeature);
    container.bind(EditorGroupsServiceDIToken, EditorGroupsService);
    container.bind(EditorServiceDIToken, EditorService);
    container.bind(EditorPaneFactoriesDIToken, () => EDITOR_PANE_FACTORIES.map((create) => create(container)));
    // Edits to an open resource go through the buffer, not disk (or buffer and file diverge), as one undo step in the tab's bucket.
    container.bind(
        IBulkEditBuffersDIToken,
        () => new BulkEditBuffers(container.get(EditorServiceDIToken), container.get(TextFileModelServiceDIToken)),
    );
    container.bind(EditorPartComponentDIToken, EditorPartComponent);
    container.bind(TabSwitcherComponentDIToken, TabSwitcherComponent);
    container.bind(SuggestComponentDIToken, SuggestComponent);
    container.bind(CompletionServiceDIToken, CompletionService);
    container.bind(InlineCompletionsServiceDIToken, InlineCompletionsService);
    container.bind(DefinitionServiceDIToken, DefinitionService);
    container.bind(GoToLocationsCommandContributionDIToken, GoToLocationsCommandContribution);
    container.bind(HoverComponentDIToken, HoverComponent);
    container.bind(HoverServiceDIToken, HoverService);
    container.bind(ParameterHintsComponentDIToken, ParameterHintsComponent);
    container.bind(ParameterHintsServiceDIToken, ParameterHintsService);
    container.bind(CallHierarchyComponentDIToken, CallHierarchyComponent);
    container.bind(ReferencesComponentDIToken, ReferencesComponent);
    container.bind(ReferencesServiceDIToken, ReferencesService);
    container.bind(RenameServiceDIToken, RenameService);
    container.bind(SmartSelectServiceDIToken, SmartSelectService);
    container.bind(HistoryEditorSourceDIToken, () => container.get(EditorServiceDIToken));
    container.bind(HistoryGroupsSourceDIToken, () => container.get(EditorGroupsServiceDIToken));
    container.bind(HistoryServiceDIToken, HistoryService);
    container.bind(JumpRecorderDIToken, () => container.get(HistoryServiceDIToken));
    container.bind(EditorHistoryServiceDIToken, EditorHistoryService);
    container.bind(FindComponentDIToken, FindComponent);
    container.bind(FindServiceDIToken, FindService);
    container.bind(ActiveEditorStatusSourceDIToken, () => container.get(EditorServiceDIToken));
    container.bind(EditorStatusContributionDIToken, EditorStatusContribution);
    container.bind(TerminalEnvStatusContributionDIToken, TerminalEnvStatusContribution);
    container.bind(TerminalEnvContextKeysContributionDIToken, TerminalEnvContextKeysContribution);
    container.bind(TerminalKeyRoutingDIToken, TerminalKeyRouting);
    container.bind(StatusBarComponentDIToken, StatusBarComponent);
    container.bind(WorkbenchContributionsDIToken, () => WORKBENCH_CONTRIBUTIONS);
    container.bind(WorkbenchContributionsRegistryDIToken, WorkbenchContributionsRegistry);
    container.bind(MenuContributionsDIToken, () => MENU_CONTRIBUTIONS);
    container.bind(CommandActionsDIToken, () => WORKBENCH_ACTIONS);
    container.bind(MenuRegistryDIToken, MenuRegistry);
    container.bind(MenuServiceDIToken, MenuService);
    container.bind(ContextMenuServiceDIToken, ContextMenuService);
    container.bind(EditorContextMenuControllerDIToken, EditorContextMenuController);
    container.bind(AutoRevealContributionDIToken, AutoRevealContribution);
    container.bind(HostColorSchemeServiceDIToken, HostColorSchemeService);
    container.bind(ThemeConfigContributionDIToken, ThemeConfigContribution);
    container.bind(WindowTitleContributionDIToken, WindowTitleContribution);
    container.bind(OpenFileCommandContributionDIToken, OpenFileCommandContribution);
    // Stryker disable next-line ArrowFunction: DI binding without a unit test; end-to-end — e2e scenario extension-storage
    container.bind(SetContextCommandContributionDIToken, SetContextCommandContribution);
    container.bind(PanelServiceDIToken, PanelService);
    container.bind(PanelComponentDIToken, PanelComponent);
    container.bind(PanelFocusContributionDIToken, PanelFocusContribution);
    container.bind(AuxiliaryBarServiceDIToken, AuxiliaryBarService);
    container.bind(AuxiliaryBarComponentDIToken, AuxiliaryBarComponent);
    container.bind(AuxiliaryBarFocusContributionDIToken, AuxiliaryBarFocusContribution);
    container.bind(ProblemsComponentDIToken, ProblemsComponent);
    container.bind(OutputChannelRegistryDIToken, () => new OutputChannelRegistry());
    container.bind(OutputServiceDIToken, OutputService);
    container.bind(OutputComponentDIToken, OutputComponent);
    container.bind(OutputChannelActionsDIToken, OutputChannelActions);
    container.bind(EnvironmentVariableServiceDIToken, EnvironmentVariableService);
    // Stryker disable ArrowFunction,BlockStatement,EqualityOperator,StringLiteral,ConditionalExpression,CallExpression: production module wiring — the decisions live in `createExtensionEnvironmentContributor`/`buildEnv`, covered by unit tests; end-to-end — e2e scenario extension-environment-collection
    container.bind(TerminalSessionFactoryDIToken, () => {
        const environment = createExtensionEnvironmentContributor(
            () => container.get(EnvironmentVariableServiceDIToken).mergedCollection,
            container.get(IWorkspaceContextServiceDIToken),
            process.platform === "win32",
        );
        return (options) => new EmbeddedTerminalSession(options, environment);
    });
    // Stryker restore ArrowFunction,BlockStatement,EqualityOperator,StringLiteral,ConditionalExpression,CallExpression
    // Stryker disable next-line ArrowFunction,CallExpression: DI binding without a unit test; end-to-end — e2e scenario extension-terminal
    container.bind(ExtensionPtySessionFactoryDIToken, () => (options) => new ExtensionPtySession(options));
    container.bind(TerminalServiceDIToken, TerminalService);
    // Stryker disable next-line ArrowFunction,CallExpression: DI binding without a unit test (the test profile sets its own shell); end-to-end — e2e scenario tasks
    container.bind(DefaultShellResolverDIToken, () => () => getSystemShell());
    // Stryker disable next-line ArrowFunction,CallExpression: DI binding (the test profile binds a ready registry of its own); end-to-end — e2e scenario tsc-problem-matcher-task
    container.bind(ProblemMatcherRegistryDIToken, () => new ProblemMatcherRegistry());
    container.bind(TaskServiceDIToken, TaskService);
    container.bind(TaskStatusBarContributionDIToken, TaskStatusBarContribution);
    container.bind(TerminalFocusFallbackDIToken, () => container.get(EditorServiceDIToken));
    container.bind(TerminalColorsServiceDIToken, TerminalColorsService);
    container.bind(TerminalLinkOpenerDIToken, TerminalLinkOpener);
    container.bind(TerminalLinkServiceDIToken, TerminalLinkService);
    container.bind(TerminalLinkQuickpickDIToken, TerminalLinkQuickpick);
    container.bind(TerminalWidgetFactoryDIToken, () => {
        const links = container.get(TerminalLinkServiceDIToken);
        return (instance) => links.createWidget(instance);
    });
    container.bind(TerminalPanelComponentDIToken, TerminalPanelComponent);
    container.bind(TerminalEditorServiceDIToken, TerminalEditorService);
    container.bind(DiagnosticsEditorSourceDIToken, () => container.get(EditorServiceDIToken));
    container.bind(MarkerRevealTargetDIToken, () => container.get(EditorServiceDIToken));
    container.bind(SearchRevealTargetDIToken, () => container.get(EditorServiceDIToken));
    container.bind(ReferencesRevealTargetDIToken, () => container.get(EditorServiceDIToken));
    container.bind(DiagnosticsServiceDIToken, DiagnosticsService);
    // Gated on detached: on a diff tab getActiveEditor() returns one of its sides, but the diff has its own gutter markup.
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
    container.bind(ScmChangesServiceDIToken, ScmChangesService);
    container.bind(ChangesComponentDIToken, ChangesComponent);
    container.bind(ScmGraphServiceDIToken, ScmGraphService);
    container.bind(GraphViewComponentDIToken, GraphViewComponent);
    container.bind(ScmInputComponentDIToken, ScmInputComponent);
    container.bind(ScmRepoStateServiceDIToken, ScmRepoStateService);
    container.bind(ScmStatusBarContributionDIToken, ScmStatusBarContribution);
    container.bind(ScmBusyContextContributionDIToken, ScmBusyContextContribution);
    container.bind(LayoutServiceDIToken, LayoutService);
    container.bind(SidebarServiceDIToken, SidebarService);
    container.bind(ViewsServiceDIToken, ViewsService);
    container.bind(ExtensionViewWelcomesDIToken, ExtensionViewWelcomes);
    container.bind(ViewProgressContributionDIToken, ViewProgressContribution);
    container.bind(ViewTitleActionsContributionDIToken, ViewTitleActionsContribution);
    container.bind(WorkbenchStateServiceDIToken, WorkbenchStateService);
    container.bind(FocusTrackerDIToken, FocusTracker);
    container.bind(ContextKeyContributorsDIToken, () => WORKBENCH_CONTEXT_KEY_CONTRIBUTORS);
    container.bind(WorkbenchContextKeysDIToken, WorkbenchContextKeys);
    container.bind(MenuBarComponentDIToken, MenuBarComponent);
    container.bind(WorkbenchComponentDIToken, WorkbenchComponent);
};
