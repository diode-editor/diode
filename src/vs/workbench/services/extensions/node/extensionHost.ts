import {
    CancellationTokenNone,
    CancellationTokenSource,
    type ICancellationToken,
} from "../../../../base/common/cancellation.ts";
import { type Event } from "../../../../base/common/event.ts";
import { Disposable, DisposableStore, type IDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { ICodeActionRequest, ICoreCodeAction } from "../../../../editor/common/languages/iCodeActionSource.ts";
import type {
    ICompletionRequest,
    ICoreCompletionResult,
    ICoreResolvedCompletion,
} from "../../../../editor/common/languages/iCompletionSource.ts";
import type {
    ICoreDefinitionLocation,
    IDefinitionRequest,
} from "../../../../editor/common/languages/iDefinitionSource.ts";
import type { IFoldingRequest } from "../../../../editor/common/languages/iFoldingSource.ts";
import type { IFormattingRequest } from "../../../../editor/common/languages/iFormattingSource.ts";
import type { ICoreHover, IHoverRequest } from "../../../../editor/common/languages/iHoverSource.ts";
import type {
    ICoreInlineCompletionItem,
    IInlineCompletionRequest,
} from "../../../../editor/common/languages/iInlineCompletionSource.ts";
import type { ICoreReference, IReferenceRequest } from "../../../../editor/common/languages/iReferenceSource.ts";
import type {
    ICoreRenameLocation,
    ICoreRenameResult,
    IRenameRequest,
} from "../../../../editor/common/languages/iRenameSource.ts";
import type {
    ICoreSignatureHelp,
    ISignatureHelpRequest,
} from "../../../../editor/common/languages/iSignatureHelpSource.ts";
import type { IFoldingRegion } from "../../../../editor/contrib/folding/iFoldingRegion.ts";
import type { IClipboard } from "../../../../platform/clipboard/common/iClipboard.ts";
import type { ConfigurationScope } from "../../../../platform/configuration/common/configurationRegistry.ts";
import type {
    ConfigurationTarget,
    IConfigurationData,
} from "../../../../platform/configuration/common/iConfigurationService.ts";
import {
    extensionFriendlyName,
    extensionKey,
    findDependencyLoop,
    readExtensionDependencies,
} from "../../../../platform/extensions/common/extensionDependencies.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { HostRpc } from "../../../api/common/extHostProtocol.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IDocumentSyncTarget } from "../../../api/common/iDocumentSyncTarget.ts";
import {
    type IEditorDecorationsService,
    NULL_EDITOR_DECORATIONS_SERVICE,
} from "../../../api/common/iEditorDecorationsService.ts";
import { type IEditorLayoutService, NULL_EDITOR_LAYOUT_SERVICE } from "../../../api/common/iEditorLayoutService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { type IExtensionFileWatcher, NULL_EXTENSION_FILE_WATCHER } from "../../../api/common/iExtensionFileWatcher.ts";
import type {
    DiagnosticsSink,
    INotificationSink,
    IOutputSink,
    IProgressSink,
    IQuickInputSink,
    IStatusBarItemSink,
} from "../../../api/common/iExtensionWindowSinks.ts";
import {
    type IFileDecorationsService,
    NULL_FILE_DECORATIONS_SERVICE,
} from "../../../api/common/iFileDecorationsService.ts";
import { type IThemeColorResolver, NULL_THEME_COLOR_RESOLVER } from "../../../api/common/iThemeColorResolver.ts";
import type { IWireLanguageProviderRegistration } from "../../../api/common/wireTypes.ts";
import {
    type IWireDocumentChangedEvent,
    type IWireDocumentSyncSnapshot,
    type IWireExtensionCatalog,
    type IWireExtensionDescription,
} from "../../../api/common/wireTypes.ts";
import type { IExternalOpener } from "../../externalOpener/common/iExternalOpener.ts";
import type { ISaveEdit, ISaveSnapshot } from "../../textfile/common/iSaveParticipant.ts";
import {
    hasWorkspaceContainsPatterns,
    type IWorkspaceContainsPatterns,
    readActivationEvents,
    readCommandActivationIds,
    readWorkspaceContainsPatterns,
} from "../common/activationEvents.ts";
import type { IExtensionHostCustomer } from "../common/extensionHostCustomer.ts";

import { CommandsCustomer } from "./customers/commandsCustomer.ts";
import { ConfigurationCustomer } from "./customers/configurationCustomer.ts";
import { DecorationsCustomer } from "./customers/decorationsCustomer.ts";
import { DocumentsCustomer, MAX_SYNCED_DOCUMENT_CHARS } from "./customers/documentsCustomer.ts";
import { EditorCustomer } from "./customers/editorCustomer.ts";
import { EnvCustomer } from "./customers/envCustomer.ts";
import { FileSystemCustomer } from "./customers/fileSystemCustomer.ts";
import { LanguageFeaturesCustomer } from "./customers/languageFeaturesCustomer.ts";
import { SecretsCustomer } from "./customers/secretsCustomer.ts";
import { WindowCustomer } from "./customers/windowCustomer.ts";
import { defaultSpawnArgs, ExtensionHostProcess } from "./extensionHostProcess.ts";
import { ExtensionPhases } from "./extensionPhases.ts";
import { createInMemoryExtensionSecretStore, type IExtensionSecretStore } from "./extensionSecretsStore.ts";
import { createTransientExtensionStateStore, type IExtensionStateStore } from "./extensionStateStore.ts";
import {
    ensureExtensionStorageParents,
    fallbackExtensionStorageHomes,
    type IExtensionStorageHomes,
    resolveExtensionStoragePaths,
} from "./extensionStoragePaths.ts";
import { parseWireMementoUpdate } from "./hostWireParsers.ts";
import { extensionRootPath, type IExtensionRegistration } from "./iExtensionEntry.ts";
import { DEFAULT_REQUEST_TIMEOUTS, type RequestTimeouts } from "./requestPolicy.ts";
import {
    createNodeWorkspaceScanner,
    type IWorkspaceContainsResult,
    type IWorkspaceScanner,
    matchWorkspaceContains,
} from "./workspaceContainsActivation.ts";

export const ExtensionHostDIToken = token<ExtensionHost>("ExtensionHost");

/** Папка воркспейса, проецируемая в subprocess (`workspace.workspaceFolders`). */
export interface IWorkspaceFolderInfo {
    /** Ресурс папки как `uri.toString()` — настоящий uri, а не голый путь под именем uri. */
    readonly uri: string;
    readonly name: string;
    readonly index: number;
}

/**
 * Провайдер конфигурации для push-модели: host рассылает снапшот настроек и
 * папки воркспейса в subprocess (`getConfiguration(...).get(...)` в расширениях
 * синхронный, RPC-per-get невозможен). Внедряется в {@link ExtensionHost} из
 * {@link ../../Workbench/Modules/ExtensionHostModule.ts} поверх
 * `IConfigurationService`, чтобы не тянуть слой Configuration в рантайм host'а.
 */
export interface IExtensionHostConfigProvider {
    /**
     * Слои настроек (`IConfigurationService.getConfigurationData()`): дефолты
     * общего реестра — ядро и все расширения — и пользовательские. Субпроцесс
     * сливает их той же моделью, своего defaults-слоя у него нет.
     */
    getSnapshot(): IConfigurationData;
    /** Папки воркспейса (одна, из `process.cwd()`, пока нет multi-root). */
    getWorkspaceFolders(): readonly IWorkspaceFolderInfo[];
    /** Подписка на изменение настроек (live-reload); передаёт изменившиеся ключи. */
    onDidChange(cb: (affectedKeys: readonly string[]) => void): IDisposable;
    /**
     * Запись `WorkspaceConfiguration.update` (`IConfigurationService.updateValue`):
     * к резолву промиса {@link onDidChange} уже отстрелял новым значением.
     */
    updateValue(key: string, value: unknown, target: ConfigurationTarget): Promise<void>;
    /**
     * `scope` зарегистрированных ключей — ядра и расширений
     * (`ConfigurationRegistry.getConfigurationScopes`): по ним запись отличает
     * неизвестный ключ и ключ, которому не место в настройках папки.
     */
    getConfigurationScopes(): ReadonlyMap<string, ConfigurationScope>;
}

