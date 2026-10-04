import { createRange } from "../../editor/common/core/iRange.ts";
import { LanguageServiceDIToken } from "../../editor/common/languages/iLanguageService.ts";
import { LanguageFeaturesServiceDIToken } from "../../editor/common/services/languageFeatures.ts";
import { ClipboardDIToken } from "../../platform/clipboard/common/iClipboard.ts";
import { CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import { IConfigurationServiceDIToken } from "../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { IEnvironmentServiceDIToken } from "../../platform/environment/common/environment.ts";
import type { IExtension } from "../../platform/extensions/common/iExtension.ts";
import { IFileServiceDIToken } from "../../platform/files/common/files.ts";
import { ITreeFileWatcherDIToken } from "../../platform/files/common/iTreeFileWatcherDIToken.ts";
import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import { ILogServiceDIToken } from "../../platform/log/common/iLogServiceDIToken.ts";
import { LogLevel } from "../../platform/log/common/logLevel.ts";
import { type IMarkerData, MarkerSeverity } from "../../platform/markers/common/iMarker.ts";
import { MarkerServiceDIToken } from "../../platform/markers/common/markerService.ts";
import { StateServiceDIToken } from "../../platform/state/common/iStateService.ts";
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
import { FileSystemProviderAdapter } from "../../workbench/api/browser/fileSystemProviderAdapter.ts";
import { FileWatcherAdapter } from "../../workbench/api/browser/fileWatcherAdapter.ts";
import { LanguageFeaturesAdapter } from "../../workbench/api/browser/languageFeaturesAdapter.ts";
import { NotificationExtensionAdapter } from "../../workbench/api/browser/notificationExtensionAdapter.ts";
import { ProgressStatusBarAdapter } from "../../workbench/api/browser/progressStatusBarAdapter.ts";
import { QuickInputExtensionAdapter } from "../../workbench/api/browser/quickInputExtensionAdapter.ts";
import { ThemeColorResolverAdapter } from "../../workbench/api/browser/themeColorResolverAdapter.ts";
import type { WireMarker } from "../../workbench/api/common/wireTypes.ts";
import { PanelServiceDIToken } from "../../workbench/browser/parts/panel/panelService.ts";
import { QuickInputServiceDIToken } from "../../workbench/browser/parts/quickinput/quickInputService.ts";
import { watcherExcludeGlobs } from "../../workbench/common/configuration/excludeSettings.ts";
import { WorkspaceEditServiceDIToken } from "../../workbench/contrib/bulkEdit/browser/workspaceEditService.ts";
import { ExplorerServiceDIToken } from "../../workbench/contrib/files/browser/explorerService.ts";
import { EditorGroupsServiceDIToken } from "../../workbench/services/editor/common/editorGroupsService.ts";
import { EditorServiceDIToken } from "../../workbench/services/editor/common/editorService.ts";
import { ExtensionServiceDIToken } from "../../workbench/services/extensions/common/extensions.ts";
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
import { ExternalOpenerDIToken } from "../../workbench/services/externalOpener/common/iExternalOpener.ts";
import { LayoutServiceDIToken } from "../../workbench/services/layout/browser/layoutService.ts";
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
 * Поставщик папок воркспейса для extension host'а. Фабрика, а не готовое
 * значение, по двум причинам, и обе — контракт наружу, а не деталь проводки:
 *
 * 1. Папки читаются **лениво**, на каждый вызов: `getWorkspaceFolders` зовут
 *    при инициализации subprocess'а, а до неё успевает пройти
 *    `WorkbenchComponent.setWorkspaceFolder` (и Open Folder в рантайме тоже).
 *    Снимок, взятый в момент биндинга, залипал бы на состоянии «папки нет».
 * 2. Папка не открыта (пустое окно) — **пустой** список, а не `process.cwd()`.
 *    Подсунутый cwd отправил бы git и прочих шерстить случайный каталог, из
 *    которого человек запустил редактор; пустой массив `workspaceNamespace`
 *    отдаёт расширениям как `undefined` — ровно контракт VS Code для empty window.
 *
 * Сужения до одной папки здесь больше нет: провод хоста везёт массив
 * (`IWorkspaceFolderInfo` с `index`), и `IWorkspace.folders` — тоже массив, так
 * что перекладываем один в другой как есть.
 */
export function workspaceFoldersProvider(
    workspaceContext: IWorkspaceContextService,
): () => readonly IWorkspaceFolderInfo[] {
    return () =>
        workspaceContext
            .getWorkspace()
            .folders.map((folder) => ({ uri: folder.uri.toString(), name: folder.name, index: folder.index }));
}

/** Контекст модуля: набор расширений и сборка их регистраций (см. `main.ts`); корни хранения — из окружения. */
export interface IExtensionHostModuleContext {
    /** Просканированный набор: пользовательские, затем встроенные. */
    readonly extensions: readonly IExtension[];
    /** Откуда и с какими дефолтами собирать регистрации (`toExtensionRegistration`). */
    readonly registration: IExtensionRegistrationEnv;
}

/**
 * DI-модуль extension host'а. Связывает `EditorService` →
 * `IEditorOptionsService` → `ExtensionHost`. В production хост создаётся
 * пустым (без зарегистрированных расширений) — `main` builtin-расширений
 * пока не исполняется; всё подключение идёт в тестах через харнесс.
 *
 * Логгеры (`extensions.host`, `extensions.host.rpc`, `.stdout`, `.stderr`)
 * берутся из `ILogService` — в тестах профиль использует `NULL_LOG_SERVICE`,
 * `isEnabled` всегда `false`, поэтому stdio остаётся в режиме `"inherit"`.
 */
export const extensionHostModule: ContainerModule<IExtensionHostModuleContext> = (container, ctx) => {
    container.bind(ExtensionHostDIToken, () => {
        // Корни хранения расширений (`globalStorageUri`/`storageUri`/`logUri`, секреты) — из окружения.
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
        // \u0414\u043b\u044f NULL_LOG_SERVICE \u0432\u0441\u0435 \u0443\u0440\u043e\u0432\u043d\u0438 \u043e\u0442\u043a\u043b\u044e\u0447\u0435\u043d\u044b \u2014 \u043d\u0435 \u043f\u0435\u0440\u0435\u043a\u043b\u044e\u0447\u0430\u0435\u043c stdio \u0432 \"pipe\".
        const wantStdio = (lg: typeof stdoutLogger): typeof stdoutLogger | undefined =>
            lg.isEnabled(LogLevel.Info) ? lg : undefined;

        // Провайдер конфигурации: снапшот настроек + единственная папка воркспейса
        // (пока нет multi-root) — см. {@link workspaceFoldersProvider}: он же держит
        // ленивое чтение корня и пустой список для окна без папки. Слой Configuration
        // не тянется в рантайм host'а — доступ идёт через этот тонкий адаптер.
        const configService = container.get(IConfigurationServiceDIToken);
        const workspaceContext = container.get(IWorkspaceContextServiceDIToken);
        const explorer = container.get(ExplorerServiceDIToken);
        const configuration: IExtensionHostConfigProvider = {
            // Stryker disable next-line ArrowFunction: production-проводка модуля; слои собирает и закрывает юнитами сервис настроек, сквозняк до расширения — e2e-сценарий inline-suggest-settings (расширение читает свою настройку через getConfiguration)
            getSnapshot: () => configService.getConfigurationData(),
            getWorkspaceFolders: workspaceFoldersProvider(workspaceContext),
            onDidChange: (cb) =>
                configService.onDidChangeConfiguration((event) => {
                    cb(event.affectedKeys);
                }),
        };

        // Сток диагностик расширений → MarkerService: потребители (squiggle в
        // редакторе, панель Problems) слушают onDidChangeMarkers и правок не требуют.
        const markerService = container.get(MarkerServiceDIToken);
        const diagnosticsSink = (owner: string, resource: string, markers: readonly WireMarker[]): void => {
            const data: IMarkerData[] = markers.map((m) => ({
                severity: toMarkerSeverity(m.severity),
                range: createRange(m.startLine, m.startCharacter, m.endLine, m.endCharacter),
                message: m.message,
                ...(m.code !== undefined ? { code: m.code } : {}),
                ...(m.source !== undefined ? { source: m.source } : {}),
            }));
            markerService.changeOne(owner, resource, data);
        };

        // Мосты декораций (Chunk 4): gutter change-bar'ы → редакторы группы,
        // файловые декорации → дерево, ThemeColor id → цвет активной темы.
        const editorDecorations = new EditorDecorationsServiceAdapter(group);
        const fileDecorations = new FileDecorationsServiceAdapter(explorer);
        const themeColorResolver = new ThemeColorResolverAdapter(container.get(ThemeServiceDIToken));

        // Полоса групп: снимки layoutChanged + showTextDocument/close для
        // window.tabGroups (владение — у хоста через register не оформляем:
        // адаптер живёт, пока жив модуль, как остальные адаптеры здесь).
        const editorLayout = new EditorLayoutServiceAdapter(group, container.get(EditorGroupsServiceDIToken));

        // Слежение за деревом для `workspace.createFileSystemWatcher`: сам обход
        // ведёт ядро, excludes берутся из живой настройки `files.watcherExclude`.
        const fileWatcher = new FileWatcherAdapter(container.get(ITreeFileWatcherDIToken), () =>
            watcherExcludeGlobs(configService),
        );

        // Приватные каталоги расширений (`globalStorageUri`/`storageUri`/`logUri`).
        // Провайдер ЛЕНИВЫЙ по той же причине, что `getWorkspaceFolders` выше:
        // папку воркспейса выставляет `WorkbenchComponent.setWorkspaceFolder`
        // позже создания хоста, а `storageUri` зависит именно от неё. Адресуется
        // `storageUri` ИДЕНТИЧНОСТЬЮ воркспейса (`IWorkspace.id`), а не путём
        // папки. Сам резолв — в `extensionStorageHomes` (чистый, с тестами),
        // здесь только чтение id.
        // Stryker disable next-line ArrowFunction: production-проводка модуля; решение о корнях живёт в `extensionStorageHomes` и закрыто юнитами, сквозняк — e2e-сценарий extension-storage
        const storageHomes = (): IExtensionStorageHomes =>
            extensionStorageHomes(environment, workspaceContext.getWorkspace().id);

        // Секреты расширений — отдельный файл в user-data (0600, синхронная
        // запись). Беды хранилища уходят в лог хоста; сами значения не логируются
        // нигде и никогда.
        // Stryker disable BlockStatement,CallExpression: production-проводка модуля (как у `storageHomes` выше) — решение о хранилище живёт в `extensionSecretsStore` и закрыто юнитами, сквозняк — e2e-сценарий extension-secrets
        const secrets = createFileExtensionSecretStore(environment.secretsFile, (message, err) => {
            logger.error(message, err);
        });
        // Stryker restore BlockStatement,CallExpression
        // Memento расширений (`globalState`/`workspaceState`) — поверх общего
        // StateService: переживает перезапуск, как состояние самого workbench'а.
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
            // withProgress расширений → запись статус-бара со спиннером.
            progressSink: new ProgressStatusBarAdapter(container.get(StatusBarServiceDIToken)),
            // createStatusBarItem расширений → собственные записи в полосе;
            // клик исполняет команду расширения тем же адаптером команд, что и
            // остальные вызовы субпроцесса.
            statusBarItemSink: new ExtensionStatusBarAdapter(
                container.get(StatusBarServiceDIToken),
                commandAdapter,
                logger,
            ),
            // showInputBox/showQuickPick расширений → общий QuickInput-оверлей
            // приложения (тот же, что у палитры и Quick Open).
            quickInputSink: new QuickInputExtensionAdapter(container.get(QuickInputServiceDIToken)),
            // show*Message расширений → стек тостов над статус-баром (у модального
            // сообщения — окно по центру); нажатая кнопка уезжает обратно расширению.
            notificationSink: new NotificationExtensionAdapter(container.get(NotificationServiceDIToken)),
            // env.clipboard — тот же буфер, которым пользуются copy/paste ядра.
            clipboard: container.get(ClipboardDIToken),
            // env.openExternal — системный обработчик, а без графического сеанса
            // (ssh, контейнер) ссылка отдаётся человеку: буфер плюс сообщение.
            externalOpener: container.get(ExternalOpenerDIToken),
            // createOutputChannel расширений → канал в панели Output;
            // show() открывает панель (как toggleOutputAction) и переключает канал.
            outputSink: new ExtensionOutputAdapter(
                container.get(OutputChannelRegistryDIToken),
                logService,
                container.get(OutputServiceDIToken),
                () => {
                    container.get(PanelServiceDIToken).setActiveView(OUTPUT_VIEW_ID);
                    container.get(LayoutServiceDIToken).setPanelVisible(true);
                },
            ),
        });

        // Провайдеры ФС расширений: схемы, объявленные субпроцессом (`git:` у
        // встроенного git), становятся читаемыми через реестр ядра. Адаптер сам
        // следит за появлением/исчезновением схем — расширение может
        // активироваться позже создания хоста.
        new FileSystemProviderAdapter(host, container.get(IFileServiceDIToken));

        // Языковые провайдеры расширений (languages.register): прокси по handle
        // в реестрах ядра — их читают потребители фич (HoverService, …).
        new LanguageFeaturesAdapter(host, container.get(LanguageFeaturesServiceDIToken));

        // Save-pipeline: редакторы группы прогоняют will-save через host
        // (onWillSaveTextDocument), а состоявшееся сохранение уходит обратно
        // в subprocess (onDidSaveTextDocument).
        group.saveParticipant = (snapshot) => host.willSaveTextDocument(snapshot);
        group.onEditorSaved((meta) => {
            host.didSaveTextDocument(meta);
        });

        // Document sync (LSP): didOpen на смену активного редактора, didChange на
        // правку его содержимого — стоковый vscode-languageclient видит живой буфер.
        // Stryker disable next-line CallExpression: production-проводка модуля; поведение синхронизации закрыто тестами documentSyncAdapter и e2e
        bindDocumentSync(group, container.get(EditorGroupsServiceDIToken), host);

        // Содержимое недисковых ресурсов: провайдеры расширений
        // (workspace.registerTextDocumentContentProvider) — источник текста для
        // read-only вкладок `jdt:`/`class:`. Читает сам EditorService в openUri,
        // именно по этому пути Go to Definition доезжает в библиотеку.
        // Stryker disable next-line ObjectLiteral,ArrowFunction: production-проводка модуля; поведение источника закрыто тестами хоста
        group.virtualDocumentSource = {
            // Stryker disable next-line ArrowFunction: см. выше
            canProvide: (scheme) => host.hasTextContentProvider(scheme),
            // Stryker disable next-line ArrowFunction: см. выше
            provide: (uri) => host.provideTextDocumentContent(uri),
        };
        // Провайдер объявил `onDidChange` — перечитываем открытую вкладку этого
        // ресурса. Без этого содержимое в редакторе навсегда осталось бы тем,
        // каким оно было в момент открытия.
        // Stryker disable ArrowFunction,BlockStatement,CallExpression: production-проводка модуля; ExtensionTestHarness повторяет её симметрично, а поведение обеих сторон закрыто юнитами (`ExtensionHost.onDidChangeTextContent`, `EditorService.refreshVirtualDocument`) и сквозняком в тесте хоста «onDidChange провайдера перечитывает открытую вкладку»
        host.onDidChangeTextContent((uri) => {
            group.refreshVirtualDocument(uri);
        });
        // Stryker restore ArrowFunction,BlockStatement,CallExpression

        // Прощание (выход, перезагрузка окна, выход по инспектору) — один путь:
        // сперва вежливо, с `deactivate()` расширений, а что не успело выйти за
        // общий тайм-аут — сигналом в синхронной фазе (перезагрузка дальше
        // блокирует event loop, и субпроцесс остался бы сиротой).
        const lifecycle = container.get(LifecycleServiceDIToken);
        lifecycle.onWillShutdown((event) => {
            event.join(host.shutdown());
        });
        lifecycle.onShutdownSync(() => {
            host.disposeNow();
        });

        return host;
    });

    // Сервис расширений — политика «что и когда активировать» поверх механики
    // host'а: регистрация набора, барьер с памятью событий, стартовая активация.
    container.bind(ExtensionServiceDIToken, () => {
        const logService = container.get(ILogServiceDIToken);
        const logger = logService.createLogger("extensions");
        const service = new ExtensionService(
            container.get(ExtensionHostDIToken),
            ctx.extensions,
            ctx.registration,
            logger,
        );

        // Активация по `onLanguage:<id>` (напр. diode-settings на JSON) — когда
        // языку впервые понадобились фичи: у любой модели, а не только у
        // активного редактора (новый документ, смена языка, вкладка, на которую
        // ещё не переключались), — как `requestRichLanguageFeatures` у vscode,
        // вместе с голым `onLanguage`. Языки файлов, открытых на старте ДО
        // регистрации расширений, не теряются: сервис запоминает события и
        // проигрывает их сразу за `*`. Ядро про activation-events не знает.
        container.get(LanguageServiceDIToken).onDidRequestLanguageFeatures((languageId) => {
            void service.activateByEvent(`onLanguage:${languageId}`);
            void service.activateByEvent("onLanguage");
        });

        // `workspaceContains:<паттерн>` по смене набора папок: папка может
        // открыться ПОЗЖЕ старта, и событие «в проекте есть pom.xml» иначе
        // прогорело бы в пустоту. Стартовый проход делает сам сервис.
        // Stryker disable CallExpression,BlockStatement,StringLiteral: production-проводка модуля (как у `storageHomes`/`secrets` выше) — решение о поводе активации живёт в `ExtensionHost.activateByWorkspaceContains` и закрыто его юнитами, сквозняк — e2e-сценарий activation-workspace-contains
        container.get(IWorkspaceContextServiceDIToken).onDidChangeWorkspaceFolders(() => {
            void service.activateByWorkspaceContains().catch((err: unknown) => {
                logger.error("workspaceContains activation failed", err);
            });
        });
        // Stryker restore CallExpression,BlockStatement,StringLiteral

        return service;
    });
};
