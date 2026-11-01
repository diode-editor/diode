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
    ICallHierarchyIncomingCall,
    ICallHierarchyOutgoingCall,
    ICallHierarchyRequest,
    ICallHierarchySession,
} from "../../../../editor/common/languages/iCallHierarchySource.ts";
import type {
    IApplyCodeActionOptions,
    ICodeActionRequest,
    ICoreCodeAction,
} from "../../../../editor/common/languages/iCodeActionSource.ts";
import type { ICodeLensRequest } from "../../../../editor/common/languages/iCodeLensSource.ts";
import type { IColorInformation, IDocumentColorRequest } from "../../../../editor/common/languages/iColorSource.ts";
import type {
    ICompletionRequest,
    ICoreCompletionResult,
    ICoreResolvedCompletion,
} from "../../../../editor/common/languages/iCompletionSource.ts";
import type {
    ICoreDefinitionLocation,
    IDefinitionRequest,
} from "../../../../editor/common/languages/iDefinitionSource.ts";
import type {
    IDocumentHighlight,
    IDocumentHighlightRequest,
} from "../../../../editor/common/languages/iDocumentHighlightSource.ts";
import type { IFoldingRequest } from "../../../../editor/common/languages/iFoldingSource.ts";
import type {
    IFormattingRequest,
    IOnTypeFormattingRequest,
} from "../../../../editor/common/languages/iFormattingSource.ts";
import type { ICoreHover, IHoverRequest } from "../../../../editor/common/languages/iHoverSource.ts";
import type { IInlayHintsRequest, InlayHint } from "../../../../editor/common/languages/iInlayHintsSource.ts";
import type {
    ICoreInlineCompletionItem,
    IInlineCompletionRequest,
} from "../../../../editor/common/languages/iInlineCompletionSource.ts";
import {
    type ILanguageConfigurationService,
    NULL_LANGUAGE_CONFIGURATION_SERVICE,
} from "../../../../editor/common/languages/iLanguageConfigurationService.ts";
import type {
    ILinkedEditingRangeRequest,
    ILinkedEditingRanges,
} from "../../../../editor/common/languages/iLinkedEditingSource.ts";
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
import type {
    ITypeHierarchyItem,
    ITypeHierarchyRequest,
    ITypeHierarchySession,
} from "../../../../editor/common/languages/iTypeHierarchySource.ts";
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
import type { IProductIconService } from "../../../../platform/theme/common/productIconService.ts";
import type { HostRpc } from "../../../api/common/extHostProtocol.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IDocumentSyncSource, IDocumentSyncTarget } from "../../../api/common/iDocumentSyncTarget.ts";
import {
    type IEditorDecorationsService,
    NULL_EDITOR_DECORATIONS_SERVICE,
} from "../../../api/common/iEditorDecorationsService.ts";
import { type IEditorLayoutService, NULL_EDITOR_LAYOUT_SERVICE } from "../../../api/common/iEditorLayoutService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { type IExtensionFileWatcher, NULL_EXTENSION_FILE_WATCHER } from "../../../api/common/iExtensionFileWatcher.ts";
import type { IExtensionTaskSink } from "../../../api/common/iExtensionTaskSink.ts";
import type { IExtensionTreeViewsSink } from "../../../api/common/iExtensionTreeViewsSink.ts";
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
import type { ILanguageStatusSink } from "../../../api/common/iLanguageStatusSink.ts";
import { type IThemeColorResolver, NULL_THEME_COLOR_RESOLVER } from "../../../api/common/iThemeColorResolver.ts";
import type { IWorkspaceFoldersSink } from "../../../api/common/iWorkspaceFoldersSink.ts";
import type {
    IWireCodeLens,
    IWireCodeLensList,
    IWireLanguageProviderRegistration,
    WireCodeLensCacheId,
} from "../../../api/common/wireTypes.ts";
import {
    type IWireDocumentChangedEvent,
    type IWireDocumentStateChanged,
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
import { FileOperationsCustomer } from "./customers/fileOperationsCustomer.ts";
import { FileSystemCustomer } from "./customers/fileSystemCustomer.ts";
import { LanguageConfigurationCustomer } from "./customers/languageConfigurationCustomer.ts";
import { LanguageFeaturesCustomer } from "./customers/languageFeaturesCustomer.ts";
import { LanguageStatusCustomer } from "./customers/languageStatusCustomer.ts";
import { SecretsCustomer } from "./customers/secretsCustomer.ts";
import { TasksCustomer } from "./customers/tasksCustomer.ts";
import { TerminalCustomer } from "./customers/terminalCustomer.ts";
import { TreeViewsCustomer } from "./customers/treeViewsCustomer.ts";
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
    createRipgrepWorkspaceScanner,
    type IWorkspaceScanner,
    matchWorkspaceContains,
} from "./workspaceContainsActivation.ts";

