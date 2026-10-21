import { LanguageConfigurationServiceDIToken } from "../../editor/common/languages/iLanguageConfigurationService.ts";
import { LanguageServiceDIToken } from "../../editor/common/languages/iLanguageService.ts";
import { LanguageFeaturesServiceDIToken } from "../../editor/common/services/languageFeatures.ts";
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
import { URLServiceDIToken } from "../../platform/url/common/url.ts";
import type { IWorkspaceContextService } from "../../platform/workspace/common/iWorkspaceContextService.ts";
import { IWorkspaceContextServiceDIToken } from "../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import { CommandServiceAdapter } from "../../workbench/api/browser/commandServiceAdapter.ts";
import { bindDocumentSync, openDocumentSnapshots } from "../../workbench/api/browser/documentSyncAdapter.ts";
import { EditorDecorationsServiceAdapter } from "../../workbench/api/browser/editorDecorationsServiceAdapter.ts";
import { EditorLayoutServiceAdapter } from "../../workbench/api/browser/editorLayoutServiceAdapter.ts";
import { EditorOptionsServiceAdapter } from "../../workbench/api/browser/editorOptionsServiceAdapter.ts";
import { ExtensionOutputAdapter } from "../../workbench/api/browser/extensionOutputAdapter.ts";
import { ExtensionStatusBarAdapter } from "../../workbench/api/browser/extensionStatusBarAdapter.ts";
import { FileDecorationsServiceAdapter } from "../../workbench/api/browser/fileDecorationsServiceAdapter.ts";
import { FileDialogExtensionAdapter } from "../../workbench/api/browser/fileDialogExtensionAdapter.ts";
import { FileSystemProviderAdapter } from "../../workbench/api/browser/fileSystemProviderAdapter.ts";
import { FileWatcherAdapter } from "../../workbench/api/browser/fileWatcherAdapter.ts";
import { LanguageFeaturesAdapter } from "../../workbench/api/browser/languageFeaturesAdapter.ts";
import { NotificationExtensionAdapter } from "../../workbench/api/browser/notificationExtensionAdapter.ts";
import { ProgressStatusBarAdapter } from "../../workbench/api/browser/progressStatusBarAdapter.ts";
import { QuickInputExtensionAdapter } from "../../workbench/api/browser/quickInputExtensionAdapter.ts";
import { ThemeColorResolverAdapter } from "../../workbench/api/browser/themeColorResolverAdapter.ts";
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
import { EditorGroupsServiceDIToken } from "../../workbench/services/editor/common/editorGroupsService.ts";
import { EditorServiceDIToken } from "../../workbench/services/editor/common/editorService.ts";
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
 * Лениво, на каждый вызов: папку выставляют уже после биндинга. Пустое окно — пустой список,
 * а не `process.cwd()`: иначе git и прочие шерстили бы случайный каталог запуска.
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
    return {
        getSnapshot: () => configService.getConfigurationData(),
        getWorkspaceFolders: workspaceFoldersProvider(workspaceContext),
        getWorkspaceFile: () => workspaceContext.getWorkspace().configuration?.toString(),
        onDidChange: (cb) =>
            configService.onDidChangeConfiguration((event) => {
                cb(event.affectedKeys);
            }),
        updateValue: (key, value, target) => configService.updateValue(key, value, target),
        getConfigurationScopes: () => configurationRegistry.getConfigurationScopes(),
    };
}

export interface IExtensionHostModuleContext {
    /** Пользовательские, затем встроенные. */
    readonly extensions: readonly IExtension[];
    readonly registration: IExtensionRegistrationEnv;
}

