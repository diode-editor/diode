import {
    CancellationTokenNone,
    CancellationTokenSource,
    type ICancellationToken,
} from "../../../../base/common/cancellation.ts";
import { type Event } from "../../../../base/common/event.ts";
import { Disposable, DisposableStore, type IDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type {
    IApplyCodeActionOptions,
    ICodeActionRequest,
    ICoreCodeAction,
} from "../../../../editor/common/languages/iCodeActionSource.ts";
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
import {
    type ILanguageConfigurationService,
    NULL_LANGUAGE_CONFIGURATION_SERVICE,
} from "../../../../editor/common/languages/iLanguageConfigurationService.ts";
import type { ICoreReference, IReferenceRequest } from "../../../../editor/common/languages/iReferenceSource.ts";
import type {
    ICoreRenameLocation,
    ICoreRenameResult,
    IRenameRequest,
} from "../../../../editor/common/languages/iRenameSource.ts";
import type { ISelectionRangeRequest } from "../../../../editor/common/languages/iSelectionRangeSource.ts";
import type {
    IRangeSemanticTokensRequest,
    ISemanticTokens,
    ISemanticTokensEdits,
    ISemanticTokensRequest,
} from "../../../../editor/common/languages/iSemanticTokensSource.ts";
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
    isBuiltinVSCodeExtension,
    readExtensionDependencies,
} from "../../../../platform/extensions/common/extensionDependencies.ts";
import type { IStat } from "../../../../platform/files/common/files.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { IEnvironmentVariableCollectionStore } from "../../../../platform/terminal/common/environmentVariable.ts";
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
import type { IExtensionTaskSink } from "../../../api/common/iExtensionTaskSink.ts";
import type {
    DiagnosticsSink,
    IExtensionTerminalSink,
    IFileDialogSink,
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
import type { IWorkspaceFoldersSink } from "../../../api/common/iWorkspaceFoldersSink.ts";
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
import type { IExtensionUriHandlers } from "../common/extensionUrlHandler.ts";

import { CommandsCustomer } from "./customers/commandsCustomer.ts";
import { ConfigurationCustomer } from "./customers/configurationCustomer.ts";
import { DecorationsCustomer } from "./customers/decorationsCustomer.ts";
import { DiagnosticsCustomer, type IMarkerReader } from "./customers/diagnosticsCustomer.ts";
import { DocumentsCustomer, MAX_SYNCED_DOCUMENT_CHARS } from "./customers/documentsCustomer.ts";
import { EditorCustomer } from "./customers/editorCustomer.ts";
import {
    EnvCustomer,
    fallbackExtensionHostEnvironment,
    type IExtensionHostEnvironment,
} from "./customers/envCustomer.ts";
import {
    createInMemoryEnvironmentVariableCollectionStore,
    EnvironmentVariableCollectionsCustomer,
} from "./customers/environmentVariableCollectionsCustomer.ts";
import { FileSystemCustomer } from "./customers/fileSystemCustomer.ts";
import { LanguageConfigurationCustomer } from "./customers/languageConfigurationCustomer.ts";
import { LanguageFeaturesCustomer } from "./customers/languageFeaturesCustomer.ts";
import { SecretsCustomer } from "./customers/secretsCustomer.ts";
import { TasksCustomer } from "./customers/tasksCustomer.ts";
import { TerminalCustomer } from "./customers/terminalCustomer.ts";
import { UriHandlersCustomer } from "./customers/uriHandlersCustomer.ts";
import { WindowCustomer } from "./customers/windowCustomer.ts";
import { WorkspaceFoldersCustomer } from "./customers/workspaceFoldersCustomer.ts";
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

export interface IWorkspaceFolderInfo {
    /** `uri.toString()`, а не путь ФС. */
    readonly uri: string;
    readonly name: string;
    readonly index: number;
}

/** Push-модель: `getConfiguration().get()` у расширений синхронный, RPC на каждый get невозможен. */
export interface IExtensionHostConfigProvider {
    /** Субпроцесс сливает слои той же моделью — своего defaults-слоя у него нет. */
    getSnapshot(): IConfigurationData;
    getWorkspaceFolders(): readonly IWorkspaceFolderInfo[];
    /** `undefined` — папка открыта напрямую или окно пустое. */
    getWorkspaceFile(): string | undefined;
    onDidChange(cb: (affectedKeys: readonly string[]) => void): IDisposable;
    /** К резолву промиса {@link onDidChange} уже отстрелял новым значением. */
    updateValue(key: string, value: unknown, target: ConfigurationTarget): Promise<void>;
    getConfigurationScopes(): ReadonlyMap<string, ConfigurationScope>;
}

export interface IExtensionHostOptions {
    readonly spawnArgs?: () => { command: string; args: string[]; env?: NodeJS.ProcessEnv };
    /** Мс; 60000 — как `LocalProcessExtensionHost._performHandshake` эталона: опоздание списывает хост до перезапуска. */
    readonly readyTimeoutMs?: number;
    readonly shutdownTimeoutMs?: number;
    readonly logger?: ILogger;
    readonly rpcLogger?: ILogger;
    /** Без него stdout закрыт (`"ignore"`): наследовать нельзя — терминал общий с редактором, печать попала бы в кадр. */
    readonly stdoutLogger?: ILogger;
    readonly stderrLogger?: ILogger;
    readonly configuration?: IExtensionHostConfigProvider;
    readonly editorDecorations?: IEditorDecorationsService;
    readonly fileDecorations?: IFileDecorationsService;
    readonly themeColorResolver?: IThemeColorResolver;
    readonly diagnosticsSink?: DiagnosticsSink;
    readonly markers?: IMarkerReader;
    readonly languageConfigurations?: Pick<ILanguageConfigurationService, "register">;
    /** При смерти субпроцесса хост сам шлёт `end` всем живым handle'ам. */
    readonly progressSink?: IProgressSink;
    readonly outputSink?: IOutputSink;
    /** При смерти субпроцесса хост сам зовёт `clear()`: `dispose` от умершего расширения не придёт. */
    readonly statusBarItemSink?: IStatusBarItemSink;
    /** При смерти субпроцесса хост сам гасит живые показы — оверлей не остаётся без хозяина. */
    readonly quickInputSink?: IQuickInputSink;
    /** Им же хост сам сообщает о неизвестной зависимости — как тост `unknownDep` эталона. */
    readonly notificationSink?: INotificationSink;
    readonly fileDialogSink?: IFileDialogSink;
    readonly workspaceFoldersSink?: IWorkspaceFoldersSink;
    readonly terminalSink?: IExtensionTerminalSink;
    readonly environmentVariableCollections?: IEnvironmentVariableCollectionStore;
    readonly taskSink?: IExtensionTaskSink;
    readonly clipboard?: IClipboard;
    readonly externalOpener?: IExternalOpener;
    readonly environment?: IExtensionHostEnvironment;
    /** Пушатся на `host.ready` до первой активации: стоковый vscode-languageclient читает реестр на `start()`. */
    readonly openDocumentsProvider?: () => IWireDocumentSyncSnapshot[];
    readonly fileWatcher?: IExtensionFileWatcher;
    readonly editorLayout?: IEditorLayoutService;
    /** Читается на каждой активации: папка воркспейса известна позже создания хоста, а `storageUri` зависит от неё. */
    readonly storageHomes?: () => IExtensionStorageHomes;
    readonly secrets?: IExtensionSecretStore;
    readonly extensionState?: IExtensionStateStore;
    readonly workspaceScanner?: IWorkspaceScanner;
    /** Мс; по истечении расширение остаётся неактивным — как `WORKSPACE_CONTAINS_TIMEOUT` эталона. */
    readonly workspaceContainsTimeoutMs?: number;
    /** Истёкший срок отменяет запрос и даёт пустой результат. */
    readonly requestTimeouts?: Partial<RequestTimeouts>;
    /** В символах; документ больше для расширений не существует (ни зеркала, ни провайдеров, ни will-save). */
    readonly maxSyncedDocumentChars?: number;
}

function friendlyName(reg: IExtensionRegistration): string {
    return extensionFriendlyName(reg.id, reg.manifest);
}

/** Subprocess — тот же бинарь с `DIODE_EXTENSION_HOST=1`: ранняя ветка `main.ts` уводит в `runExtensionHostSubprocess()`. */
export class ExtensionHost extends Disposable implements IDocumentSyncTarget {
    private readonly options: Required<
        Pick<IExtensionHostOptions, "spawnArgs" | "readyTimeoutMs" | "shutdownTimeoutMs" | "workspaceContainsTimeoutMs">
    >;
    private readonly logger: ILogger | undefined;
    private readonly rpcLogger: ILogger | undefined;
    private readonly stdoutLogger: ILogger | undefined;
    private readonly stderrLogger: ILogger | undefined;
    private readonly configuration: IExtensionHostConfigProvider | undefined;
    private readonly decorations: DecorationsCustomer;
    private readonly phases = new ExtensionPhases();
    /**
     * Как `_allRequestedActivateEvents` эталона: пишется всегда, даже без подходящих расширений, — по нему встают
     * зарегистрированные после своего события и оживают пережившие смерть субпроцесса. `workspaceContains:` не
     * пишется: его повод считается по ФС.
     */
    private readonly requestedEvents = new Set<string>();
    /** Оживление — лениво, на следующем событии, а не сразу при смерти: краш-петлю не устраиваем. */
    private replayPending = false;
    /** Ключи расширений без `main`: зависимость на них удовлетворена (как `_isResolvedExtension` эталона). */
    private readonly declarativeExtensions = new Set<string>();
    private readonly notificationSink: INotificationSink | undefined;
    /** Отрицательные: не пересекаются с handle'ами `window.show*Message` субпроцесса (те растут от 1). */
    private nextHostMessageHandle = -1;
    /** Их ждут и соседние вызовы. */
    private readonly activating = new Map<string, { reg: IExtensionRegistration; done: Promise<void> }>();
    private process: ExtensionHostProcess | null = null;
    private rpc: HostRpc | null = null;
    private readyPromise: Promise<void> | null = null;
    /** Пересоздаётся на каждый спавн: иначе респавны копили бы слушателей, шлющих в мёртвый канал. */
    private spawnStore = new DisposableStore();
    private readonly customers: readonly IExtensionHostCustomer[];
    private hostDisposed = false;
    private shutdownDone: Promise<void> = Promise.resolve();
    private exitingProcess: ExtensionHostProcess | null = null;
    private readonly documents: DocumentsCustomer;
    private readonly editor: EditorCustomer;
    private readonly configurationCustomer: ConfigurationCustomer | undefined;
    private readonly commands: CommandsCustomer;
    private readonly terminals: TerminalCustomer;
    private readonly environmentVariableCollections: EnvironmentVariableCollectionsCustomer;
    private readonly env: EnvCustomer;
    private readonly diagnostics: DiagnosticsCustomer;
    private readonly fileSystem: FileSystemCustomer;
    private readonly uriHandlersCustomer: UriHandlersCustomer;
    private readonly storageHomes: () => IExtensionStorageHomes;
    private readonly extensionState: IExtensionStateStore;
    /** `workspaceState` — словарь ЭТОГО воркспейса: запись после смены папки протекла бы в чужой стор. */
    private readonly activationWorkspaces = new Map<string, string | null>();
    private readonly workspaceScanner: IWorkspaceScanner;
    private readonly languageFeatures: LanguageFeaturesCustomer;
    public constructor(
        editorOptions: IEditorOptionsService,
        commandService: ICommandService,
        options: IExtensionHostOptions = {},
    ) {
        super();
        this.options = {
            spawnArgs: options.spawnArgs ?? defaultSpawnArgs,
            readyTimeoutMs: options.readyTimeoutMs ?? 60_000,
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
        this.terminals = new TerminalCustomer(options.terminalSink);
        this.environmentVariableCollections = new EnvironmentVariableCollectionsCustomer(
            options.environmentVariableCollections ?? createInMemoryEnvironmentVariableCollectionStore(),
        );
        this.uriHandlersCustomer = this.register(new UriHandlersCustomer());
        this.storageHomes = options.storageHomes ?? fallbackExtensionStorageHomes;
        this.extensionState = options.extensionState ?? createTransientExtensionStateStore();
        this.workspaceScanner = options.workspaceScanner ?? createNodeWorkspaceScanner();
        this.env = new EnvCustomer(
            options.clipboard,
            options.externalOpener,
            options.environment ?? fallbackExtensionHostEnvironment(),
        );
        this.diagnostics = new DiagnosticsCustomer(options.diagnosticsSink, options.markers);
        this.customers = [
            new SecretsCustomer(options.secrets ?? createInMemoryExtensionSecretStore()),
            this.commands,
            this.env,
            this.fileSystem,
            this.decorations,
            this.editor,
            this.documents,
            this.languageFeatures,
            ...(this.configurationCustomer === undefined ? [] : [this.configurationCustomer]),
            this.diagnostics,
            new WindowCustomer({
                progressSink: options.progressSink,
                outputSink: options.outputSink,
                statusBarItemSink: options.statusBarItemSink,
                quickInputSink: options.quickInputSink,
                notificationSink: options.notificationSink,
                fileDialogSink: options.fileDialogSink,
            }),
            this.terminals,
            this.environmentVariableCollections,
            new TasksCustomer(options.taskSink),
            new LanguageConfigurationCustomer(options.languageConfigurations ?? NULL_LANGUAGE_CONFIGURATION_SERVICE),
            new WorkspaceFoldersCustomer(options.workspaceFoldersSink),
            this.uriHandlersCustomer,
        ];
    }

    /**
     * Subprocess не поднимается; заголовки и заглушки `onCommand:` ставятся сразу — иначе видимая в палитре
     * команда была бы no-op.
     */
    public registerExtension(reg: IExtensionRegistration): IDisposable {
        if (this.hostDisposed) throw new Error("ExtensionHost disposed");
        if (this.phases.isRegistered(reg.id)) {
            throw new Error(`Extension "${reg.id}" already registered`);
        }
        // Fail-fast; `parseActivateParams` в субпроцессе проверяет то же.
        if ((reg.source !== undefined) === (reg.mainPath !== undefined)) {
            throw new Error(`Extension "${reg.id}": exactly one of "source" or "mainPath" must be set`);
        }
        this.logger?.debug(`registerExtension(${reg.id})`, {
            mainPath: reg.mainPath,
            activationEvents: readActivationEvents(reg),
        });
        this.commands.addPaletteMetadata(reg);
        this.phases.register(reg);
        // ПОСЛЕ pending: заглушка исполняется асинхронно и обязана найти
        // расширение в очереди, когда до неё дойдёт активация.
        for (const id of readCommandActivationIds(reg)) this.commands.arm(id);
        this.pushExtensionCatalog();
        // Событие уже звучало (как `_activateAddedExtensionIfNeeded` эталона) — повтора может и не быть.
        const heard = readActivationEvents(reg).find((event) => this.requestedEvents.has(event));
        if (heard !== undefined) {
            void this.activateRegistrations([reg], heard).catch((err: unknown) => {
                // Stryker disable next-line OptionalChaining: логгер необязателен (у хоста в тестах его часто нет); без него сбой глотается, а мутант кинул бы внутри `.catch` — это только unhandled rejection, не наблюдаемое поведение хоста
                this.logger?.error(`failed to activate extension "${reg.id}" on registration`, err);
            });
        }
        return {
            dispose: (): void => {
                if (!this.phases.forget(reg.id)) return;
                this.pushExtensionCatalog();
                // Кроме объявленных кем-то ещё: id бывает общим.
                for (const id of readCommandActivationIds(reg)) {
                    if (!this.isCommandActivationClaimed(id)) this.commands.disarm(id);
                }
                if (this.phases.dropPending(reg.id)) return; // ещё не активировано (или ждёт оживления)
                void this.unregisterExtension(reg.id);
            },
        };
    }

    public registerDeclarativeExtension(id: string): void {
        this.declarativeExtensions.add(extensionKey(id));
    }

    /** Расширений без `main` здесь нет — расхождение с `extensions.all` эталона (docs/public/API-COVERAGE.md). */
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

    /** Без субпроцесса — no-op: каталог приедет семенем на его подъёме. */
    private pushExtensionCatalog(): void {
        this.rpc?.notify("extensions.catalog", this.extensionCatalog());
    }

    public async activateByEvent(event: string): Promise<void> {
        this.requestedEvents.add(event);
        // Промис значит «расширения события активны» — поднимаемые другим вызовом тоже дождаться.
        const inFlight = [...this.activating.values()]
            .filter((activation) => readActivationEvents(activation.reg).includes(event))
            .map((activation) => activation.done);
        if (this.replayPending) {
            await Promise.all([this.replayJournal(event), ...inFlight]);
            return;
        }
        // После dispose() `pending` пуст — до ensureSubprocess не дойдёт.
        await Promise.all([this.activateRegistrations(this.pendingMatching([event]), event), ...inFlight]);
    }

    private pendingMatching(events: readonly string[]): IExtensionRegistration[] {
        return this.phases
            .pendingRegistrations()
            .filter((reg) => readActivationEvents(reg).some((event) => events.includes(event)));
    }

    /** Журнал уже содержит и само `reason`; `workspaceContains:` в журнал не пишется — проход отдельно. */
    private async replayJournal(reason: string): Promise<void> {
        this.replayPending = false;
        await this.activateRegistrations(this.pendingMatching([...this.requestedEvents]), reason);
        await this.activateByWorkspaceContains();
    }

    /**
     * По расширению, а не одним событием: паттерн — аргумент события (как `checkActivateWorkspaceContainsExtension`
     * эталона). Зовётся и при позднем открытии папки, иначе событие прогорело бы в пустоту.
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
            // Отсев здесь экономит таймер обхода: метод зовётся на каждое открытие папки.
            // Stryker disable next-line ConditionalExpression: фильтр — оптимизация; пустой набор паттернов и так не совпадает (см. matchWorkspaceContains), наблюдаемой разницы нет
            if (hasWorkspaceContainsPatterns(patterns)) candidates.push({ reg, patterns });
        }
        const folders = this.workspaceFolderPaths();
        const matched: { reg: IExtensionRegistration; pattern: string }[] = [];
        for (const candidate of candidates) {
            const result = await this.matchWorkspaceContainsWithTimeout(candidate.reg.id, folders, candidate.patterns);
            if (result.pattern !== null) matched.push({ reg: candidate.reg, pattern: result.pattern });
        }
        // По одному: в логе — причина каждого.
        for (const hit of matched) {
            await this.activateRegistrations([hit.reg], `workspaceContains:${hit.pattern}`);
        }
    }

    /**
     * Тайм-аут на манифест: `**` одного не съест окно соседей. Это гонка, а не только отмена токена: повисший
     * `readdir` флагом не сдвинуть. Усечение — в лог, иначе читалось бы как «не подошло».
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
        // Свой `catch` обязателен: проигравший в `Promise.race` иначе уронил бы процесс через unhandledRejection.
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
        // Уборка до лога: падение чужого логгера не должно оставить живой таймер.
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

    /** Не-`file:` папки отбрасываем: обходить их сканером нечем. */
    private workspaceFolderPaths(): readonly string[] {
        const paths: string[] = [];
        for (const folder of this.configuration?.getWorkspaceFolders() ?? []) {
            const uri = Uri.parse(folder.uri);
            if (uri.scheme === "file") paths.push(uri.fsPath);
        }
        return paths;
    }

    /** `reason` — только в лог: расширение о поводе активации не узнаёт, как и в эталоне. */
    private async activateRegistrations(toActivate: readonly IExtensionRegistration[], reason: string): Promise<void> {
        if (toActivate.length === 0) return;
        // Сбой spawn/ready — не проблема расширения, пробрасывается наверх.
        const rpc = await this.ensureSubprocess();
        // Параллельно (как `_activateExtensions` эталона): LSP-клиент, поднимающий сервер секундами, иначе держал бы соседей.
        await Promise.all(toActivate.map((reg) => this.activateRegistration(rpc, reg, reason)));
    }

    private activateRegistration(rpc: HostRpc, reg: IExtensionRegistration, reason: string): Promise<void> {
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
     * Зависимости — раньше (как `_handleActivationRequest` эталона): `activate()` вправе читать их `exports`.
     * Не вышло — зависимое не активируется до перезагрузки окна.
     */
    private async activateAfterDependencies(rpc: HostRpc, reg: IExtensionRegistration, reason: string): Promise<void> {
        const outcome = await this.activateDependencies(rpc, reg, reason);
        if (outcome === "ready") {
            await this.requestActivation(rpc, reg, reason);
            return;
        }
        if (outcome === "interrupted") {
            // Зависимое не виновато — к оживлению вместе с ними.
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
            if (isBuiltinVSCodeExtension(dep)) {
                // Отступление: встроенного расширения VS Code у нас нет — поднимаемся без него.
                // Stryker disable next-line OptionalChaining: логгер необязателен; без него строка просто не пишется, наблюдаемое (зависимое активно) проверено с ним
                this.logger?.warn(
                    `"${reg.id}" depends on built-in VS Code extension "${dep}", which Diode does not ship — activating without it`,
                );
                continue;
            }
            return {
                message: `Cannot activate the '${name}' extension because it depends on unknown extension '${dep}'`,
                notify: true,
            };
        }
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

    private findRegistration(key: string): IExtensionRegistration | undefined {
        for (const reg of this.phases.all()) {
            if (extensionKey(reg.id) === key) return reg;
        }
        return undefined;
    }

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
        // Упавший `activate()` не блокирует остальных и не роняет bootstrap (как в VS Code).
        const storage = this.resolveStoragePaths(reg.id);
        this.activationWorkspaces.set(reg.id, this.storageHomes().workspaceStorageHome);
        try {
            await rpc.request("host.activateExtension", {
                id: reg.id,
                mainPath: reg.mainPath,
                source: reg.source,
                filename: reg.filename,
                // Нормализует его одна сторона — `parseActivateParams` в субпроцессе.
                moduleType: reg.manifest.type,
                extensionPath: reg.extensionPath,
                globalStoragePath: storage.globalStoragePath,
                storagePath: storage.storagePath,
                logPath: storage.logPath,
                // Сразу в параметрах: `get` у расширения синхронный.
                globalState: this.extensionState.get(reg.id, true),
                workspaceState: this.extensionState.get(reg.id, false),
            });
            this.phases.markActive(reg);
            // Точечно: манифесты тяжёлые (сотни КБ у языковых серверов), а меняется один флаг.
            rpc.notify("extensions.activated", { id: reg.id });
        } catch (err) {
            // Субпроцесс умер во время активации — расширение ни при чём, к оживлению.
            if (rpc !== this.rpc && this.phases.returnInterrupted(reg)) {
                this.logger?.warn(`activation of "${reg.id}" interrupted by extension host death — will retry`);
                return;
            }
            this.logger?.error(`failed to activate extension "${reg.id}"`, err);
            return;
        }
        // Вне try: сбой логгера не должен прикидываться сбоем активации.
        this.logger?.info(`activated extension "${reg.id}" (${reason})`);
    }

    private isCommandActivationClaimed(id: string): boolean {
        for (const reg of this.phases.all()) {
            if (readCommandActivationIds(reg).includes(id)) return true;
        }
        return false;
    }

    /** Родители создаются по контракту vscode.d.ts; на каждой активации — ради актуальной папки воркспейса. */
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
        // Снятие может прийти вторым заходом — лишний `extensions.catalog` не шлём.
        if (this.phases.forget(id)) this.pushExtensionCatalog();
        const rpc = this.rpc;
        /* v8 ignore start -- defensive: an extension can only be in `extensions` after ensureSubprocess set `rpc`; dispose() clears `extensions` before nulling `rpc`, so rpc is never null while the id is still registered */
        if (rpc === null) return;
        /* v8 ignore stop */
        try {
            await rpc.request("host.deactivateExtension", { id });
            this.logger?.info(`deactivated extension "${id}"`);
        } catch (err) {
            this.logger?.debug(`deactivateExtension(${id}) ignored`, err);
        }
    }

    public willSaveTextDocument(snapshot: ISaveSnapshot): Promise<readonly ISaveEdit[]> {
        return this.documents.willSaveTextDocument(snapshot);
    }

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

    public provideSelectionRanges(
        handle: number,
        req: ISelectionRangeRequest,
        token?: ICancellationToken,
    ): Promise<readonly (readonly IRange[])[]> {
        return this.languageFeatures.provideSelectionRanges(handle, req, token);
    }

    public provideDocumentSemanticTokens(
        handle: number,
        req: ISemanticTokensRequest,
        previousResultId: number,
        token?: ICancellationToken,
    ): Promise<ISemanticTokens | ISemanticTokensEdits | null> {
        return this.languageFeatures.provideDocumentSemanticTokens(handle, req, previousResultId, token);
    }

    public provideDocumentRangeSemanticTokens(
        handle: number,
        req: IRangeSemanticTokensRequest,
        token?: ICancellationToken,
    ): Promise<ISemanticTokens | null> {
        return this.languageFeatures.provideDocumentRangeSemanticTokens(handle, req, token);
    }

    public releaseDocumentSemanticTokens(handle: number, resultId: number): void {
        this.languageFeatures.releaseDocumentSemanticTokens(handle, resultId);
    }

    public get onDidChangeSemanticTokens(): Event<number> {
        return this.languageFeatures.onDidChangeSemanticTokens;
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

    public applyCodeAction(id: string, options?: IApplyCodeActionOptions): Promise<boolean> {
        return this.languageFeatures.applyCodeAction(id, options);
    }

    public prepareRename(handle: number, req: IRenameRequest): Promise<ICoreRenameLocation | null> {
        return this.languageFeatures.prepareRename(handle, req);
    }

    public provideRenameEdits(handle: number, req: IRenameRequest, newName: string): Promise<ICoreRenameResult> {
        return this.languageFeatures.provideRenameEdits(handle, req, newName);
    }

    public getLanguageProviders(): readonly IWireLanguageProviderRegistration[] {
        return this.languageFeatures.getProviders();
    }

    public get onLanguageProvidersChanged(): Event<void> {
        return this.languageFeatures.onProvidersChanged;
    }

    public getFileSystemSchemes(): readonly string[] {
        return this.fileSystem.getFileSystemSchemes();
    }

    public get onFileSystemProvidersChanged(): Event<void> {
        return this.fileSystem.onFileSystemProvidersChanged;
    }

    public isReadonlyFileSystem(scheme: string): boolean {
        return this.fileSystem.isReadonlyFileSystem(scheme);
    }

    public readProvidedFile(uri: Uri): Promise<Uint8Array> {
        return this.fileSystem.readProvidedFile(uri);
    }

    /** `null` — ресурса нет. */
    public statProvidedFile(uri: Uri): Promise<IStat | null> {
        return this.fileSystem.statProvidedFile(uri);
    }

    public writeProvidedFile(uri: Uri, content: Uint8Array): Promise<void> {
        return this.fileSystem.writeProvidedFile(uri, content);
    }

    public get onDidChangeProvidedFile(): Event<readonly Uri[]> {
        return this.fileSystem.onDidChangeProvidedFile;
    }

    public hasTextContentProvider(scheme: string): boolean {
        return this.fileSystem.hasTextContentProvider(scheme);
    }

    public provideTextDocumentContent(uri: Uri): Promise<string | null> {
        return this.fileSystem.provideTextDocumentContent(uri);
    }

    public get onDidChangeTextContent(): Event<Uri> {
        return this.fileSystem.onDidChangeTextContent;
    }

    public get uriHandlers(): IExtensionUriHandlers {
        return this.uriHandlersCustomer;
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
        // Заглушки живут в общем реестре команд ядра — после dispose их некому поднимать.
        this.commands.disarmAll();
        this.shutdownDone = this.shutdownSubprocess();
        super.dispose();
    }

    /** Повторный вызов отдаёт то же прощание. */
    public shutdown(): Promise<void> {
        this.dispose();
        return this.shutdownDone;
    }

    /**
     * Для мест, где event loop дальше не крутится (перезагрузка окна): не доведённый до выхода субпроцесс
     * снимается сигналом синхронно, иначе остался бы сиротой.
     */
    public disposeNow(): void {
        this.dispose();
        this.exitingProcess?.kill();
    }

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
            // Семена — ДО первой активации: `activate()` уже читает настройки, тему, каталог (`getExtension`),
            // `workspace.textDocuments` (vscode-languageclient), `window.terminals` (bazel-java).
            this.configurationCustomer?.pushInitialState();
            this.env.pushInitialState();
            this.editor.pushInitialState();
            this.decorations.pushActiveColorTheme();
            rpc.notify("extensions.catalog", this.extensionCatalog());
            this.documents.pushInitialState();
            this.diagnostics.pushInitialState();
            this.terminals.pushInitialState();
            this.environmentVariableCollections.pushInitialState();
        });
        await this.readyPromise;
        return rpc;
    }

    private installHostHandlers(rpc: HostRpc): void {
        const spawnStore = this.spawnStore;
        for (const customer of this.customers) spawnStore.add(customer.attach({ rpc, logger: this.logger }));
        this.installMementoHandlers(rpc);
    }

    /**
     * Запись `workspaceState` из чужого воркспейса отбрасывается — страховка от записи, ушедшей в полёт до
     * {@link restartForWorkspaceChange}.
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

    private endSpawn(): void {
        this.spawnStore.dispose();
        this.spawnStore = new DisposableStore();
        this.rpc = null;
        this.process = null;
        this.readyPromise = null;
    }

    /** Хост остаётся жив: снимает всё, что принадлежало умершему, и ставит активные расширения на оживление. */
    private handleSubprocessDeath(subprocess: ExtensionHostProcess): void {
        // Вежливое выключение уже обнулило `process` — там всё сделано.
        if (this.process !== subprocess) return;
        this.logger?.warn("extension host subprocess died — resetting host state");
        this.endSpawn();
        // Запросы в полёте получают отказ, а не висят: оборванная активация вернётся к оживлению.
        subprocess.dispose();
        this.armRevival();
    }

    private armRevival(): void {
        const revived = this.phases.reviveAll();
        this.replayPending = true;
        // Заглушки вместо снятых прокси: команда и была единственным способом оживить расширение руками.
        for (const reg of revived) {
            for (const id of readCommandActivationIds(reg)) this.commands.arm(id);
        }
    }

    /**
     * У эталона это перезагрузка окна: `workspaceFolders`/`storageUri` расширение читает в `activate()` один раз.
     * Здесь окно живёт, перезапускается только субпроцесс.
     */
    public async restartForWorkspaceChange(): Promise<void> {
        // Нет спавна (и у выключенного хоста) — перезапускать нечего.
        if (this.rpc === null) {
            await this.activateByWorkspaceContains();
            return;
        }
        this.logger?.info("workspace changed — restarting extension host");
        // Оживление — ДО ожидания выхода: событие, пришедшее за время прощания, поднимет новый спавн, а не потеряется.
        const shutdown = this.shutdownSubprocess();
        this.armRevival();
        await shutdown;
        // Stryker disable next-line ConditionalExpression: без проверки журнал проигрался бы повторно — пустой набор ожидающих и тот же проход по папкам, разница только в поводе лога
        if (this.replayPending) await this.replayJournal("workspaceChanged");
        else await this.activateByWorkspaceContains();
    }

    private async shutdownSubprocess(): Promise<void> {
        const rpc = this.rpc;
        const subprocess = this.process;
        this.endSpawn();
        if (subprocess === null) {
            // Канал без субпроцесса — у in-process тестов.
            rpc?.dispose();
            return;
        }
        this.exitingProcess = subprocess;
        await subprocess.shutdown(this.options.shutdownTimeoutMs);
        this.exitingProcess = null;
    }
}