export const ExtensionHostDIToken = token<ExtensionHost>("ExtensionHost");

export interface IWorkspaceFolderInfo {
    /** `uri.toString()`, not a file system path. */
    readonly uri: string;
    readonly name: string;
    readonly index: number;
}

/** Push model: an extension's `getConfiguration().get()` is synchronous, so an RPC per get is impossible. */
export interface IExtensionHostConfigProvider {
    /** The subprocess merges layers with the same model — it has no defaults layer of its own. */
    getSnapshot(): IConfigurationData;
    getWorkspaceFolders(): readonly IWorkspaceFolderInfo[];
    /** `undefined` when a folder is opened directly or the window is empty. */
    getWorkspaceFile(): string | undefined;
    onDidChange(cb: (affectedKeys: readonly string[]) => void): IDisposable;
    /** By the time the promise resolves, {@link onDidChange} has already fired with the new value. */
    updateValue(key: string, value: unknown, target: ConfigurationTarget): Promise<void>;
    getConfigurationScopes(): ReadonlyMap<string, ConfigurationScope>;
}

export interface IExtensionHostOptions {
    readonly spawnArgs?: () => { command: string; args: string[]; env?: NodeJS.ProcessEnv };
    /** Ms; 60000 as in upstream `LocalProcessExtensionHost._performHandshake`: missing it writes the host off until restart. */
    readonly readyTimeoutMs?: number;
    readonly shutdownTimeoutMs?: number;
    readonly logger?: ILogger;
    readonly rpcLogger?: ILogger;
    /** Without it stdout is closed (`"ignore"`): not inherited because the terminal is shared with the editor and output would land in the frame. */
    readonly stdoutLogger?: ILogger;
    readonly stderrLogger?: ILogger;
    readonly configuration?: IExtensionHostConfigProvider;
    readonly editorDecorations?: IEditorDecorationsService;
    readonly fileDecorations?: IFileDecorationsService;
    readonly themeColorResolver?: IThemeColorResolver;
    /** Expands `$(name)` in command titles from the manifest; Nerd Font glyphs when absent. */
    readonly icons?: IProductIconService;
    readonly diagnosticsSink?: DiagnosticsSink;
    readonly markers?: IMarkerReader;
    readonly languageConfigurations?: Pick<ILanguageConfigurationService, "register">;
    /** When the subprocess dies, the host itself sends `end` to all live handles. */
    readonly progressSink?: IProgressSink;
    readonly outputSink?: IOutputSink;
    /** When the subprocess dies, the host itself calls `clear()`: a dead extension never sends `dispose`. */
    readonly statusBarItemSink?: IStatusBarItemSink;
    /** When the subprocess dies, the host itself hides live pickers so no overlay is left without an owner. */
    readonly quickInputSink?: IQuickInputSink;
    /** The host also reports unknown dependencies through it — like upstream's `unknownDep` toast. */
    readonly notificationSink?: INotificationSink;
    readonly fileDialogSink?: IFileDialogSink;
    readonly workspaceFoldersSink?: IWorkspaceFoldersSink;
    /** When the subprocess dies, the host itself calls `clear()`: its items go with it. */
    readonly languageStatusSink?: ILanguageStatusSink;
    readonly terminalSink?: IExtensionTerminalSink;
    readonly environmentVariableCollections?: IEnvironmentVariableCollectionStore;
    readonly taskSink?: IExtensionTaskSink;
    /** When the subprocess dies, the host itself calls `reset()`: every extension tree goes back to an empty section. */
    readonly treeViewsSink?: IExtensionTreeViewsSink;
    readonly clipboard?: IClipboard;
    readonly externalOpener?: IExternalOpener;
    readonly environment?: IExtensionHostEnvironment;
    /** Pushed on `host.ready` before the first activation: stock vscode-languageclient reads the registry on `start()`. */
    readonly openDocumentsProvider?: () => IDocumentSyncSource[];
    readonly fileWatcher?: IExtensionFileWatcher;
    readonly editorLayout?: IEditorLayoutService;
    /** Read on every activation: the workspace folder is known only after host creation, and `storageUri` depends on it. */
    readonly storageHomes?: () => IExtensionStorageHomes;
    readonly secrets?: IExtensionSecretStore;
    readonly extensionState?: IExtensionStateStore;
    /** Production passes one over the configuration service; the default knows no `files.exclude`/`search.exclude`. */
    readonly workspaceScanner?: IWorkspaceScanner;
    /** Ms; when it expires the extension stays inactive — like upstream `WORKSPACE_CONTAINS_TIMEOUT`. */
    readonly workspaceContainsTimeoutMs?: number;
    /** An expired timeout cancels the request and yields an empty result. */
    readonly requestTimeouts?: Partial<RequestTimeouts>;
    /** In characters; a larger document doesn't exist for extensions (no mirror, no providers, no will-save). */
    readonly maxSyncedDocumentChars?: number;
}