export interface IExtensionHostOptions {
    /**
     * Команда и аргументы для запуска subprocess'а. По умолчанию вычисляется
     * автоматически (`process.execPath` + `process.execArgv` + main script).
     * Перекрывается в тестах.
     */
    readonly spawnArgs?: () => { command: string; args: string[]; env?: NodeJS.ProcessEnv };
    /**
     * Тайм-аут на ожидание `host.ready` от subprocess'а, мс. Default: 5000.
     */
    readonly readyTimeoutMs?: number;
    /**
     * Тайм-аут на graceful shutdown через `host.shutdown` перед `SIGTERM`. Default: 1500.
     */
    readonly shutdownTimeoutMs?: number;
    /**
     * Логгер для lifecycle-событий host'а (канал `extensions.host`). Подканалы
     * `extensions.host.rpc` / `.stdout` / `.stderr` берутся из {@link logService}, если передан.
     */
    readonly logger?: ILogger;
    /**
     * Логгер для trace каждого RPC-сообщения (канал `extensions.host.rpc`).
     */
    readonly rpcLogger?: ILogger;
    /**
     * Логгер для stdout subprocess'а (канал `extensions.host.stdout`). Если передан —
     * stdout читается построчно в лог; иначе закрыт (`"ignore"`) — наследовать его
     * нельзя: терминал общий с редактором, печать попала бы в кадр.
     */
    readonly stdoutLogger?: ILogger;
    /**
     * Логгер для stderr subprocess'а (канал `extensions.host.stderr`).
     */
    readonly stderrLogger?: ILogger;
    /**
     * Провайдер конфигурации для push в subprocess (`workspace.initialize` /
     * `workspace.configurationChanged`). Если не передан — конфиг не рассылается
     * и `getConfiguration()` в расширениях пуст.
     */
    readonly configuration?: IExtensionHostConfigProvider;
    /**
     * Мост gutter change-bar декораций к открытым редакторам
     * (`editor.setDecorations`). Если не передан — {@link NULL_EDITOR_DECORATIONS_SERVICE}
     * (декорации редактора игнорируются).
     */
    readonly editorDecorations?: IEditorDecorationsService;
    /**
     * Мост файловых декораций к дереву (`window.fileDecorationsChanged`). Если не
     * передан — {@link NULL_FILE_DECORATIONS_SERVICE} (декорации файлов игнорируются).
     */
    readonly fileDecorations?: IFileDecorationsService;
    /**
     * Резолвер `vscode.ThemeColor` id → packed-RGB (+ событие смены темы). Если не
     * передан — {@link NULL_THEME_COLOR_RESOLVER} (все цвета не резолвятся).
     */
    readonly themeColorResolver?: IThemeColorResolver;
    /**
     * Сток диагностик из расширений (`languages.createDiagnosticCollection().set()`
     * → notify `diagnostics.publish`). Если не передан — диагностики отбрасываются.
     */
    readonly diagnosticsSink?: DiagnosticsSink;
    /**
     * Сток прогресса из расширений (`window.withProgress` → notify
     * `window.progress.*`). Если не передан — прогресс отбрасывается. При смерти
     * subprocess'а host сам шлёт `end` всем живым handle'ам — спиннеры не зависают.
     */
    readonly progressSink?: IProgressSink;
    /**
     * Сток output-каналов расширений (`window.createOutputChannel` → notify
     * `output.append`/`output.show`). Если не передан — вывод отбрасывается.
     */
    readonly outputSink?: IOutputSink;
    /**
     * Сток пунктов статус-бара расширений (`window.createStatusBarItem` → notify
     * `window.statusBarItem.*`). Если не передан — пункты отбрасываются. При
     * смерти subprocess'а host сам зовёт `clear()`: `dispose` от умершего
     * расширения уже не придёт, а его пункты в полосе висеть не должны.
     */
    readonly statusBarItemSink?: IStatusBarItemSink;
    /**
     * Сток ввода от расширений (`window.showInputBox` / `window.showQuickPick`).
     * Если не передан — расширение мгновенно получает «отменено» (`undefined`),
     * а не зависает. При смерти subprocess'а host сам гасит живые показы, чтобы
     * оверлей не остался на экране без хозяина.
     */
    readonly quickInputSink?: IQuickInputSink;
    /**
     * Сток сообщений расширений (`window.show*Message`). Если не передан —
     * сообщение уходит только в лог, а расширение мгновенно получает
     * «закрыто без выбора» (`undefined`), а не зависает. Тем же стоком хост
     * сам говорит человеку, что расширение не поднялось из-за неизвестной
     * зависимости (`extensionDependencies`), — как тост `unknownDep` эталона.
     */
    readonly notificationSink?: INotificationSink;
    /**
     * Буфер обмена для `env.clipboard`. Если не передан — чтение отдаёт пустую
     * строку, запись молча теряется (как было до появления провода).
     */
    readonly clipboard?: IClipboard;
    /**
     * Открыватель ссылок для `env.openExternal`. Если не передан — расширение
     * честно получает `false`.
     */
    readonly externalOpener?: IExternalOpener;
    /**
     * Снимки ВСЕХ открытых документов для наполнения `workspace.textDocuments`
     * на `host.ready` (по одному на документ; см. `openDocumentSnapshots`).
     * Хост пушит их как `editor.didOpen` при готовности subprocess'а — чтобы
     * реестр был заполнен ДО активации расширения (стоковый
     * vscode-languageclient читает его на `start()`).
     */
    readonly openDocumentsProvider?: () => IWireDocumentSyncSnapshot[];
    /**
     * Наблюдатель за деревом каталогов для `workspace.createFileSystemWatcher`
     * расширений. Если не передан — {@link NULL_EXTENSION_FILE_WATCHER}:
     * watcher'ы расширений создаются, но никогда не стреляют.
     */
    readonly fileWatcher?: IExtensionFileWatcher;
    /**
     * Полоса групп редакторов для `window.tabGroups`/`showTextDocument`
     * (снимки `editor.layoutChanged` + исполнение show/close). Если не передан —
     * {@link NULL_EDITOR_LAYOUT_SERVICE}: `tabGroups` в субпроцессе пуст.
     */
    readonly editorLayout?: IEditorLayoutService;
    /**
     * Корни приватных каталогов расширений (`ExtensionContext.globalStorageUri` /
     * `storageUri` / `logUri`). Читается ЛЕНИВО на каждой активации: папка
     * воркспейса становится известна позже создания хоста, а `storageUri`
     * зависит именно от неё. Если не передан — {@link fallbackExtensionStorageHomes}
     * (каталог во временных файлах ОС, без воркспейсного корня).
     */
    readonly storageHomes?: () => IExtensionStorageHomes;
    /**
     * Хранилище `ExtensionContext.secrets`. Если не передано —
     * {@link createInMemoryExtensionSecretStore}: секреты честно работают, но
     * живут ровно столько, сколько хост (юнит-тесты, харнессы, встроенные
     * прогоны). Персистентный вариант подключает `extensionHostModule`.
     */
    readonly secrets?: IExtensionSecretStore;
    /**
     * Хранилище `ExtensionContext.globalState` / `workspaceState`. Если не
     * передано — {@link createTransientExtensionStateStore}: memento живёт в
     * памяти субпроцесса (юнит-тесты, харнессы). Персистентный вариант поверх
     * `IStateService` подключает `extensionHostModule`.
     */
    readonly extensionState?: IExtensionStateStore;
    /**
     * Доступ к дереву воркспейса для событий `workspaceContains:<glob>`
     * (см. {@link ExtensionHost.activateByWorkspaceContains}). Если не передан —
     * {@link createNodeWorkspaceScanner} поверх настоящей ФС.
     */
    readonly workspaceScanner?: IWorkspaceScanner;
    /**
     * Тайм-аут на обход дерева под `workspaceContains:<glob>`, мс. По истечении
     * обход отменяется, а расширение остаётся неактивным — как в эталоне
     * (`WORKSPACE_CONTAINS_TIMEOUT`). Default: 7000.
     */
    readonly workspaceContainsTimeoutMs?: number;
    /**
     * Сроки ответа субпроцесса на pull-запросы, мс, по методу провода —
     * поверх {@link DEFAULT_REQUEST_TIMEOUTS} (тесты укорачивают). Истёкший срок
     * отменяет запрос и даёт пустой результат.
     */
    readonly requestTimeouts?: Partial<RequestTimeouts>;
    /**
     * Порог синхронизации документа с субпроцессом, в символах: документ
     * больше — для расширений не существует (ни зеркала, ни провайдеров, ни
     * will-save). Default: {@link MAX_SYNCED_DOCUMENT_CHARS} (50 Mi, как у VS Code).
     */
    readonly maxSyncedDocumentChars?: number;
}