export const extensionHostModule: ContainerModule<IExtensionHostModuleContext> = (container, ctx) => {
    let terminalAdapter: ExtensionTerminalAdapter | undefined;
    // Stryker disable ArrowFunction,AssignmentOperator: production-проводка модуля (один мост на хост и задачи); сквозняк — e2e-сценарии extension-terminal и extension-tasks
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
        // Stryker disable StringLiteral,ObjectLiteral: имена каналов и их метки — подписи в селекторе Output, поведения логирования не задают
        const logger = logService.createLogger("extensions.host", { label: "Extension Host" });
        const rpcLogger = logService.createLogger("extensions.host.rpc", { label: "Extension Host (RPC)" });
        const stdoutLogger = logService.createLogger("extensions.host.stdout", { label: "Extension Host (stdout)" });
        const stderrLogger = logService.createLogger("extensions.host.stderr", { label: "Extension Host (stderr)" });
        // Stryker restore StringLiteral,ObjectLiteral
        // Выключенный канал — поток ребёнка закрыт, а не читается впустую (и не наследуется в кадр TUI).
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

        const editorLayout = new EditorLayoutServiceAdapter(group, container.get(EditorGroupsServiceDIToken));

        // Stryker disable ArrowFunction: production-проводка модуля; решения живут в `watcherExcludeGlobs`/`watcherIncludesUnder` и `FileWatcherAdapter` и закрыты юнитами, сквозняк — живой прогон на Bazel-воркспейсе
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

        // Лениво, как `getWorkspaceFolders`: `storageUri` зависит от папки, которую выставят позже создания хоста.
        // Stryker disable next-line ArrowFunction: production-проводка модуля; решение о корнях живёт в `extensionStorageHomes` и закрыто юнитами, сквозняк — e2e-сценарий extension-storage
        const storageHomes = (): IExtensionStorageHomes =>
            extensionStorageHomes(environment, workspaceContext.getWorkspace().id);

        // Сами значения секретов не логируются нигде и никогда.
        // Stryker disable BlockStatement,CallExpression: production-проводка модуля (как у `storageHomes` выше) — решение о хранилище живёт в `extensionSecretsStore` и закрыто юнитами, сквозняк — e2e-сценарий extension-secrets
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
            openDocumentsProvider: () => openDocumentSnapshots(group),
            editorLayout,
            fileWatcher,
            storageHomes,
            secrets,
            extensionState,
            diagnosticsSink,
            markers: markerService,
            languageConfigurations: container.get(LanguageConfigurationServiceDIToken),
            progressSink: new ProgressStatusBarAdapter(container.get(StatusBarServiceDIToken)),
            statusBarItemSink: new ExtensionStatusBarAdapter(
                container.get(StatusBarServiceDIToken),
                commandAdapter,
                logger,
            ),
            quickInputSink: new QuickInputExtensionAdapter(container.get(QuickInputServiceDIToken)),
            notificationSink: new NotificationExtensionAdapter(container.get(NotificationServiceDIToken)),
            fileDialogSink: new FileDialogExtensionAdapter(container.get(FileDialogServiceDIToken)),
            // Опенер берётся в момент просьбы: его регистрирует модуль workbench.
            // Stryker disable ArrowFunction,BlockStatement,CallExpression: production-проводка модуля — решение живёт в WorkspaceFoldersExtensionAdapter и закрыто юнитами, сквозняк — extensionHost.updateWorkspaceFolders.test.ts и живой прогон golang.go («Go: Add Package to Workspace»)
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
            // Stryker disable ObjectLiteral,ArrowFunction: production-проводка модуля (как у `storageHomes`/`secrets` выше) — решение живёт в `resolveMachineId`/`EnvCustomer` и закрыто юнитами, сквозняк — e2e-сценарий status-bar-message
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
                    // Stryker disable next-line CallExpression: production-проводка модуля (как `environment` выше) — вызов колбэка на show закрыт юнитом ExtensionOutputAdapter, показ вида там, где он стоит, — юнитами ViewsService.openView
                    container.get(ViewsServiceDIToken).openView(OUTPUT_VIEW_ID);
                },
            ),
            terminalSink: terminals(),
            environmentVariableCollections: container.get(EnvironmentVariableServiceDIToken),
            taskSink: new ExtensionTaskAdapter(
                container.get(TaskServiceDIToken),
                workspaceContext,
                // Stryker disable next-line StringLiteral,ObjectLiteral: имя и подпись канала лога задач — проводка; канал «Tasks» виден в e2e-сценарии tasks
                logService.createLogger("tasks", { label: "Tasks" }),
            ),
        });

        new FileSystemProviderAdapter(host, container.get(IFileServiceDIToken));

        new LanguageFeaturesAdapter(host, container.get(LanguageFeaturesServiceDIToken));

        group.saveParticipant = (snapshot) => host.willSaveTextDocument(snapshot);
        group.onEditorSaved((meta) => {
            host.didSaveTextDocument(meta);
        });

        // Stryker disable next-line CallExpression: production-проводка модуля; поведение синхронизации закрыто тестами documentSyncAdapter и e2e
        bindDocumentSync(group, container.get(EditorGroupsServiceDIToken), host);

        // Stryker disable next-line ObjectLiteral,ArrowFunction: production-проводка модуля; поведение источника закрыто тестами хоста
        group.virtualDocumentSource = {
            // Stryker disable next-line ArrowFunction: см. выше
            canProvide: (scheme) => host.hasTextContentProvider(scheme),
            // Stryker disable next-line ArrowFunction: см. выше
            provide: (uri) => host.provideTextDocumentContent(uri),
        };
        // Stryker disable ArrowFunction,BlockStatement,CallExpression: production-проводка модуля; ExtensionTestHarness повторяет её симметрично, а поведение обеих сторон закрыто юнитами (`ExtensionHost.onDidChangeTextContent`, `EditorService.refreshVirtualDocument`) и сквозняком в тесте хоста «onDidChange провайдера перечитывает открытую вкладку»
        host.onDidChangeTextContent((uri) => {
            group.refreshVirtualDocument(uri);
        });
        // Stryker restore ArrowFunction,BlockStatement,CallExpression

        // Что не вышло за общий тайм-аут — сигналом в синхронной фазе: перезагрузка дальше
        // блокирует event loop, и субпроцесс остался бы сиротой.
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

        // У любой модели, а не только у активного редактора, — как `requestRichLanguageFeatures` у vscode.
        // События до регистрации расширений сервис запоминает и проигрывает сразу за `*`.
        container.get(LanguageServiceDIToken).onDidRequestLanguageFeatures((languageId) => {
            void service.activateByEvent(`onLanguage:${languageId}`);
            void service.activateByEvent("onLanguage");
        });

        // Stryker disable next-line CallExpression: production-проводка модуля; поведение закрыто юнитами bindExtensionTasks и e2e-сценарием extension-tasks
        bindExtensionTasks(
            container.get(TaskServiceDIToken),
            service,
            terminals(),
            // Stryker disable next-line StringLiteral,ObjectLiteral: имя и подпись канала лога задач — проводка; канал «Tasks» виден в e2e-сценарии tasks
            logService.createLogger("tasks", { label: "Tasks" }),
        );

        // Работающие расширения видели старые папки и стор — субпроцесс перезапускается (как reload окна у эталона).
        // Stryker disable CallExpression,BlockStatement,StringLiteral: production-проводка модуля (как у `storageHomes`/`secrets` выше) — решение живёт в `ExtensionHost.restartForWorkspaceChange` и закрыто его юнитами, сквозняк — e2e-сценарии activation-workspace-contains и workspaceFile
        container.get(IWorkspaceContextServiceDIToken).onDidChangeWorkspaceFolders(() => {
            void service.restartForWorkspaceChange().catch((err: unknown) => {
                logger.error("extension host restart on workspace change failed", err);
            });
        });
        // Stryker restore CallExpression,BlockStatement,StringLiteral

        // Как `_invalidateExtensionCollections` эталона.
        // Stryker disable ArrowFunction,MethodExpression,ConditionalExpression,EqualityOperator,CallExpression: production-проводка модуля — решение живёт в `EnvironmentVariableService.setInstalledExtensions` и закрыто юнитами
        container
            .get(EnvironmentVariableServiceDIToken)
            .setInstalledExtensions((id) => ctx.extensions.some((ext) => extensionKey(ext.id) === extensionKey(id)));
        // Stryker restore ArrowFunction,MethodExpression,ConditionalExpression,EqualityOperator,CallExpression

        // Stryker disable ObjectLiteral,ArrowFunction,BlockStatement,StringLiteral,CallExpression,BooleanLiteral,ArrayDeclaration: production-проводка модуля — решения живут в `ExtensionUrlHandler`/`installedExtensionDisplayName` и закрыты юнитами, сквозняк — e2e-сценарий extension-uri-handler
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