function friendlyName(reg: IExtensionRegistration): string {
    return extensionFriendlyName(reg.id, reg.manifest);
}

/** Subprocess: the same binary with `DIODE_EXTENSION_HOST=1`; an early `main.ts` branch runs `runExtensionHostSubprocess()`. */
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
     * Like upstream `_allRequestedActivateEvents`: always recorded, even with no matching extensions — it activates
     * extensions registered after their event and revives those that outlived a subprocess death.
     * `workspaceContains:` isn't recorded: its trigger is computed from the file system.
     */
    private readonly requestedEvents = new Set<string>();
    /** Revival is lazy, on the next event rather than right at death, to avoid a crash loop. */
    private replayPending = false;
    /** Keys of extensions without `main`: a dependency on them is satisfied (like upstream `_isResolvedExtension`). */
    private readonly declarativeExtensions = new Set<string>();
    private readonly notificationSink: INotificationSink | undefined;
    /** Negative so they never collide with the subprocess's `window.show*Message` handles (those count up from 1). */
    private nextHostMessageHandle = -1;
    /** Concurrent calls await these too. */
    private readonly activating = new Map<string, { reg: IExtensionRegistration; done: Promise<void> }>();
    private process: ExtensionHostProcess | null = null;
    private rpc: HostRpc | null = null;
    private readyPromise: Promise<void> | null = null;
    /** Recreated on every spawn: otherwise respawns would pile up listeners sending into a dead channel. */
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
    public readonly fileOperations: FileOperationsCustomer;
    private readonly storageHomes: () => IExtensionStorageHomes;
    private readonly extensionState: IExtensionStateStore;
    /** `workspaceState` belongs to THIS workspace: a write after a folder change would leak into another store. */
    private readonly activationWorkspaces = new Map<string, string | null>();
    private readonly workspaceScanner: IWorkspaceScanner;
    /** Live `workspaceContains` searches: window exit and a folder change cancel them, which kills their rg. */
    private readonly workspaceContainsSearches = new Set<CancellationTokenSource>();
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
        this.commands = new CommandsCustomer(
            commandService,
            (event) => this.activateByEvent(event),
            this.logger,
            options.icons,
        );
        this.fileSystem = this.register(new FileSystemCustomer(options.fileWatcher ?? NULL_EXTENSION_FILE_WATCHER));
        this.terminals = new TerminalCustomer(options.terminalSink);
        this.environmentVariableCollections = new EnvironmentVariableCollectionsCustomer(
            options.environmentVariableCollections ?? createInMemoryEnvironmentVariableCollectionStore(),
        );
        this.uriHandlersCustomer = this.register(new UriHandlersCustomer());
        this.fileOperations = new FileOperationsCustomer(this.logger);
        this.storageHomes = options.storageHomes ?? fallbackExtensionStorageHomes;
        this.extensionState = options.extensionState ?? createTransientExtensionStateStore();
        this.workspaceScanner = options.workspaceScanner ?? createRipgrepWorkspaceScanner();
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
            new TreeViewsCustomer(options.treeViewsSink),
            new LanguageConfigurationCustomer(options.languageConfigurations ?? NULL_LANGUAGE_CONFIGURATION_SERVICE),
            new WorkspaceFoldersCustomer(options.workspaceFoldersSink),
            new LanguageStatusCustomer(options.languageStatusSink),
            this.uriHandlersCustomer,
            this.fileOperations,
        ];
    }

    /**
     * Doesn't start the subprocess; titles and `onCommand:` stubs are installed right away — otherwise a command
     * visible in the command palette would be a no-op.
     */
    public registerExtension(reg: IExtensionRegistration): IDisposable {
        if (this.hostDisposed) throw new Error("ExtensionHost disposed");
        if (this.phases.isRegistered(reg.id)) {
            throw new Error(`Extension "${reg.id}" already registered`);
        }
        // Fail fast; `parseActivateParams` in the subprocess checks the same.
        if ((reg.source !== undefined) === (reg.mainPath !== undefined)) {
            throw new Error(`Extension "${reg.id}": exactly one of "source" or "mainPath" must be set`);
        }
        this.logger?.debug(`registerExtension(${reg.id})`, {
            mainPath: reg.mainPath,
            activationEvents: readActivationEvents(reg),
        });
        this.commands.addPaletteMetadata(reg);
        this.phases.register(reg);
        // AFTER pending: the stub runs asynchronously and must find
        // the extension in the queue when activation reaches it.
        for (const id of readCommandActivationIds(reg)) this.commands.arm(id);
        this.pushExtensionCatalog();
        // The event already fired (like upstream `_activateAddedExtensionIfNeeded`) — it may never fire again.
        const heard = readActivationEvents(reg).find((event) => this.requestedEvents.has(event));
        if (heard !== undefined) {
            void this.activateRegistrations([reg], heard).catch((err: unknown) => {
                // Stryker disable next-line OptionalChaining: the logger is optional (hosts in tests often lack one); without it the failure is swallowed, and the mutant would throw inside `.catch` — just an unhandled rejection, not observable host behavior
                this.logger?.error(`failed to activate extension "${reg.id}" on registration`, err);
            });
        }
        return {
            dispose: (): void => {
                if (!this.phases.forget(reg.id)) return;
                this.pushExtensionCatalog();
                // Except those declared by someone else: ids can be shared.
                for (const id of readCommandActivationIds(reg)) {
                    if (!this.isCommandActivationClaimed(id)) this.commands.disarm(id);
                }
                if (this.phases.dropPending(reg.id)) return; // not activated yet (or awaiting revival)
                void this.unregisterExtension(reg.id);
            },
        };
    }

    public registerDeclarativeExtension(id: string): void {
        this.declarativeExtensions.add(extensionKey(id));
    }

    /** Extensions without `main` aren't listed — a deviation from upstream `extensions.all` (docs/public/API-COVERAGE.md). */
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

    /** No-op without a subprocess: the catalog arrives as a seed when it starts. */
    private pushExtensionCatalog(): void {
        this.rpc?.notify("extensions.catalog", this.extensionCatalog());
    }

    public async activateByEvent(event: string): Promise<void> {
        this.requestedEvents.add(event);
        // The promise means "the event's extensions are active" — so also wait for those being activated by another call.
        const inFlight = [...this.activating.values()]
            .filter((activation) => readActivationEvents(activation.reg).includes(event))
            .map((activation) => activation.done);
        if (this.replayPending) {
            await Promise.all([this.replayJournal(event), ...inFlight]);
            return;
        }
        // After dispose() `pending` is empty, so ensureSubprocess is never reached.
        await Promise.all([this.activateRegistrations(this.pendingMatching([event]), event), ...inFlight]);
    }

    private pendingMatching(events: readonly string[]): IExtensionRegistration[] {
        return this.phases
            .pendingRegistrations()
            .filter((reg) => readActivationEvents(reg).some((event) => events.includes(event)));
    }

    /** The journal already contains `reason` itself; `workspaceContains:` isn't journaled — it gets a separate pass. */
    private async replayJournal(reason: string): Promise<void> {
        this.replayPending = false;
        await this.activateRegistrations(this.pendingMatching([...this.requestedEvents]), reason);
        await this.activateByWorkspaceContains();
    }

    /**
     * Per extension rather than as one event: the pattern is the event's argument (like upstream
     * `checkActivateWorkspaceContainsExtension`). Also called when a folder opens late, or the event would be lost.
     */
    public async activateByWorkspaceContains(): Promise<void> {
        // Replaying the journal ends with this same pass.
        if (this.replayPending) {
            await this.replayJournal("workspaceContains");
            return;
        }
        const candidates: { reg: IExtensionRegistration; patterns: IWorkspaceContainsPatterns }[] = [];
        for (const reg of this.phases.pendingRegistrations()) {
            const patterns = readWorkspaceContainsPatterns(reg);
            // Filtering here saves a scan timer: this runs on every folder open.
            // Stryker disable next-line ConditionalExpression: the filter is an optimization; an empty pattern set never matches anyway (see matchWorkspaceContains), no observable difference
            if (hasWorkspaceContainsPatterns(patterns)) candidates.push({ reg, patterns });
        }
        const folders = this.workspaceFolderPaths();
        // Independent, like upstream `checkActivateWorkspaceContainsExtension`: each searches with its own timeout
        // and activates on its own match, so one search hung on a slow mount holds back nobody else. Per extension
        // so the log shows each one's reason.
        await Promise.all(
            candidates.map(async (candidate) => {
                const pattern = await this.matchWorkspaceContainsWithTimeout(
                    candidate.reg.id,
                    folders,
                    candidate.patterns,
                );
                if (pattern !== null) await this.activateRegistrations([candidate.reg], `workspaceContains:${pattern}`);
            }),
        );
    }

    /**
     * A timeout per manifest so one `**` can't eat the others' time; it cancels the search, which kills its rg.
     * It's a race, not just token cancellation: a `stat` hung on a dead mount won't notice a flag.
     */
    private async matchWorkspaceContainsWithTimeout(
        id: string,
        folders: readonly string[],
        patterns: IWorkspaceContainsPatterns,
    ): Promise<string | null> {
        const source = new CancellationTokenSource();
        this.workspaceContainsSearches.add(source);
        let timer: ReturnType<typeof setTimeout> | undefined;
        // Settles BEFORE the cancellation below so the race tells a timeout from a window exit.
        const timedOut = new Promise<"timeout">((resolve) => {
            timer = setTimeout(() => {
                resolve("timeout");
                source.cancel();
            }, this.options.workspaceContainsTimeoutMs);
        });
        // Own `catch` is required: otherwise the `Promise.race` loser would crash the process via unhandledRejection.
        const scan = matchWorkspaceContains(this.workspaceScanner, folders, patterns, source.token).catch(
            (err: unknown): null => {
                this.logger?.error(`workspaceContains scan for "${id}" failed`, err);
                return null;
            },
        );
        const cancelled = new Promise<null>((resolve) => {
            source.token.onCancellationRequested(() => {
                resolve(null);
            });
        });
        // Clean up before logging: a throwing foreign logger must not leave a live timer.
        const result = await Promise.race([scan, timedOut, cancelled]);
        clearTimeout(timer);
        // Stryker disable next-line CallExpression: hygiene — cancelling an already settled source later changes nothing observable; it only keeps the set from growing
        this.workspaceContainsSearches.delete(source);
        // Stryker disable next-line CallExpression: removes listeners of a settled source; the caller's answer is already settled — no observable difference
        source.dispose();
        if (result === "timeout") {
            // Like upstream; without it a timeout would read as "didn't match".
            const searched = [...patterns.paths, ...patterns.globs].join(",");
            this.logger?.warn(
                `Not activating extension '${id}': Timed out while searching for 'workspaceContains' pattern ${searched}`,
            );
            return null;
        }
        return result;
    }

    /** Their answer is `null`: an interrupted search is no match, and it isn't a timeout either. */
    private cancelWorkspaceContainsSearches(): void {
        for (const source of this.workspaceContainsSearches) source.cancel();
    }

    /** Non-`file:` folders are dropped: the scanner can't walk them. */
    private workspaceFolderPaths(): readonly string[] {
        const paths: string[] = [];
        for (const folder of this.configuration?.getWorkspaceFolders() ?? []) {
            const uri = Uri.parse(folder.uri);
            if (uri.scheme === "file") paths.push(uri.fsPath);
        }
        return paths;
    }

    /** `reason` is for the log only: the extension never learns why it was activated, same as upstream. */
    private async activateRegistrations(toActivate: readonly IExtensionRegistration[], reason: string): Promise<void> {
        if (toActivate.length === 0) return;
        // A spawn/ready failure isn't the extension's problem; it propagates up.
        const rpc = await this.ensureSubprocess();
        // In parallel (like upstream `_activateExtensions`): an LSP client whose server takes seconds to start
        // would otherwise hold up the rest.
        await Promise.all(toActivate.map((reg) => this.activateRegistration(rpc, reg, reason)));
    }

    private activateRegistration(rpc: HostRpc, reg: IExtensionRegistration, reason: string): Promise<void> {
        if (!this.phases.takePending(reg.id)) return this.activating.get(reg.id)?.done ?? Promise.resolve();
        // Stryker disable next-line BlockStatement: hygiene — awaiting a finished (already resolved) activation is instant, and a new one overwrites the old map entry; no observable difference
        const done = this.activateAfterDependencies(rpc, reg, reason).finally(() => {
            // Stryker disable next-line CallExpression: see above
            this.activating.delete(reg.id);
        });
        this.activating.set(reg.id, { reg, done });
        return done;
    }

    /**
     * Dependencies go first (like upstream `_handleActivationRequest`): `activate()` may read their `exports`.
     * If that fails, the dependent stays inactive until the window reloads.
     */
    private async activateAfterDependencies(rpc: HostRpc, reg: IExtensionRegistration, reason: string): Promise<void> {
        const outcome = await this.activateDependencies(rpc, reg, reason);
        if (outcome === "ready") {
            await this.requestActivation(rpc, reg, reason);
            return;
        }
        if (outcome === "interrupted") {
            // Not the dependent's fault — it goes to revival along with them.
            if (this.phases.returnInterrupted(reg)) {
                // Stryker disable next-line OptionalChaining: the logger is optional (hosts in tests often lack one); the subprocess-death scenario is tested with a logger, and without one the line is simply not written
                this.logger?.warn(`activation of "${reg.id}" interrupted by extension host death — will retry`);
            }
            return;
        }
        // Stryker disable next-line OptionalChaining: see above — without a logger the reason isn't written; the observable part (dependent inactive) is tested with one
        this.logger?.error(outcome.message);
        if (outcome.notify) this.notifyHuman(outcome.message);
    }

    private async activateDependencies(
        rpc: HostRpc,
        reg: IExtensionRegistration,
        reason: string,
    ): Promise<"ready" | "interrupted" | { readonly message: string; readonly notify: boolean }> {
        const deps = readExtensionDependencies(reg.manifest);
        // Stryker disable next-line ConditionalExpression: fast path — without dependencies the pass below would also return "ready" (no loop, nothing to wait for), just a tick later
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
                // Deviation: we don't ship VS Code's built-in extension, so activate without it.
                // Stryker disable next-line OptionalChaining: the logger is optional; without it the line is simply not written; the observable part (dependent active) is tested with one
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
        // Stryker disable next-line UpdateOperator: the counter only needs unique handles; the step direction is unobservable
        const handle = this.nextHostMessageHandle--;
        void this.notificationSink
            ?.showMessage({ severity: "error", message, modal: false, items: [], handle })
            .catch((error: unknown) => {
                // Stryker disable next-line OptionalChaining: without a logger the sink's rejection is swallowed; the mutant would throw inside `.catch` — just an unhandled rejection, not observable host behavior
                this.logger?.error(`showMessage failed: ${String(error)}`);
            });
    }

    private async requestActivation(rpc: HostRpc, reg: IExtensionRegistration, reason: string): Promise<void> {
        // A failing `activate()` doesn't block the others or crash bootstrap (as in VS Code).
        const storage = this.resolveStoragePaths(reg.id);
        this.activationWorkspaces.set(reg.id, this.storageHomes().workspaceStorageHome);
        try {
            await rpc.request("host.activateExtension", {
                id: reg.id,
                mainPath: reg.mainPath,
                source: reg.source,
                filename: reg.filename,
                // Normalized on one side only — `parseActivateParams` in the subprocess.
                moduleType: reg.manifest.type,
                extensionPath: reg.extensionPath,
                globalStoragePath: storage.globalStoragePath,
                storagePath: storage.storagePath,
                logPath: storage.logPath,
                // Passed in the params up front: the extension's `get` is synchronous.
                globalState: this.extensionState.get(reg.id, true),
                workspaceState: this.extensionState.get(reg.id, false),
            });
            this.phases.markActive(reg);
            // Targeted: manifests are heavy (hundreds of KB for language servers) while only one flag changes.
            rpc.notify("extensions.activated", { id: reg.id });
        } catch (err) {
            // The subprocess died during activation — not the extension's fault, queue it for revival.
            if (rpc !== this.rpc && this.phases.returnInterrupted(reg)) {
                this.logger?.warn(`activation of "${reg.id}" interrupted by extension host death — will retry`);
                return;
            }
            this.logger?.error(`failed to activate extension "${reg.id}"`, err);
            return;
        }
        // Outside try: a logger failure must not masquerade as an activation failure.
        this.logger?.info(`activated extension "${reg.id}" (${reason})`);
    }

    private isCommandActivationClaimed(id: string): boolean {
        for (const reg of this.phases.all()) {
            if (readCommandActivationIds(reg).includes(id)) return true;
        }
        return false;
    }

    /** Parents are created per the vscode.d.ts contract; on every activation, to follow the current workspace folder. */
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
        // Removal may come a second time — don't send a redundant `extensions.catalog`.
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

    public didOpenTextDocument(source: IDocumentSyncSource): void {
        this.documents.didOpenTextDocument(source);
    }

    public didChangeTextDocument(source: IDocumentSyncSource): void {
        this.documents.didChangeTextDocument(source);
    }

    public didChangeTextDocumentContent(event: IWireDocumentChangedEvent): void {
        this.documents.didChangeTextDocumentContent(event);
    }

    public didCloseTextDocument(uri: string): void {
        this.documents.didCloseTextDocument(uri);
    }

    public didChangeTextDocumentState(state: IWireDocumentStateChanged): void {
        this.documents.didChangeTextDocumentState(state);
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

    public prepareCallHierarchy(
        handle: number,
        req: ICallHierarchyRequest,
        token?: ICancellationToken,
    ): Promise<ICallHierarchySession | null> {
        return this.languageFeatures.prepareCallHierarchy(handle, req, token);
    }

    public provideCallHierarchyIncomingCalls(
        handle: number,
        sessionId: number,
        itemId: number,
        token?: ICancellationToken,
    ): Promise<readonly ICallHierarchyIncomingCall[]> {
        return this.languageFeatures.provideCallHierarchyIncomingCalls(handle, sessionId, itemId, token);
    }

    public provideCallHierarchyOutgoingCalls(
        handle: number,
        sessionId: number,
        itemId: number,
        token?: ICancellationToken,
    ): Promise<readonly ICallHierarchyOutgoingCall[]> {
        return this.languageFeatures.provideCallHierarchyOutgoingCalls(handle, sessionId, itemId, token);
    }

    public releaseCallHierarchy(handle: number, sessionId: number): void {
        this.languageFeatures.releaseCallHierarchy(handle, sessionId);
    }

    public prepareTypeHierarchy(
        handle: number,
        req: ITypeHierarchyRequest,
        token?: ICancellationToken,
    ): Promise<ITypeHierarchySession | null> {
        return this.languageFeatures.prepareTypeHierarchy(handle, req, token);
    }

    public provideTypeHierarchySupertypes(
        handle: number,
        sessionId: number,
        itemId: number,
        token?: ICancellationToken,
    ): Promise<readonly ITypeHierarchyItem[]> {
        return this.languageFeatures.provideTypeHierarchySupertypes(handle, sessionId, itemId, token);
    }

    public provideTypeHierarchySubtypes(
        handle: number,
        sessionId: number,
        itemId: number,
        token?: ICancellationToken,
    ): Promise<readonly ITypeHierarchyItem[]> {
        return this.languageFeatures.provideTypeHierarchySubtypes(handle, sessionId, itemId, token);
    }

    public releaseTypeHierarchy(handle: number, sessionId: number): void {
        this.languageFeatures.releaseTypeHierarchy(handle, sessionId);
    }

    public provideDocumentHighlights(
        handle: number,
        req: IDocumentHighlightRequest,
        token?: ICancellationToken,
    ): Promise<readonly IDocumentHighlight[] | null> {
        return this.languageFeatures.provideDocumentHighlights(handle, req, token);
    }

    public provideLinkedEditingRanges(
        handle: number,
        req: ILinkedEditingRangeRequest,
        token?: ICancellationToken,
    ): Promise<ILinkedEditingRanges | null> {
        return this.languageFeatures.provideLinkedEditingRanges(handle, req, token);
    }

    public provideDocumentColors(
        handle: number,
        req: IDocumentColorRequest,
        token?: ICancellationToken,
    ): Promise<readonly IColorInformation[] | null> {
        return this.languageFeatures.provideDocumentColors(handle, req, token);
    }

    public provideInlayHints(
        handle: number,
        req: IInlayHintsRequest,
        token?: ICancellationToken,
    ): Promise<readonly InlayHint[] | null> {
        return this.languageFeatures.provideInlayHints(handle, req, token);
    }

    public get onDidChangeInlayHints(): Event<number> {
        return this.languageFeatures.onDidChangeInlayHints;
    }

    public provideCodeLenses(
        handle: number,
        req: ICodeLensRequest,
        token?: ICancellationToken,
    ): Promise<IWireCodeLensList | null> {
        return this.languageFeatures.provideCodeLenses(handle, req, token);
    }

    public resolveCodeLens(
        handle: number,
        cacheId: WireCodeLensCacheId,
        token?: ICancellationToken,
    ): Promise<IWireCodeLens | null> {
        return this.languageFeatures.resolveCodeLens(handle, cacheId, token);
    }

    public releaseCodeLenses(handle: number, cacheId: number): void {
        this.languageFeatures.releaseCodeLenses(handle, cacheId);
    }

    public executeCodeLensCommand(handle: number, cacheId: WireCodeLensCacheId): Promise<void> {
        return this.languageFeatures.executeCodeLensCommand(handle, cacheId);
    }

    public get onDidChangeCodeLenses(): Event<number> {
        return this.languageFeatures.onDidChangeCodeLenses;
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

    public provideImplementation(
        handle: number,
        req: IDefinitionRequest,
        token?: ICancellationToken,
    ): Promise<readonly ICoreDefinitionLocation[]> {
        return this.languageFeatures.provideImplementation(handle, req, token);
    }

    public provideTypeDefinition(
        handle: number,
        req: IDefinitionRequest,
        token?: ICancellationToken,
    ): Promise<readonly ICoreDefinitionLocation[]> {
        return this.languageFeatures.provideTypeDefinition(handle, req, token);
    }

    public provideDeclaration(
        handle: number,
        req: IDefinitionRequest,
        token?: ICancellationToken,
    ): Promise<readonly ICoreDefinitionLocation[]> {
        return this.languageFeatures.provideDeclaration(handle, req, token);
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

    public provideOnTypeFormattingEdits(
        handle: number,
        req: IOnTypeFormattingRequest,
        token?: ICancellationToken,
    ): Promise<readonly ITextEdit[]> {
        return this.languageFeatures.provideOnTypeFormattingEdits(handle, req, token);
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

    /** `null` when the resource doesn't exist. */
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
        // The window is going away: an rg still walking a slow mount must not outlive it.
        this.cancelWorkspaceContainsSearches();
        this.phases.clear();
        // Stubs live in the core's shared command registry — after dispose there's nothing left for them to activate.
        this.commands.disarmAll();
        this.shutdownDone = this.shutdownSubprocess();
        super.dispose();
    }

    /** A repeated call returns the same shutdown promise. */
    public shutdown(): Promise<void> {
        this.dispose();
        return this.shutdownDone;
    }

    /**
     * For places where the event loop won't spin again (window reload): a subprocess that hasn't exited yet is
     * killed with a signal synchronously, otherwise it would be orphaned.
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
            // Seeds go BEFORE the first activation: `activate()` already reads settings, theme, catalog (`getExtension`),
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
     * A `workspaceState` write from another workspace is dropped — a guard against a write that was in flight before
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

    /** The host stays alive: it tears down everything the dead subprocess owned and queues active extensions for revival. */
    private handleSubprocessDeath(subprocess: ExtensionHostProcess): void {
        // A graceful shutdown already nulled `process` and handled everything.
        if (this.process !== subprocess) return;
        this.logger?.warn("extension host subprocess died — resetting host state");
        this.endSpawn();
        // In-flight requests are rejected instead of hanging: an interrupted activation goes back to revival.
        subprocess.dispose();
        this.armRevival();
    }

    private armRevival(): void {
        const revived = this.phases.reviveAll();
        this.replayPending = true;
        // Stubs replace the removed proxies: the command is the only way to revive the extension by hand.
        for (const reg of revived) {
            for (const id of readCommandActivationIds(reg)) this.commands.arm(id);
        }
    }

    /**
     * Upstream reloads the window here: an extension reads `workspaceFolders`/`storageUri` once in `activate()`.
     * Here the window lives on and only the subprocess restarts.
     */
    public async restartForWorkspaceChange(): Promise<void> {
        // The old folders' searches are moot: the pass below searches the new ones.
        this.cancelWorkspaceContainsSearches();
        // No spawn (also for a disposed host) — nothing to restart.
        if (this.rpc === null) {
            await this.activateByWorkspaceContains();
            return;
        }
        this.logger?.info("workspace changed — restarting extension host");
        // Revival is armed BEFORE awaiting exit: an event arriving during shutdown starts a new spawn instead of being lost.
        const shutdown = this.shutdownSubprocess();
        this.armRevival();
        await shutdown;
        // Stryker disable next-line ConditionalExpression: without the check the journal would replay again — an empty pending set and the same folder pass, only the log reason differs
        if (this.replayPending) await this.replayJournal("workspaceChanged");
        else await this.activateByWorkspaceContains();
    }

    private async shutdownSubprocess(): Promise<void> {
        const rpc = this.rpc;
        const subprocess = this.process;
        this.endSpawn();
        if (subprocess === null) {
            // A channel without a subprocess — in in-process tests.
            rpc?.dispose();
            return;
        }
        this.exitingProcess = subprocess;
        await subprocess.shutdown(this.options.shutdownTimeoutMs);
        this.exitingProcess = null;
    }
}