/**
 * Host-сторона extension subsystem'ы. Форкает один subprocess (через
 * `child_process.spawn(process.execPath, ..., { stdio: [...,'ipc'] })`) и
 * управляет жизненным циклом расширений через RPC поверх Node IPC-канала.
 *
 * Subprocess — это тот же бинарь / тот же main.ts с env-флагом
 * `DIODE_EXTENSION_HOST=1`; ранний branch в `main.ts` уводит управление в
 * `runExtensionHostSubprocess()`.
 *
 * Lifecycle:
 * - `registerExtension(reg)` — только запоминает регистрацию (`pending`) и
 *   заголовки команд для палитры; subprocess НЕ поднимается. Возвращает
 *   disposable для снятия расширения.
 * - `activateByEvent(event)` — активирует ещё не активные `pending`-расширения,
 *   чьи события активации содержат событие: лениво поднимает subprocess (если
 *   ещё не) и шлёт `host.activateExtension`. Идемпотентно.
 * - `activateByWorkspaceContains()` — то же, но повод считается по ФС:
 *   `workspaceContains:<паттерн>` сверяется с открытыми папками воркспейса.
 * - `unregisterExtension(id)` — `host.deactivateExtension`.
 * - `dispose()` — `host.shutdown` (best effort) → ждём exit → SIGTERM →
 *   SIGKILL fallback; {@link ExtensionHost.shutdown} — то же, но отдаёт промис
 *   прощания (его ждёт `LifecycleService.onWillShutdown`).
 */
/** Имя регистрации для сообщений человеку. */
function friendlyName(reg: IExtensionRegistration): string {
    return extensionFriendlyName(reg.id, reg.manifest);
}

export class ExtensionHost extends Disposable implements IDocumentSyncTarget {
    private readonly options: Required<
        Pick<IExtensionHostOptions, "spawnArgs" | "readyTimeoutMs" | "shutdownTimeoutMs" | "workspaceContainsTimeoutMs">
    >;
    private readonly logger: ILogger | undefined;
    private readonly rpcLogger: ILogger | undefined;
    private readonly stdoutLogger: ILogger | undefined;
    private readonly stderrLogger: ILogger | undefined;
    private readonly configuration: IExtensionHostConfigProvider | undefined;
    /** Декорации и тема — customer, которому хост ещё отдаёт семя темы на handshake. */
    private readonly decorations: DecorationsCustomer;
    /** Фазы расширений: все регистрации, ожидающие активации и активные. */
    private readonly phases = new ExtensionPhases();
    /**
     * Журнал запрошенных событий активации (как `_allRequestedActivateEvents`
     * эталона): {@link activateByEvent} пишет в него всегда, даже когда
     * подходящих расширений нет. По нему встают расширения, зарегистрированные
     * после своего события, и оживают пережившие смерть субпроцесса: их событие
     * (`onStartupFinished`, `onLanguage:<уже открытый язык>`) давно отгорело и
     * второй раз не наступит. `workspaceContains:` в журнал не пишется — его
     * повод заново считается по ФС.
     */
    private readonly requestedEvents = new Set<string>();
    /**
     * Субпроцесс умер с активными расширениями (они вернулись в `pending`):
     * ЛЮБОЕ следующее событие активации сперва проигрывает журнал. Лениво, а
     * не сразу при смерти, — краш-петлю не устраиваем.
     */
    private replayPending = false;
    /**
     * Ключи установленных расширений без кода (`main`): регистрации у них нет,
     * но зависимость на такое расширение удовлетворена — активировать нечего
     * (как `_isResolvedExtension` эталона).
     */
    private readonly declarativeExtensions = new Set<string>();
    /** Сток тоста о неизвестной зависимости (см. {@link IExtensionHostOptions.notificationSink}). */
    private readonly notificationSink: INotificationSink | undefined;
    /**
     * Адреса СВОИХ показов хоста в стоке сообщений: отрицательные, чтобы не
     * пересечься с адресами `window.show*Message` субпроцесса (те растут от 1 и
     * гасятся на его смерти, а тост хоста к субпроцессу отношения не имеет).
     */
    private nextHostMessageHandle = -1;
    /** Активации в полёте (id → регистрация и промис): их ждут и соседние вызовы. */
    private readonly activating = new Map<string, { reg: IExtensionRegistration; done: Promise<void> }>();
    /** Текущий субпроцесс: spawn, канал, выключение (см. {@link ExtensionHostProcess}). */
    private process: ExtensionHostProcess | null = null;
    private rpc: HostRpc | null = null;
    private readyPromise: Promise<void> | null = null;
    /**
     * Всё, что живёт один спавн субпроцесса: подключения customers (их
     * обработчики, подписки на ядро и handle'ы). Наполняет
     * {@link installHostHandlers}, а {@link endSpawn} снимает целиком и заводит
     * чистый для следующего спавна: иначе каждый респавн копил бы вечных
     * слушателей, шлющих в мёртвый канал.
     */
    private spawnStore = new DisposableStore();
    /** Поверхности API, вынесенные из хоста (G1); подключаются на каждый спавн. */
    private readonly customers: readonly IExtensionHostCustomer[];
    private hostDisposed = false;
    /** Прощание с субпроцессом, начатое {@link dispose}: его ждёт {@link shutdown}. */
    private shutdownDone: Promise<void> = Promise.resolve();
    /** Субпроцесс, которого вежливо попросили выйти, а он ещё не вышел (см. {@link disposeNow}). */
    private exitingProcess: ExtensionHostProcess | null = null;
    /** Документы: will/did-save и document sync — customer семени открытых документов. */
    private readonly documents: DocumentsCustomer;
    /** Редакторы и полоса групп — customer, которому хост отдаёт семена на handshake. */
    private readonly editor: EditorCustomer;
    /** Настройки — customer семени `workspace.initialize`; нет провайдера — нет и его. */
    private readonly configurationCustomer: ConfigurationCustomer | undefined;
    /** Команды расширений в реестре ядра: прокси спавна и заглушки-активаторы. */
    private readonly commands: CommandsCustomer;
    /** ФС-провайдеры, текстовое содержимое и watcher'ы расширений. */
    private readonly fileSystem: FileSystemCustomer;
    /** Корни каталогов хранения расширений; зовётся на каждой активации (см. `storageHomes`). */
    private readonly storageHomes: () => IExtensionStorageHomes;
    /** Хранилище memento расширений (`globalState` / `workspaceState`). */
    private readonly extensionState: IExtensionStateStore;
    /**
     * Воркспейс, в котором расширение активировано (корень его `storageUri`,
     * `null` — пустое окно). `workspaceState` расширения — словарь ЭТОГО
     * воркспейса: запись после смены папки протекла бы в чужой стор.
     */
    private readonly activationWorkspaces = new Map<string, string | null>();
    /** Доступ к дереву воркспейса для `workspaceContains:` (по умолчанию — настоящая ФС). */
    private readonly workspaceScanner: IWorkspaceScanner;
    /** Реестр языковых провайдеров субпроцесса (мост под `ILanguageFeaturesService`). */
    private readonly languageFeatures: LanguageFeaturesCustomer;
    public constructor(
        editorOptions: IEditorOptionsService,
        commandService: ICommandService,
        options: IExtensionHostOptions = {},
    ) {
        super();
        this.options = {
            spawnArgs: options.spawnArgs ?? defaultSpawnArgs,
            readyTimeoutMs: options.readyTimeoutMs ?? 5000,
            shutdownTimeoutMs: options.shutdownTimeoutMs ?? 1500,
            workspaceContainsTimeoutMs: options.workspaceContainsTimeoutMs ?? 7000,
        };
        this.logger = options.logger;
        this.rpcLogger = options.rpcLogger;
        this.stdoutLogger = options.stdoutLogger;
        this.stderrLogger = options.stderrLogger;
        this.configuration = options.configuration;
        this.notificationSink = options.notificationSink;
        this.decorations = this.register(
            new DecorationsCustomer(
                options.editorDecorations ?? NULL_EDITOR_DECORATIONS_SERVICE,
                options.fileDecorations ?? NULL_FILE_DECORATIONS_SERVICE,
                options.themeColorResolver ?? NULL_THEME_COLOR_RESOLVER,
            ),
        );
        const requestTimeouts: RequestTimeouts = { ...DEFAULT_REQUEST_TIMEOUTS, ...options.requestTimeouts };
        this.languageFeatures = this.register(
            new LanguageFeaturesCustomer(requestTimeouts, (uri) => this.documents.isSynced(uri), this.logger),
        );
        this.documents = new DocumentsCustomer({
            willSaveTimeoutMs: requestTimeouts["workspace.willSaveTextDocument"],
            openDocumentsProvider: options.openDocumentsProvider,
            maxSyncedDocumentChars: options.maxSyncedDocumentChars ?? MAX_SYNCED_DOCUMENT_CHARS,
            logger: this.logger,
        });
        this.editor = new EditorCustomer(editorOptions, options.editorLayout ?? NULL_EDITOR_LAYOUT_SERVICE);
        this.configurationCustomer =
            options.configuration === undefined ? undefined : new ConfigurationCustomer(options.configuration);
        this.commands = new CommandsCustomer(commandService, (event) => this.activateByEvent(event), this.logger);
        this.fileSystem = this.register(new FileSystemCustomer(options.fileWatcher ?? NULL_EXTENSION_FILE_WATCHER));
        this.storageHomes = options.storageHomes ?? fallbackExtensionStorageHomes;
        this.extensionState = options.extensionState ?? createTransientExtensionStateStore();
        this.workspaceScanner = options.workspaceScanner ?? createNodeWorkspaceScanner();
        this.customers = [
            new SecretsCustomer(options.secrets ?? createInMemoryExtensionSecretStore()),
            this.commands,
            new EnvCustomer(options.clipboard, options.externalOpener),
            this.fileSystem,
            this.decorations,
            this.editor,
            this.documents,
            this.languageFeatures,
            ...(this.configurationCustomer === undefined ? [] : [this.configurationCustomer]),
            new WindowCustomer({
                diagnosticsSink: options.diagnosticsSink,
                progressSink: options.progressSink,
                outputSink: options.outputSink,
                statusBarItemSink: options.statusBarItemSink,
                quickInputSink: options.quickInputSink,
                notificationSink: options.notificationSink,
            }),
        ];
    }

