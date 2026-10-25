import { LanguageConfigurationServiceDIToken } from "../../editor/common/languages/iLanguageConfigurationService.ts";
import { LanguageServiceDIToken } from "../../editor/common/languages/iLanguageService.ts";
import {
    type ILanguageFeaturesService,
    LanguageFeaturesServiceDIToken,
} from "../../editor/common/services/languageFeatures.ts";
import { MenuRegistryDIToken } from "../../platform/actions/common/menuRegistry.ts";
import { ClipboardDIToken } from "../../platform/clipboard/common/iClipboard.ts";
import { CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import type { ConfigurationRegistry } from "../../platform/configuration/common/configurationRegistry.ts";
import { ConfigurationRegistryDIToken } from "../../platform/configuration/common/configurationRegistryDIToken.ts";
import type { IConfigurationService } from "../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { IEnvironmentServiceDIToken } from "../../platform/environment/common/environment.ts";
import { extensionKey } from "../../platform/extensions/common/extensionDependencies.ts";
import type { IExtension } from "../../platform/extensions/common/iExtension.ts";
import { IFileServiceDIToken } from "../../platform/files/common/files.ts";
import { ITreeFileWatcherDIToken } from "../../platform/files/common/iTreeFileWatcherDIToken.ts";
import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import { ILogServiceDIToken } from "../../platform/log/common/iLogServiceDIToken.ts";
import { LogLevel } from "../../platform/log/common/logLevel.ts";
import { type IMarkerData, MarkerSeverity } from "../../platform/markers/common/iMarker.ts";
import { MarkerServiceDIToken } from "../../platform/markers/common/markerService.ts";
import { StateServiceDIToken } from "../../platform/state/common/iStateService.ts";
import { ProductIconServiceDIToken } from "../../platform/theme/common/productIconService.ts";
import { URLServiceDIToken } from "../../platform/url/common/url.ts";
import type { IWorkspaceContextService } from "../../platform/workspace/common/iWorkspaceContextService.ts";
import { IWorkspaceContextServiceDIToken } from "../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import { CommandServiceAdapter } from "../../workbench/api/browser/commandServiceAdapter.ts";
import { bindDocumentSync, openDocumentSyncSources } from "../../workbench/api/browser/documentSyncAdapter.ts";
import { EditorDecorationsServiceAdapter } from "../../workbench/api/browser/editorDecorationsServiceAdapter.ts";
import { EditorLayoutServiceAdapter } from "../../workbench/api/browser/editorLayoutServiceAdapter.ts";
import { EditorOptionsServiceAdapter } from "../../workbench/api/browser/editorOptionsServiceAdapter.ts";
import { ExtensionOutputAdapter } from "../../workbench/api/browser/extensionOutputAdapter.ts";
import { ExtensionStatusBarAdapter } from "../../workbench/api/browser/extensionStatusBarAdapter.ts";
import { ExtensionTreeViewsAdapter } from "../../workbench/api/browser/extensionTreeViewsAdapter.ts";
import { FileDecorationsServiceAdapter } from "../../workbench/api/browser/fileDecorationsServiceAdapter.ts";
import { FileDialogExtensionAdapter } from "../../workbench/api/browser/fileDialogExtensionAdapter.ts";
import { FileSystemProviderAdapter } from "../../workbench/api/browser/fileSystemProviderAdapter.ts";
import { FileWatcherAdapter } from "../../workbench/api/browser/fileWatcherAdapter.ts";
import { LanguageFeaturesAdapter } from "../../workbench/api/browser/languageFeaturesAdapter.ts";
import { NotificationExtensionAdapter } from "../../workbench/api/browser/notificationExtensionAdapter.ts";
import { ProgressStatusBarAdapter } from "../../workbench/api/browser/progressStatusBarAdapter.ts";
import { QuickInputExtensionAdapter } from "../../workbench/api/browser/quickInputExtensionAdapter.ts";
import { ThemeColorResolverAdapter } from "../../workbench/api/browser/themeColorResolverAdapter.ts";
import { bindViewActivation } from "../../workbench/api/browser/viewsExtensionPoint.ts";
import { WorkspaceFoldersExtensionAdapter } from "../../workbench/api/browser/workspaceFoldersExtensionAdapter.ts";
import type { WireMarker } from "../../workbench/api/common/wireTypes.ts";
import { WATCHER_INCLUDE_SETTING, watcherIncludesUnder } from "../../workbench/api/node/watcherIncludes.ts";
import { QuickInputServiceDIToken } from "../../workbench/browser/parts/quickinput/quickInputService.ts";
import { ViewsServiceDIToken } from "../../workbench/browser/parts/views/viewsService.ts";
import { watcherExcludeGlobs } from "../../workbench/common/configuration/excludeSettings.ts";
import { WorkspaceEditServiceDIToken } from "../../workbench/contrib/bulkEdit/browser/workspaceEditService.ts";
import { ExplorerServiceDIToken } from "../../workbench/contrib/files/browser/explorerService.ts";
import { WorkspaceFolderOpenerDIToken } from "../../workbench/contrib/files/browser/fileActions.ts";
import {
    bindExtensionTasks,
    ExtensionTaskAdapter,
} from "../../workbench/contrib/tasks/browser/extensionTaskAdapter.ts";
import { TaskServiceDIToken } from "../../workbench/contrib/tasks/browser/taskService.ts";
import { ExtensionTerminalAdapter } from "../../workbench/contrib/terminal/browser/extensionTerminalAdapter.ts";
import { TerminalEditorServiceDIToken } from "../../workbench/contrib/terminal/browser/terminalEditorService.ts";
import { TerminalServiceDIToken } from "../../workbench/contrib/terminal/browser/terminalService.ts";
import { DefaultShellResolverDIToken } from "../../workbench/contrib/terminal/common/defaultShell.ts";
import { EnvironmentVariableServiceDIToken } from "../../workbench/contrib/terminal/common/environmentVariableService.ts";
import { ExtensionPtySessionFactoryDIToken } from "../../workbench/contrib/terminal/common/terminalSessionFactory.ts";
import { DialogServiceDIToken } from "../../workbench/services/dialogs/browser/dialogService.ts";
import { FileDialogServiceDIToken } from "../../workbench/services/dialogs/browser/fileDialogService.ts";
import {
    EditorGroupsServiceDIToken,
    type IEditorGroupsService,
} from "../../workbench/services/editor/common/editorGroupsService.ts";
import { EditorServiceDIToken, type IEditorService } from "../../workbench/services/editor/common/editorService.ts";
import { ExtensionServiceDIToken } from "../../workbench/services/extensions/common/extensions.ts";
import {
    CONFIRMED_URI_HANDLER_EXTENSION_IDS_SETTING,
    ExtensionUrlHandler,
    installedExtensionDisplayName,
} from "../../workbench/services/extensions/common/extensionUrlHandler.ts";
import {
    ExtensionHost,
    ExtensionHostDIToken,
    type IExtensionHostConfigProvider,
    type IWorkspaceFolderInfo,
} from "../../workbench/services/extensions/node/extensionHost.ts";
import type { IExtensionRegistrationEnv } from "../../workbench/services/extensions/node/extensionRegistration.ts";
import { createFileExtensionSecretStore } from "../../workbench/services/extensions/node/extensionSecretsStore.ts";
import { ExtensionService } from "../../workbench/services/extensions/node/extensionService.ts";
import { createExtensionStateStore } from "../../workbench/services/extensions/node/extensionStateStore.ts";
import {
    extensionStorageHomes,
    type IExtensionStorageHomes,
} from "../../workbench/services/extensions/node/extensionStoragePaths.ts";
import { resolveMachineId } from "../../workbench/services/extensions/node/machineIdState.ts";
import { createRipgrepWorkspaceScanner } from "../../workbench/services/extensions/node/workspaceContainsActivation.ts";
import { ExternalOpenerDIToken } from "../../workbench/services/externalOpener/common/iExternalOpener.ts";
import { LifecycleServiceDIToken } from "../../workbench/services/lifecycle/browser/lifecycleService.ts";
import { NotificationServiceDIToken } from "../../workbench/services/notification/browser/notificationService.ts";
import { OUTPUT_VIEW_ID, OutputChannelRegistryDIToken } from "../../workbench/services/output/common/output.ts";
import { OutputServiceDIToken } from "../../workbench/services/output/common/outputService.ts";
import { StatusBarServiceDIToken } from "../../workbench/services/statusbar/common/statusBarService.ts";
import { ThemeServiceDIToken } from "../../workbench/services/themes/common/themeTokens.ts";

/** `vscode.DiagnosticSeverity` (0=Error…3=Hint) → `MarkerSeverity`. */
function toMarkerSeverity(severity: number): MarkerSeverity {
    switch (severity) {
        case 1:
            return MarkerSeverity.Warning;
        case 2:
            return MarkerSeverity.Info;
        case 3:
            return MarkerSeverity.Hint;
        default:
            return MarkerSeverity.Error;
    }
}

/**
 * Lazy, per call: the folder is set after binding. An empty window yields an empty list, not
 * `process.cwd()` — otherwise git and others would crawl whatever directory diode was launched from.
 */
export function workspaceFoldersProvider(
    workspaceContext: IWorkspaceContextService,
): () => readonly IWorkspaceFolderInfo[] {
    return () =>
        workspaceContext
            .getWorkspace()
            .folders.map((folder) => ({ uri: folder.uri.toString(), name: folder.name, index: folder.index }));
}

export function extensionHostConfigProvider(
    configService: IConfigurationService,
    configurationRegistry: ConfigurationRegistry,
    workspaceContext: IWorkspaceContextService,
): IExtensionHostConfigProvider {
    return configProviderOver(configService, configurationRegistry, workspaceFoldersProvider(workspaceContext), () =>
        workspaceContext.getWorkspace().configuration?.toString(),
    );
}

/** Shared with `ExtensionTestHarness`, which has folders without a workspace context. */
export function configProviderOver(
    configService: IConfigurationService,
    configurationRegistry: ConfigurationRegistry,
    getWorkspaceFolders: () => readonly IWorkspaceFolderInfo[],
    getWorkspaceFile: () => string | undefined,
): IExtensionHostConfigProvider {
    return {
        getSnapshot: () => configService.getConfigurationData(),
        getWorkspaceFolders,
        getWorkspaceFile,
        onDidChange: (cb) =>
            configService.onDidChangeConfiguration((event) => {
                cb(event.affectedKeys);
            }),
        updateValue: (key, value, target) => configService.updateValue(key, value, target),
        getConfigurationScopes: () => configurationRegistry.getConfigurationScopes(),
    };
}

/** Shared with `ExtensionTestHarness`: its host tests exercise this very wiring. */
export function bindExtensionHostToEditors(
    host: ExtensionHost,
    group: IEditorService,
    editorGroups: IEditorGroupsService,
    languageFeatures: ILanguageFeaturesService,
): void {
    new LanguageFeaturesAdapter(host, languageFeatures);
    group.saveParticipant = (snapshot) => host.willSaveTextDocument(snapshot);
    group.onEditorSaved((meta) => {
        host.didSaveTextDocument(meta);
    });
    bindDocumentSync(group, editorGroups, host);
    group.virtualDocumentSource = {
        canProvide: (scheme) => host.hasTextContentProvider(scheme),
        provide: (uri) => host.provideTextDocumentContent(uri),
    };
    host.onDidChangeTextContent((uri) => {
        group.refreshVirtualDocument(uri);
    });
}

export interface IExtensionHostModuleContext {
    /** User extensions first, then built-in ones. */
    readonly extensions: readonly IExtension[];
    readonly registration: IExtensionRegistrationEnv;
}

export const extensionHostModule: ContainerModule<IExtensionHostModuleContext> = (container, ctx) => {
    let terminalAdapter: ExtensionTerminalAdapter | undefined;
    // Stryker disable ArrowFunction,AssignmentOperator: production module wiring (one bridge shared by the host and tasks); end-to-end — e2e scenarios extension-terminal and extension-tasks
    const terminals = (): ExtensionTerminalAdapter =>
        (terminalAdapter ??= new ExtensionTerminalAdapter(
            container.get(TerminalServiceDIToken),
            container.get(ViewsServiceDIToken),
            container.get(ExtensionPtySessionFactoryDIToken),
            container.get(TerminalEditorServiceDIToken),
            container.get(IConfigurationServiceDIToken),
        ));
    // Stryker restore ArrowFunction,AssignmentOperator
    container.bind(ExtensionHostDIToken, () => {
        const environment = container.get(IEnvironmentServiceDIToken);
        const group = container.get(EditorServiceDIToken);
        const adapter = new EditorOptionsServiceAdapter(
            group,
            container.get(EditorGroupsServiceDIToken),
            container.get(WorkspaceEditServiceDIToken),
        );
        const commandAdapter = new CommandServiceAdapter(container.get(CommandRegistryDIToken));
        const logService = container.get(ILogServiceDIToken);
        // Stryker disable StringLiteral,ObjectLiteral: channel names and labels are captions in the Output picker and do not affect logging behavior
        const logger = logService.createLogger("extensions.host", { label: "Extension Host" });
        const rpcLogger = logService.createLogger("extensions.host.rpc", { label: "Extension Host (RPC)" });
        const stdoutLogger = logService.createLogger("extensions.host.stdout", { label: "Extension Host (stdout)" });
        const stderrLogger = logService.createLogger("extensions.host.stderr", { label: "Extension Host (stderr)" });
        // Stryker restore StringLiteral,ObjectLiteral
        // A disabled channel closes the child's stream instead of draining it (and keeps it out of the TUI frame).
        const wantStdio = (lg: typeof stdoutLogger): typeof stdoutLogger | undefined =>
            lg.isEnabled(LogLevel.Info) ? lg : undefined;

        const configService = container.get(IConfigurationServiceDIToken);
        const workspaceContext = container.get(IWorkspaceContextServiceDIToken);
        const explorer = container.get(ExplorerServiceDIToken);
        const configuration = extensionHostConfigProvider(
            configService,
            container.get(ConfigurationRegistryDIToken),
            workspaceContext,
        );

        const markerService = container.get(MarkerServiceDIToken);
        const diagnosticsSink = (owner: string, resource: string, markers: readonly WireMarker[]): void => {
            const data: IMarkerData[] = markers.map((m) => ({
                severity: toMarkerSeverity(m.severity),
                range: m.range,
                message: m.message,
                ...(m.code !== undefined ? { code: m.code } : {}),
                ...(m.source !== undefined ? { source: m.source } : {}),
            }));
            markerService.changeOne(owner, resource, data);
        };

        const editorDecorations = new EditorDecorationsServiceAdapter(group);
        const fileDecorations = new FileDecorationsServiceAdapter(explorer);
        const themeColorResolver = new ThemeColorResolverAdapter(container.get(ThemeServiceDIToken));
        const icons = container.get(ProductIconServiceDIToken);

        const editorLayout = new EditorLayoutServiceAdapter(group, container.get(EditorGroupsServiceDIToken));

        // Stryker disable ArrowFunction: production module wiring; the decisions live in `watcherExcludeGlobs`/`watcherIncludesUnder` and `FileWatcherAdapter`, covered by unit tests; end-to-end — live run on a Bazel workspace
        const fileWatcher = new FileWatcherAdapter(
            container.get(ITreeFileWatcherDIToken),
            () => watcherExcludeGlobs(configService),
            (base) =>
                watcherIncludesUnder(
                    base,
                    configService.get(WATCHER_INCLUDE_SETTING),
                    workspaceContext.getWorkspace().folders.map((folder) => folder.uri.fsPath),
                ),
        );
        // Stryker restore ArrowFunction

        // Lazy, like `getWorkspaceFolders`: `storageUri` depends on a folder that is set after the host is created.
        // Stryker disable next-line ArrowFunction: production module wiring; the choice of roots lives in `extensionStorageHomes`, covered by unit tests; end-to-end — e2e scenario extension-storage
        const storageHomes = (): IExtensionStorageHomes =>
            extensionStorageHomes(environment, workspaceContext.getWorkspace().id);

        // Secret values themselves are never logged anywhere.
        // Stryker disable BlockStatement,CallExpression: production module wiring (like `storageHomes` above) — the storage decision lives in `extensionSecretsStore`, covered by unit tests; end-to-end — e2e scenario extension-secrets
        const secrets = createFileExtensionSecretStore(environment.secretsFile, (message, err) => {
            logger.error(message, err);
        });
        // Stryker restore BlockStatement,CallExpression
        const extensionState = createExtensionStateStore(container.get(StateServiceDIToken));

        const host = new ExtensionHost(adapter, commandAdapter, {
            logger,
            rpcLogger,
            stdoutLogger: wantStdio(stdoutLogger),
            stderrLogger: wantStdio(stderrLogger),
            configuration,
            editorDecorations,
            fileDecorations,
            themeColorResolver,
            icons,
            // Stryker disable next-line ArrowFunction: production module wiring — the seed is covered by DocumentsCustomer unit tests and the handshake seed test; end-to-end — the stock LanguageServers suites (vscode-languageclient reads `workspace.textDocuments` on start)
            openDocumentsProvider: () => openDocumentSyncSources(group),
            editorLayout,
            fileWatcher,
            storageHomes,
            secrets,
            extensionState,
            // The same `files.exclude`/`search.exclude`/ignore files as Quick Open.
            workspaceScanner: createRipgrepWorkspaceScanner(configService),
            diagnosticsSink,
            markers: markerService,
            languageConfigurations: container.get(LanguageConfigurationServiceDIToken),
            progressSink: new ProgressStatusBarAdapter(container.get(StatusBarServiceDIToken), undefined, icons),
            statusBarItemSink: new ExtensionStatusBarAdapter(
                container.get(StatusBarServiceDIToken),
                commandAdapter,
                logger,
                icons,
            ),
            quickInputSink: new QuickInputExtensionAdapter(container.get(QuickInputServiceDIToken), icons),
            notificationSink: new NotificationExtensionAdapter(container.get(NotificationServiceDIToken)),
            fileDialogSink: new FileDialogExtensionAdapter(container.get(FileDialogServiceDIToken)),
            // The opener is resolved on request: the workbench module registers it.
            // Stryker disable ArrowFunction,BlockStatement,CallExpression: production module wiring — the decision lives in WorkspaceFoldersExtensionAdapter, covered by unit tests; end-to-end — extensionHost.updateWorkspaceFolders.test.ts and a live run of golang.go ("Go: Add Package to Workspace")
            workspaceFoldersSink: new WorkspaceFoldersExtensionAdapter(
                (folder) => {
                    container.get(WorkspaceFolderOpenerDIToken).setWorkspaceFolder(folder);
                },
                container.get(NotificationServiceDIToken),
                (id) => installedExtensionDisplayName(ctx.extensions, id),
            ),
            // Stryker restore ArrowFunction,BlockStatement,CallExpression
            clipboard: container.get(ClipboardDIToken),
            externalOpener: container.get(ExternalOpenerDIToken),
            // Stryker disable ObjectLiteral,ArrowFunction: production module wiring (like `storageHomes`/`secrets` above) — the decision lives in `resolveMachineId`/`EnvCustomer`, covered by unit tests; end-to-end — e2e scenario status-bar-message
            environment: {
                machineId: () => resolveMachineId(container.get(StateServiceDIToken)),
                defaultShell: container.get(DefaultShellResolverDIToken),
            },
            // Stryker restore ObjectLiteral,ArrowFunction
            outputSink: new ExtensionOutputAdapter(
                container.get(OutputChannelRegistryDIToken),
                logService,
                container.get(OutputServiceDIToken),
                () => {
                    // Stryker disable next-line CallExpression: production module wiring (like `environment` above) — the show callback is covered by the ExtensionOutputAdapter unit test, revealing the view in place by ViewsService.openView unit tests
                    container.get(ViewsServiceDIToken).openView(OUTPUT_VIEW_ID);
                },
                icons,
            ),
            terminalSink: terminals(),
            environmentVariableCollections: container.get(EnvironmentVariableServiceDIToken),
            // Stryker disable ObjectLiteral,ArrowFunction,BlockStatement,StringLiteral,BooleanLiteral,ArrayDeclaration,CallExpression: production module wiring — the decisions live in ExtensionTreeViewsAdapter/ExtensionTreeView, covered by unit tests; end-to-end — e2e scenario extension-tree-view
            treeViewsSink: new ExtensionTreeViewsAdapter({
                views: container.get(ViewsServiceDIToken),
                commands: container.get(CommandRegistryDIToken),
                menus: container.get(MenuRegistryDIToken),
                configuration: configService,
                workspace: workspaceContext,
                colors: themeColorResolver,
                icons,
                notifyError: (message) => {
                    container
                        .get(NotificationServiceDIToken)
                        .show({ severity: "error", message, modal: false, items: [] });
                },
                logger: logService.createLogger("extensions"),
            }),
            // Stryker restore ObjectLiteral,ArrowFunction,BlockStatement,StringLiteral,BooleanLiteral,ArrayDeclaration,CallExpression
            taskSink: new ExtensionTaskAdapter(
                container.get(TaskServiceDIToken),
                workspaceContext,
                // Stryker disable next-line StringLiteral,ObjectLiteral: the task log channel name and label are wiring; the "Tasks" channel shows up in the tasks e2e scenario
                logService.createLogger("tasks", { label: "Tasks" }),
            ),
        });

        new FileSystemProviderAdapter(host, container.get(IFileServiceDIToken));

        bindExtensionHostToEditors(
            host,
            group,
            container.get(EditorGroupsServiceDIToken),
            container.get(LanguageFeaturesServiceDIToken),
        );

        // Whatever outlives the shared timeout gets a signal in the sync phase: a reload then
        // blocks the event loop, and the subprocess would be orphaned.
        const lifecycle = container.get(LifecycleServiceDIToken);
        lifecycle.onWillShutdown((event) => {
            event.join(host.shutdown());
        });
        lifecycle.onShutdownSync(() => {
            host.disposeNow();
        });

        return host;
    });

    container.bind(ExtensionServiceDIToken, () => {
        const logService = container.get(ILogServiceDIToken);
        const logger = logService.createLogger("extensions");
        const service = new ExtensionService(
            container.get(ExtensionHostDIToken),
            ctx.extensions,
            ctx.registration,
            logger,
        );

        // For any model, not just the active editor — like vscode's `requestRichLanguageFeatures`.
        // Events before extensions are registered are buffered by the service and replayed right after `*`.
        container.get(LanguageServiceDIToken).onDidRequestLanguageFeatures((languageId) => {
            void service.activateByEvent(`onLanguage:${languageId}`);
            void service.activateByEvent("onLanguage");
        });
        // Views shown before registration (layout restore of an extension's container) are buffered the same way.
        // Stryker disable next-line ArrowFunction,CallExpression: production module wiring — the producer is covered by the bindViewActivation unit tests, end to end by the view-container-switcher e2e scenario
        bindViewActivation(container.get(ViewsServiceDIToken).onDidShowView, (event) => service.activateByEvent(event));

        // Stryker disable next-line CallExpression: production module wiring; behavior is covered by bindExtensionTasks unit tests and the extension-tasks e2e scenario
        bindExtensionTasks(
            container.get(TaskServiceDIToken),
            service,
            terminals(),
            // Stryker disable next-line StringLiteral,ObjectLiteral: the task log channel name and label are wiring; the "Tasks" channel shows up in the tasks e2e scenario
            logService.createLogger("tasks", { label: "Tasks" }),
        );

        // Running extensions saw the old folders and storage, so the subprocess restarts (like the upstream window reload).
        // Stryker disable CallExpression,BlockStatement,StringLiteral: production module wiring (like `storageHomes`/`secrets` above) — the decision lives in `ExtensionHost.restartForWorkspaceChange`, covered by its unit tests; end-to-end — e2e scenarios activation-workspace-contains and workspaceFile
        container.get(IWorkspaceContextServiceDIToken).onDidChangeWorkspaceFolders(() => {
            void service.restartForWorkspaceChange().catch((err: unknown) => {
                logger.error("extension host restart on workspace change failed", err);
            });
        });
        // Stryker restore CallExpression,BlockStatement,StringLiteral

        // Like upstream `_invalidateExtensionCollections`.
        // Stryker disable ArrowFunction,MethodExpression,ConditionalExpression,EqualityOperator,CallExpression: production module wiring — the decision lives in `EnvironmentVariableService.setInstalledExtensions`, covered by unit tests
        container
            .get(EnvironmentVariableServiceDIToken)
            .setInstalledExtensions((id) => ctx.extensions.some((ext) => extensionKey(ext.id) === extensionKey(id)));
        // Stryker restore ArrowFunction,MethodExpression,ConditionalExpression,EqualityOperator,CallExpression

        // Stryker disable ObjectLiteral,ArrowFunction,BlockStatement,StringLiteral,CallExpression,BooleanLiteral,ArrayDeclaration: production module wiring — the decisions live in `ExtensionUrlHandler`/`installedExtensionDisplayName`, covered by unit tests; end-to-end — e2e scenario extension-uri-handler
        const host = container.get(ExtensionHostDIToken);
        const notifications = container.get(NotificationServiceDIToken);
        const urlHandler = new ExtensionUrlHandler({
            handlers: host.uriHandlers,
            activateByEvent: (event) => service.activateByEvent(event),
            extensionDisplayName: (id) => installedExtensionDisplayName(ctx.extensions, id),
            confirm: (message) =>
                container
                    .get(DialogServiceDIToken)
                    .confirm({ title: "Open URI", message, confirmLabel: "Open", defaultButton: "confirm" }),
            confirmedExtensionIds: () =>
                container.get(IConfigurationServiceDIToken).get(CONFIRMED_URI_HANDLER_EXTENSION_IDS_SETTING),
            notifyNotInstalled: (id) => {
                notifications.show({
                    severity: "warn",
                    message: `Extension '${id}' is not installed, so it cannot open this URI.`,
                    modal: false,
                    items: [],
                });
            },
            logger,
        });
        container.get(URLServiceDIToken).registerHandler(urlHandler);
        // Stryker restore ObjectLiteral,ArrowFunction,BlockStatement,StringLiteral,CallExpression,BooleanLiteral,ArrayDeclaration

        return service;
    });
};