    /**
     * Запоминает регистрацию расширения (bookkeeping) — subprocess НЕ поднимается.
     * Реальная активация происходит лениво в {@link activateByEvent}, когда
     * наступает событие из `reg.activationEvents`. Заголовки команд регистрируем
     * сразу: команда расширения должна быть видна в палитре ещё до активации —
     * и, вместе с заголовком, заглушку-активатор на каждый `onCommand:<id>`
     * (см. `CommandsCustomer.arm`), иначе видимая команда была бы no-op.
     */
    public registerExtension(reg: IExtensionRegistration): IDisposable {
        if (this.hostDisposed) throw new Error("ExtensionHost disposed");
        if (this.phases.isRegistered(reg.id)) {
            throw new Error(`Extension "${reg.id}" already registered`);
        }
        // Инвариант загрузки: ровно один способ (source XOR mainPath). Проверяем
        // синхронно на регистрации (fail-fast) — subprocess (`parseActivateParams`)
        // держит ту же проверку как defense-in-depth.
        if ((reg.source !== undefined) === (reg.mainPath !== undefined)) {
            throw new Error(`Extension "${reg.id}": exactly one of "source" or "mainPath" must be set`);
        }
        this.logger?.debug(`registerExtension(${reg.id})`, {
            mainPath: reg.mainPath,
            activationEvents: readActivationEvents(reg),
        });
        // Заголовки команд из contributes.commands — нужны прокси-регистрации,
        // чтобы команда расширения показалась в палитре (см. commands.registerCommand).
        // Здесь же разворачиваем разметку значков: это точка, где текст
        // манифеста становится подписью НАШЕГО пункта палитры, а у эталона
        // подпись команды — метка quick pick'а, то есть значки в ней живые.
        this.commands.addPaletteMetadata(reg);
        this.phases.register(reg);
        // ПОСЛЕ pending: заглушка исполняется асинхронно и обязана найти
        // расширение в очереди, когда до неё дойдёт активация.
        for (const id of readCommandActivationIds(reg)) this.commands.arm(id);
        // Состав каталога изменился — субпроцессу это `extensions.onDidChange`.
        this.pushExtensionCatalog();
        // Событие расширения уже звучало (как `_activateAddedExtensionIfNeeded`
        // эталона) — встаёт сразу, а не ждёт повтора, которого может и не быть.
        const heard = readActivationEvents(reg).find((event) => this.requestedEvents.has(event));
        if (heard !== undefined) {
            void this.activateRegistrations([reg], heard).catch((err: unknown) => {
                // Stryker disable next-line OptionalChaining: логгер необязателен (у хоста в тестах его часто нет); без него сбой глотается, а мутант кинул бы внутри `.catch` — это только unhandled rejection, не наблюдаемое поведение хоста
                this.logger?.error(`failed to activate extension "${reg.id}" on registration`, err);
            });
        }
        return {
            dispose: (): void => {
                // Уже снято (например, через unregisterExtension) — полный
                // no-op: ни каталога, ни повторного deactivate.
                if (!this.phases.forget(reg.id)) return;
                this.pushExtensionCatalog();
                // Заглушки-активаторы снятого расширения: команды больше некому
                // поднимать, и в палитре им висеть не за что. Кроме тех, что
                // объявляет ещё кто-то: id бывает общим, и чужую дверь снятие
                // соседа захлопывать не должно.
                for (const id of readCommandActivationIds(reg)) {
                    if (!this.isCommandActivationClaimed(id)) this.commands.disarm(id);
                }
                if (this.phases.dropPending(reg.id)) return; // ещё не активировано (или ждёт оживления)
                // Осталась одна фаза — активное расширение; собственный гард
                // на это держит сам unregisterExtension, второго не надо.
                void this.unregisterExtension(reg.id);
            },
        };
    }

    /**
     * Запоминает установленное расширение без кода (декларативный языковой
     * пак, тема): в extension host'е его нет, но `extensionDependencies` на
     * него удовлетворены сразу — иначе зависимое не поднялось бы с ошибкой
     * «неизвестная зависимость».
     */
    public registerDeclarativeExtension(id: string): void {
        this.declarativeExtensions.add(extensionKey(id));
    }

    /**
     * Каталог `vscode.extensions` — всё, что хост знает установленным, плюс
     * отметка «активно». Расширения без `main` (декларативные языковые паки) в
     * него не попадают: у них нет кода, они не регистрируются в extension
     * host'е — и отсюда же берётся расхождение с эталоном, где `extensions.all`
     * перечисляет и их (см. docs/public/API-COVERAGE.md).
     */
    private extensionCatalog(): IWireExtensionCatalog {
        const extensions: IWireExtensionDescription[] = [];
        for (const reg of this.phases.all()) {
            extensions.push({
                id: reg.id,
                extensionPath: extensionRootPath(reg),
                packageJSON: reg.manifest,
                isActive: this.phases.isActive(reg.id),
            });
        }
        return { extensions };
    }

    /**
     * Шлёт субпроцессу состав каталога. Молча ничего не делает, пока субпроцесса
     * нет: каталог приедет семенем на его подъёме (`ensureSubprocess`), а
     * мёртвому досылать некому — та же логика, что у `pushActiveColorTheme`.
     */
    private pushExtensionCatalog(): void {
        this.rpc?.notify("extensions.catalog", this.extensionCatalog());
    }

    /**
     * Активирует все ещё не активные `pending`-расширения, чьи события активации
     * содержат `event`. Идемпотентно: уже активные пропускаются. `event === "*"`
     * матчит расширения с `"*"` в списке событий (пустой список ⇒ трактуется как
     * `["*"]`), а `onCommand:<id>` — ещё и расширения, объявившие эту команду в
     * `contributes.commands` без своего события (неявные события, см.
     * `readActivationEvents`). Именно здесь лениво поднимается subprocess и
     * уходит `host.activateExtension`.
     */
    public async activateByEvent(event: string): Promise<void> {
        this.requestedEvents.add(event);
        // Расширение события, которое уже поднимает другой вызов (регистрация
        // после события, соседнее стартовое событие), тоже дождаться: промис
        // `activateByEvent` значит «расширения этого события активны».
        const inFlight = [...this.activating.values()]
            .filter((activation) => readActivationEvents(activation.reg).includes(event))
            .map((activation) => activation.done);
        if (this.replayPending) {
            await Promise.all([this.replayJournal(event), ...inFlight]);
            return;
        }
        // Disposed-случай покрыт неявно: dispose() чистит `pending`, поэтому
        // набор окажется пустым и метод выйдет до ensureSubprocess.
        await Promise.all([this.activateRegistrations(this.pendingMatching([event]), event), ...inFlight]);
    }

    /** Ожидающие активации расширения, чьи события есть среди `events`. */
    private pendingMatching(events: readonly string[]): IExtensionRegistration[] {
        return this.phases
            .pendingRegistrations()
            .filter((reg) => readActivationEvents(reg).some((event) => events.includes(event)));
    }

    /**
     * Оживление после смерти субпроцесса: событие `reason`, каким бы оно ни
     * было, проигрывает весь журнал (он уже содержит и само событие), затем —
     * проход `workspaceContains:` (его повод в журнал не пишется).
     */
    private async replayJournal(reason: string): Promise<void> {
        this.replayPending = false;
        await this.activateRegistrations(this.pendingMatching([...this.requestedEvents]), reason);
        await this.activateByWorkspaceContains();
    }

    /**
     * Активирует расширения, чей `workspaceContains:<паттерн>` сошёлся с
     * содержимым открытых папок воркспейса. Считается ПО РАСШИРЕНИЮ, а не одним
     * событием на всех: паттерн — это аргумент события, и подошёл он конкретному
     * манифесту (так же устроен эталон — `checkActivateWorkspaceContainsExtension`).
     *
     * Зовётся на старте и повторно, когда папка воркспейса открывается позже:
     * активация ленивая, а событие «в воркспейсе появился pom.xml» иначе
     * прогорело бы в пустоту. Идемпотентно — уже активное расширение из
     * `pending` ушло, и второй обход его не касается.
     */
    public async activateByWorkspaceContains(): Promise<void> {
        // Проигрыш журнала сам заканчивается этим же проходом.
        if (this.replayPending) {
            await this.replayJournal("workspaceContains");
            return;
        }
        const candidates: { reg: IExtensionRegistration; patterns: IWorkspaceContainsPatterns }[] = [];
        for (const reg of this.phases.pendingRegistrations()) {
            const patterns = readWorkspaceContainsPatterns(reg);
            // Расширение без паттернов отсеиваем здесь, а не в обходе: обход и так
            // ответил бы «не совпало», но завёл бы на это таймер, а метод зовётся
            // на каждое открытие папки.
            // Stryker disable next-line ConditionalExpression: фильтр — оптимизация; пустой набор паттернов и так не совпадает (см. matchWorkspaceContains), наблюдаемой разницы нет
            if (hasWorkspaceContainsPatterns(patterns)) candidates.push({ reg, patterns });
        }
        const folders = this.workspaceFolderPaths();
        const matched: { reg: IExtensionRegistration; pattern: string }[] = [];
        for (const candidate of candidates) {
            const result = await this.matchWorkspaceContainsWithTimeout(candidate.reg.id, folders, candidate.patterns);
            if (result.pattern !== null) matched.push({ reg: candidate.reg, pattern: result.pattern });
        }
        // По одному: каждое расширение поднято своим паттерном, и в логе должна
        // стоять именно его причина.
        for (const hit of matched) {
            await this.activateRegistrations([hit.reg], `workspaceContains:${hit.pattern}`);
        }
    }

    /**
     * Обход дерева под один манифест с тайм-аутом. Тайм-аут именно здесь, а не на
     * весь метод: одно расширение с паттерном `**` не должно съесть окно у
     * соседей. Усечение (бюджет/тайм-аут) уходит в лог — молча оборванный обход
     * читался бы как «ничего не подошло».
     *
     * Тайм-аут — ГОНКА, а не только отмена токена: токен обход смотрит между
     * каталогами, и повисший `readdir` (сетевая ФС, отвалившийся том) флагом не
     * сдвинуть. Проигравший забег остаётся висеть — прибить чужой вызов ФС
     * нечем, — зато хост идёт дальше.
     */
    private async matchWorkspaceContainsWithTimeout(
        id: string,
        folders: readonly string[],
        patterns: IWorkspaceContainsPatterns,
    ): Promise<IWorkspaceContainsResult> {
        const source = new CancellationTokenSource();
        const timer = setTimeout(() => {
            source.cancel();
        }, this.options.workspaceContainsTimeoutMs);
        // Сканер обязан не бросать, но собственный контракт хоста прочнее чужой
        // дисциплины: одно расширение не срывает активацию остальных. Свой
        // `catch` у забега обязателен и потому, что проигравший в `Promise.race`
        // иначе уронил бы процесс через unhandledRejection.
        // Stryker disable next-line ObjectLiteral: токен здесь останавливает ФОНОВЫЙ обход после того, как гонку выиграл тайм-аут; вызывающий получает тот же ответ и без него — наблюдаемой разницы нет
        const scan = matchWorkspaceContains(this.workspaceScanner, folders, patterns, {
            token: source.token,
        }).catch((err: unknown): IWorkspaceContainsResult => {
            this.logger?.error(`workspaceContains scan for "${id}" failed`, err);
            return { pattern: null, truncated: true };
        });
        const cancelled = new Promise<IWorkspaceContainsResult>((resolve) => {
            source.token.onCancellationRequested(() => {
                resolve({ pattern: null, truncated: true });
            });
        });
        // Без `try/finally`: гонка двух обещаний, ни одно из которых не
        // отклоняется (у забега свой `catch`, а `cancelled` только резолвится),
        // поэтому единственный выход — ниже. Уборка идёт ДО лога: логгер —
        // чужой код, и его падение не должно оставить за собой живой таймер.
        const result = await Promise.race([scan, cancelled]);
        // Stryker disable next-line CallExpression: отыгравший таймер только будит `source.cancel()`, на который уже никто не подписан — наблюдаемой разницы нет
        clearTimeout(timer);
        // Stryker disable next-line CallExpression: снятие слушателей отменённого источника; ответ вызывающему уже сформирован — наблюдаемой разницы нет
        source.dispose();
        if (result.truncated) {
            this.logger?.warn(`workspaceContains scan for "${id}" was cut short`, {
                paths: patterns.paths,
                globs: patterns.globs,
            });
        }
        return result;
    }

    /**
     * Папки воркспейса как пути на ФС. `IWorkspaceFolderInfo.uri` — настоящий
     * uri (его же видит субпроцесс в `workspace.workspaceFolders`); не-`file:`
     * папки отбрасываем: обходить их нашим сканером нечем.
     */
    private workspaceFolderPaths(): readonly string[] {
        const paths: string[] = [];
        for (const folder of this.configuration?.getWorkspaceFolders() ?? []) {
            const uri = Uri.parse(folder.uri);
            if (uri.scheme === "file") paths.push(uri.fsPath);
        }
        return paths;
    }

    /**
     * Общий хвост активации: поднять subprocess и прогнать `host.activateExtension`
     * по набору регистраций. `reason` — что именно их подняло; идёт в лог и
     * больше никуда (расширение о поводе своей активации не узнаёт, как и в
     * эталоне).
     */
    private async activateRegistrations(toActivate: readonly IExtensionRegistration[], reason: string): Promise<void> {
        if (toActivate.length === 0) return;
        // Спавним subprocess ОДИН раз до активации: сбой хоста (spawn/ready) — это не
        // проблема конкретного расширения, он пробрасывается наверх.
        const rpc = await this.ensureSubprocess();
        // Набор активируется параллельно (как `_activateExtensions` эталона): соседи
        // по событию не ждут друг друга — стоковый LSP-клиент, поднимающий сервер
        // секундами прямо в `activate()`, иначе держал бы всех за собой.
        await Promise.all(toActivate.map((reg) => this.activateRegistration(rpc, reg, reason)));
    }

    private activateRegistration(rpc: HostRpc, reg: IExtensionRegistration, reason: string): Promise<void> {
        // Guard на случай, если параллельная активация уже занялась им: тот
        // вызов и дождётся (см. `activating`).
        if (!this.phases.takePending(reg.id)) return this.activating.get(reg.id)?.done ?? Promise.resolve();
        // Stryker disable next-line BlockStatement: гигиена — ждать завершённую (уже резолвленную) активацию мгновенно, а заново она встаёт в карту поверх старой записи; наблюдаемой разницы нет
        const done = this.activateAfterDependencies(rpc, reg, reason).finally(() => {
            // Stryker disable next-line CallExpression: см. выше
            this.activating.delete(reg.id);
        });
        this.activating.set(reg.id, { reg, done });
        return done;
    }

    /**
     * Зависимости — раньше зависимого (как `_handleActivationRequest` эталона):
     * расширение в `activate()` вправе звать `extensions.getExtension(dep)` и
     * читать его `exports`, поэтому к этому моменту они обязаны быть активны.
     * Не вышло — зависимое НЕ активируется (эталон делает его
     * `FailedExtension`): причина в лог, а неизвестная зависимость ещё и
     * тостом. Оживить его может только перезагрузка окна, как и у эталона.
     */
    private async activateAfterDependencies(rpc: HostRpc, reg: IExtensionRegistration, reason: string): Promise<void> {
        const outcome = await this.activateDependencies(rpc, reg, reason);
        if (outcome === "ready") {
            await this.requestActivation(rpc, reg, reason);
            return;
        }
        if (outcome === "interrupted") {
            // Субпроцесс умер, пока поднимались зависимости: зависимое не
            // виновато — к оживлению вместе с ними (если его не сняли).
            if (this.phases.returnInterrupted(reg)) {
                // Stryker disable next-line OptionalChaining: логгер необязателен (у хоста в тестах его часто нет); сценарий смерти субпроцесса проверяется с логгером, а без него строка просто не пишется
                this.logger?.warn(`activation of "${reg.id}" interrupted by extension host death — will retry`);
            }
            return;
        }
        // Stryker disable next-line OptionalChaining: см. выше — без логгера причина не пишется, наблюдаемое (зависимое не активно) проверено с ним
        this.logger?.error(outcome.message);
        if (outcome.notify) this.notifyHuman(outcome.message);
    }

    /**
     * Поднимает `extensionDependencies` регистрации и говорит, можно ли
     * активировать её саму. Зависимость ожидающая — активируется с причиной
     * «зависимость такого-то», уже поднимающаяся — дожидается, активная — сразу
     * годится, без кода (декларативная) — годится без активации.
     */
    private async activateDependencies(
        rpc: HostRpc,
        reg: IExtensionRegistration,
        reason: string,
    ): Promise<"ready" | "interrupted" | { readonly message: string; readonly notify: boolean }> {
        const deps = readExtensionDependencies(reg.manifest);
        // Stryker disable next-line ConditionalExpression: быстрый путь — без зависимостей проход ниже тоже дал бы "ready" (цикла нет, ждать нечего), только на лишний тик позже
        if (deps.length === 0) return "ready";
        const name = friendlyName(reg);
        const loop = findDependencyLoop(reg.id, (key) => {
            const known = this.findRegistration(key);
            return known === undefined ? undefined : readExtensionDependencies(known.manifest);
        });
        if (loop !== null) {
            return {
                message: `Cannot activate the '${name}' extension because of a dependency loop: ${loop.join(" -> ")}`,
                notify: false,
            };
        }
        const found: IExtensionRegistration[] = [];
        for (const dep of deps) {
            const known = this.findRegistration(extensionKey(dep));
            if (known !== undefined) {
                found.push(known);
                continue;
            }
            if (this.declarativeExtensions.has(extensionKey(dep))) continue;
            return {
                message: `Cannot activate the '${name}' extension because it depends on unknown extension '${dep}'`,
                notify: true,
            };
        }
        // `activateRegistration` сам разбирает фазу: ожидающую поднимет,
        // поднимающуюся дождётся, активную или уже упавшую — пропустит.
        await Promise.all(
            found.map((dep) => this.activateRegistration(rpc, dep, `dependency of ${reg.id}, ${reason}`)),
        );
        if (rpc !== this.rpc) return "interrupted";
        const failed = found.find((dep) => !this.phases.isActive(dep.id));
        if (failed !== undefined) {
            return {
                message: `Cannot activate the '${name}' extension because its dependency '${friendlyName(failed)}' failed to activate`,
                notify: false,
            };
        }
        return "ready";
    }

    /** Известная хосту регистрация по ключу id (регистр не важен). */
    private findRegistration(key: string): IExtensionRegistration | undefined {
        for (const reg of this.phases.all()) {
            if (extensionKey(reg.id) === key) return reg;
        }
        return undefined;
    }

    /** Тост ошибки от самого хоста (не от расширения); ответ не ждём. */
    private notifyHuman(message: string): void {
        // Stryker disable next-line UpdateOperator: от счётчика нужна только уникальность адреса, направление шага ненаблюдаемо
        const handle = this.nextHostMessageHandle--;
        void this.notificationSink
            ?.showMessage({ severity: "error", message, modal: false, items: [], handle })
            .catch((error: unknown) => {
                // Stryker disable next-line OptionalChaining: без логгера отказ стока глотается; мутант бросил бы внутри `.catch` — это только unhandled rejection, не наблюдаемое поведение хоста
                this.logger?.error(`showMessage failed: ${String(error)}`);
            });
    }

    private async requestActivation(rpc: HostRpc, reg: IExtensionRegistration, reason: string): Promise<void> {
        // Per-extension изоляция: упавший `activate()` одного расширения не
        // блокирует активацию остальных и не роняет bootstrap (как в VS Code).
        const storage = this.resolveStoragePaths(reg.id);
        this.activationWorkspaces.set(reg.id, this.storageHomes().workspaceStorageHome);
        try {
            await rpc.request("host.activateExtension", {
                id: reg.id,
                mainPath: reg.mainPath,
                source: reg.source,
                filename: reg.filename,
                // `"type"` из package.json расширения — им субпроцесс решает,
                // грузить точку входа как CJS или как ESM (`isEsmEntry`).
                // Едет как есть: нормализует его ОДНА сторона — та, что
                // разбирает параметры (`parseActivateParams`).
                moduleType: reg.manifest.type,
                extensionPath: reg.extensionPath,
                globalStoragePath: storage.globalStoragePath,
                storagePath: storage.storagePath,
                logPath: storage.logPath,
                // Memento с прошлых запусков — сразу в параметрах: `get` у
                // расширения синхронный, ждать отдельного round-trip ему нечем.
                globalState: this.extensionState.get(reg.id, true),
                workspaceState: this.extensionState.get(reg.id, false),
            });
            this.phases.markActive(reg);
            // Точечно, а не целым каталогом: манифесты тяжёлые (у языковых
            // серверов package.json со схемой настроек — сотни килобайт), а
            // меняется здесь ровно один флаг.
            rpc.notify("extensions.activated", { id: reg.id });
        } catch (err) {
            // Субпроцесс умер, пока шла активация: запрос оборван вместе с его
            // каналом. Расширение тут ни при чём — возвращаем его к оживлению
            // вместе с остальными активными (если его за это время не сняли).
            if (rpc !== this.rpc && this.phases.returnInterrupted(reg)) {
                this.logger?.warn(`activation of "${reg.id}" interrupted by extension host death — will retry`);
                return;
            }
            this.logger?.error(`failed to activate extension "${reg.id}"`, err);
            return;
        }
        // Запись об успехе — ВНЕ try: этот `catch` про сбой активации, и
        // беда логгера не должна прикидываться им (а заодно тихо глотаться).
        this.logger?.info(`activated extension "${reg.id}" (${reason})`);
    }

    /** Объявляет ли команду `id` хоть одна из оставшихся регистраций. */
    private isCommandActivationClaimed(id: string): boolean {
        for (const reg of this.phases.all()) {
            if (readCommandActivationIds(reg).includes(id)) return true;
        }
        return false;
    }

    /**
     * Каталоги хранения одного расширения + создание их родителей (контракт
     * vscode.d.ts: «the parent directory is guaranteed to be existent»). Зовётся
     * на каждой активации, чтобы `storageUri` брал АКТУАЛЬНУЮ папку воркспейса:
     * расширение может активироваться и до, и после её открытия.
     */
    private resolveStoragePaths(id: string): {
        globalStoragePath: string;
        storagePath: string | null;
        logPath: string;
    } {
        const homes = this.storageHomes();
        ensureExtensionStorageParents(homes, (dir, err) => {
            this.logger?.warn(`failed to create extension storage dir "${dir}"`, err);
        });
        return resolveExtensionStoragePaths(homes, id);
    }

    public async unregisterExtension(id: string): Promise<void> {
        if (!this.phases.deactivate(id)) return;
        // Каталог трогаем только если запись и правда ушла: снятие может
        // прийти вторым заходом (сначала disposable регистрации), и лишнего
        // `extensions.catalog` субпроцессу слать не за что.
        if (this.phases.forget(id)) this.pushExtensionCatalog();
        const rpc = this.rpc;
        /* v8 ignore start -- defensive: an extension can only be in `extensions` after ensureSubprocess set `rpc`; dispose() clears `extensions` before nulling `rpc`, so rpc is never null while the id is still registered */
        if (rpc === null) return;
        /* v8 ignore stop */
        try {
            await rpc.request("host.deactivateExtension", { id });
            this.logger?.info(`deactivated extension "${id}"`);
        } catch (err) {
            // subprocess мог уже умереть — игнорируем.
            this.logger?.debug(`deactivateExtension(${id}) ignored`, err);
        }
    }

    /**
     * Правки will-save от участников субпроцесса (`onWillSaveTextDocument`);
     * подключается в `EditorService.saveParticipant` (wiring в module/харнессе).
     */
    public willSaveTextDocument(snapshot: ISaveSnapshot): Promise<readonly ISaveEdit[]> {
        return this.documents.willSaveTextDocument(snapshot);
    }

    /** Состоявшееся сохранение (`onDidSaveTextDocument`). */
    public didSaveTextDocument(meta: { uri: string; languageId: string }): void {
        this.documents.didSaveTextDocument(meta);
    }

    public didOpenTextDocument(snapshot: IWireDocumentSyncSnapshot): void {
        this.documents.didOpenTextDocument(snapshot);
    }

    public didChangeTextDocument(snapshot: IWireDocumentSyncSnapshot): void {
        this.documents.didChangeTextDocument(snapshot);
    }

    public didChangeTextDocumentContent(event: IWireDocumentChangedEvent): void {
        this.documents.didChangeTextDocumentContent(event);
    }

    public didCloseTextDocument(uri: string): void {
        this.documents.didCloseTextDocument(uri);
    }

    // ─── Языковые фичи (см. LanguageFeaturesCustomer) ──────────────────────────

    public provideCompletionItems(
        handle: number,
        req: ICompletionRequest,
        token?: ICancellationToken,
    ): Promise<ICoreCompletionResult> {
        return this.languageFeatures.provideCompletionItems(handle, req, token);
    }

    public resolveCompletionItem(id: string): Promise<ICoreResolvedCompletion | null> {
        return this.languageFeatures.resolveCompletionItem(id);
    }

    public provideInlineCompletions(
        handle: number,
        req: IInlineCompletionRequest,
        token: ICancellationToken = CancellationTokenNone,
    ): Promise<readonly ICoreInlineCompletionItem[]> {
        return this.languageFeatures.provideInlineCompletions(handle, req, token);
    }

    public provideFoldingRanges(
        handle: number,
        req: IFoldingRequest,
        token?: ICancellationToken,
    ): Promise<readonly IFoldingRegion[]> {
        return this.languageFeatures.provideFoldingRanges(handle, req, token);
    }

    public provideDefinition(
        handle: number,
        req: IDefinitionRequest,
        token?: ICancellationToken,
    ): Promise<readonly ICoreDefinitionLocation[]> {
        return this.languageFeatures.provideDefinition(handle, req, token);
    }

    public provideHover(
        handle: number,
        req: IHoverRequest,
        token?: ICancellationToken,
    ): Promise<ICoreHover | undefined> {
        return this.languageFeatures.provideHover(handle, req, token);
    }

    public provideReferences(
        handle: number,
        req: IReferenceRequest,
        token?: ICancellationToken,
    ): Promise<readonly ICoreReference[]> {
        return this.languageFeatures.provideReferences(handle, req, token);
    }

    public provideSignatureHelp(
        handle: number,
        req: ISignatureHelpRequest,
        token?: ICancellationToken,
    ): Promise<ICoreSignatureHelp | null> {
        return this.languageFeatures.provideSignatureHelp(handle, req, token);
    }

    public provideFormattingEdits(
        handle: number,
        req: IFormattingRequest,
        token?: ICancellationToken,
    ): Promise<readonly ITextEdit[]> {
        return this.languageFeatures.provideFormattingEdits(handle, req, token);
    }

    public provideCodeActions(
        handle: number,
        req: ICodeActionRequest,
        token?: ICancellationToken,
    ): Promise<readonly ICoreCodeAction[]> {
        return this.languageFeatures.provideCodeActions(handle, req, token);
    }

    public applyCodeAction(id: string): Promise<boolean> {
        return this.languageFeatures.applyCodeAction(id);
    }

    public prepareRename(handle: number, req: IRenameRequest): Promise<ICoreRenameLocation | null> {
        return this.languageFeatures.prepareRename(handle, req);
    }

    public provideRenameEdits(handle: number, req: IRenameRequest, newName: string): Promise<ICoreRenameResult> {
        return this.languageFeatures.provideRenameEdits(handle, req, newName);
    }

    // ─── Языковые провайдеры (мост под ILanguageFeaturesService) ──────────────

    /**
     * Языковые провайдеры, объявленные субпроцессом (`languages.register`).
     * Потребитель — адаптер, регистрирующий их прокси в реестре ядра.
     */
    public getLanguageProviders(): readonly IWireLanguageProviderRegistration[] {
        return this.languageFeatures.getProviders();
    }

    /** Состав провайдеров изменился: регистрация, снятие или смерть субпроцесса. */
    public get onLanguageProvidersChanged(): Event<void> {
        return this.languageFeatures.onProvidersChanged;
    }

    // ─── Провайдеры ФС и содержимого расширений (см. FileSystemCustomer) ──────

    /**
     * Схемы, для которых субпроцесс держит `FileSystemProvider`. Потребитель —
     * адаптер, регистрирующий хост поставщиком этих схем в реестре ядра.
     */
    public getFileSystemSchemes(): readonly string[] {
        return this.fileSystem.getFileSystemSchemes();
    }

    /** Набор схем изменился (расширение зарегистрировало/сняло провайдера). */
    public get onFileSystemProvidersChanged(): Event<void> {
        return this.fileSystem.onFileSystemProvidersChanged;
    }

    /** Читает недисковый ресурс провайдером субпроцесса (см. FileSystemCustomer). */
    public readProvidedFile(uri: Uri): Promise<Uint8Array> {
        return this.fileSystem.readProvidedFile(uri);
    }

    /** Содержимое ресурсов провайдера изменилось снаружи. */
    public get onDidChangeProvidedFile(): Event<readonly Uri[]> {
        return this.fileSystem.onDidChangeProvidedFile;
    }

    /** Держит ли субпроцесс `TextDocumentContentProvider` для схемы. */
    public hasTextContentProvider(scheme: string): boolean {
        return this.fileSystem.hasTextContentProvider(scheme);
    }

    /** Содержимое недискового ресурса от провайдера субпроцесса (см. FileSystemCustomer). */
    public provideTextDocumentContent(uri: Uri): Promise<string | null> {
        return this.fileSystem.provideTextDocumentContent(uri);
    }

    /** Провайдер объявил, что содержимое недискового ресурса изменилось. */
    public get onDidChangeTextContent(): Event<Uri> {
        return this.fileSystem.onDidChangeTextContent;
    }

    public hasExtension(id: string): boolean {
        return this.phases.isActive(id);
    }

    public get extensionCount(): number {
        return this.phases.activeCount;
    }

    public override dispose(): void {
        if (this.hostDisposed) return;
        this.hostDisposed = true;
        this.phases.clear();
        // Заглушки-активаторы живут в ОБЩЕМ реестре команд ядра (как и
        // прокси, см. CommandsCustomer) — после dispose там висели бы записи,
        // которые уже некого поднимать.
        this.commands.disarmAll();
        this.shutdownDone = this.shutdownSubprocess();
        super.dispose();
    }

    /**
     * Вежливое прощание с ожиданием: `deactivate()` расширений в субпроцессе,
     * затем его выход (с эскалацией до сигналов, см. {@link dispose}).
     * Повторный вызов отдаёт то же прощание.
     */
    public shutdown(): Promise<void> {
        this.dispose();
        return this.shutdownDone;
    }

    /**
     * Снимает host там, где event loop дальше не крутится — при перезагрузке
     * окна сразу за этим идёт синхронный запуск нового процесса. Если вежливое
     * прощание ({@link shutdown}) не начиналось или не успело довести субпроцесс
     * до выхода, он снимается сигналом, синхронно: иначе остался бы сиротой у
     * заблокированного родителя. Субпроцесс, уже вышедший по-хорошему, не трогается.
     */
    public disposeNow(): void {
        this.dispose();
        this.exitingProcess?.kill();
    }

    /**
     * Ленивая инициализация subprocess'а. Идемпотентна — параллельные вызовы
     * получают одну и ту же `readyPromise`.
     */
    private async ensureSubprocess(): Promise<HostRpc> {
        if (this.rpc !== null && this.readyPromise !== null) {
            await this.readyPromise;
            return this.rpc;
        }
        const subprocess = new ExtensionHostProcess(
            {
                spawnArgs: this.options.spawnArgs,
                logger: this.logger,
                rpcLogger: this.rpcLogger,
                stdoutLogger: this.stdoutLogger,
                stderrLogger: this.stderrLogger,
            },
            () => {
                this.handleSubprocessDeath(subprocess);
            },
        );
        const rpc = subprocess.rpc;
        this.installHostHandlers(rpc);

        this.process = subprocess;
        this.rpc = rpc;

        this.readyPromise = subprocess.waitForReady(this.options.readyTimeoutMs).then(() => {
            this.logger?.info("extension host ready");
            // Push конфигурацию ДО стартового active-editor и первого
            // activateExtension: расширение читает getConfiguration уже в activate().
            this.configurationCustomer?.pushInitialState();
            // Полоса групп, затем мета активного редактора — до первой активации.
            this.editor.pushInitialState();
            // Активная тема — тоже ДО первой активации: расширение читает
            // `window.activeColorTheme` уже в `activate()` (так делают все,
            // кто подбирает иконки/цвета под светлую и тёмную).
            this.decorations.pushActiveColorTheme();
            // Каталог расширений — тоже ДО первой активации: `getExtension`
            // зовут прямо в `activate()`, детектя соседей (так делают все
            // AI-автодополнения). На оживлении после смерти субпроцесса это же
            // семя возвращает новому субпроцессу и состав, и флаги активности.
            rpc.notify("extensions.catalog", this.extensionCatalog());
            // Открытые документы — ДО первой активации: стоковый
            // vscode-languageclient читает `workspace.textDocuments` на start().
            this.documents.pushInitialState();
        });
        await this.readyPromise;
        return rpc;
    }

    private installHostHandlers(rpc: HostRpc): void {
        const spawnStore = this.spawnStore;
        // Поверхности, вынесенные в customers: их состояние спавна живёт в
        // attach и уходит вместе со spawnStore.
        for (const customer of this.customers) spawnStore.add(customer.attach({ rpc, logger: this.logger }));
        this.installMementoHandlers(rpc);
    }

    /**
     * `ExtensionContext.globalState` / `workspaceState`: субпроцесс держит
     * словарь у себя (синхронные `get`/`keys`), а каждый `update` присылает его
     * сюда целиком. Запись `workspaceState` из воркспейса, отличного от того, в
     * котором расширение активировано, отбрасывается с предупреждением: иначе
     * словарь воркспейса A протёк бы в стор B (честное лечение — перезапуск
     * хоста при смене папки, как reload окна у vscode).
     */
    private installMementoHandlers(rpc: HostRpc): void {
        rpc.handleRequest("memento.update", (params): null => {
            const update = parseWireMementoUpdate(params);
            if (update === null) throw new Error("memento.update: malformed params");
            const { extensionId, shared, value } = update;
            if (!shared && this.activationWorkspaces.get(extensionId) !== this.storageHomes().workspaceStorageHome) {
                this.logger?.warn(
                    `memento.update: "${extensionId}" activated in another workspace — workspaceState write dropped`,
                );
                return null;
            }
            this.extensionState.set(extensionId, shared, value);
            return null;
        });
    }

    /**
     * Конец спавна: customers отцепляются — всё, что субпроцесс держал (спиннеры,
     * пункты полосы, декорации, прокси-команды, провайдеры, watcher'ы, подписки
     * на ядро), уходит вместе со `spawnStore`, — а хост забывает канал и процесс.
     * Общий для вежливого выключения ({@link shutdownSubprocess}) и для
     * внезапной смерти ({@link handleSubprocessDeath}).
     */
    private endSpawn(): void {
        this.spawnStore.dispose();
        this.spawnStore = new DisposableStore();
        this.rpc = null;
        this.process = null;
        this.readyPromise = null;
    }

    /**
     * Субпроцесс умер сам (расширение уронило свой процесс, OOM, краш нативного
     * модуля). Хост остаётся жив: снимаем всё, что принадлежало умершему, и
     * ставим активные расширения в очередь на оживление — следующий
     * `activateByEvent` поднимет субпроцесс заново и активирует их. Без этого
     * пункты статус-бара и прокси-команды мертвеца висели бы до перезапуска
     * редактора, а `rpc` указывал бы на закрытый канал.
     */
    private handleSubprocessDeath(subprocess: ExtensionHostProcess): void {
        // Вежливое выключение уже обнулило `process` — там всё сделано.
        if (this.process !== subprocess) return;
        this.logger?.warn("extension host subprocess died — resetting host state");
        this.endSpawn();
        // Канал мертвеца закрываем: запросы в полёте (прежде всего
        // `host.activateExtension`) получают отказ, а не висят вечно, — и
        // оборванная активация возвращается к оживлению (см. requestActivation).
        subprocess.dispose();
        // Активные возвращаются в `pending` и оживут на ЛЮБОМ следующем событии
        // активации — оно проиграет журнал (см. `requestedEvents`).
        const revived = this.phases.reviveAll();
        this.replayPending = true;
        // Прокси-команды мертвеца сняты вместе с его спавном (`CommandsCustomer`) —
        // возвращаем на их место заглушки-активаторы. Иначе команда исчезла бы и
        // из палитры, и вместе с ней единственный способ оживить расширение
        // руками: оживление ждёт события активации, а команда им и была.
        for (const reg of revived) {
            for (const id of readCommandActivationIds(reg)) this.commands.arm(id);
        }
    }

    private async shutdownSubprocess(): Promise<void> {
        const rpc = this.rpc;
        const subprocess = this.process;
        this.endSpawn();
        if (subprocess === null) {
            // Канал без субпроцесса — только у in-process тестов, подключающих
            // RPC руками; закрываем и его.
            rpc?.dispose();
            return;
        }
        this.exitingProcess = subprocess;
        await subprocess.shutdown(this.options.shutdownTimeoutMs);
        this.exitingProcess = null;
    }
}
