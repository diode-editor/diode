import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { CancellationTokenNone, type ICancellationToken } from "../vs/base/common/cancellation.ts";
import type { IDisposable } from "../vs/base/common/lifecycle.ts";
import { Uri } from "../vs/base/common/uri.ts";
import { curatedConfigInjection } from "../vs/diode/curatedConfigInjection.ts";
import type { ITextEdit } from "../vs/editor/common/core/iTextEdit.ts";
import type { ILanguageFeatureTarget } from "../vs/editor/common/languageFeatureRegistry.ts";
import type { ICodeActionRequest, ICoreCodeAction } from "../vs/editor/common/languages/iCodeActionSource.ts";
import type { ICompletionRequest, ICoreCompletionResult } from "../vs/editor/common/languages/iCompletionSource.ts";
import type { ICoreDefinitionLocation, IDefinitionRequest } from "../vs/editor/common/languages/iDefinitionSource.ts";
import type { IFoldingRequest } from "../vs/editor/common/languages/iFoldingSource.ts";
import type { IFormattingRequest } from "../vs/editor/common/languages/iFormattingSource.ts";
import type { ICoreHover, IHoverRequest } from "../vs/editor/common/languages/iHoverSource.ts";
import type {
    ICoreInlineCompletionItem,
    IInlineCompletionRequest,
} from "../vs/editor/common/languages/iInlineCompletionSource.ts";
import type { ILanguageConfigurationService } from "../vs/editor/common/languages/iLanguageConfigurationService.ts";
import type { ILanguageService } from "../vs/editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../vs/editor/common/languages/iLanguageService.ts";
import type { ICoreReference, IReferenceRequest } from "../vs/editor/common/languages/iReferenceSource.ts";
import type { ICoreRenameResult, IRenameRequest } from "../vs/editor/common/languages/iRenameSource.ts";
import type { ICoreSignatureHelp, ISignatureHelpRequest } from "../vs/editor/common/languages/iSignatureHelpSource.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../vs/editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../vs/editor/common/languages/tokenizationRegistry.ts";
import type { ILanguageFeaturesService } from "../vs/editor/common/services/languageFeatures.ts";
import { LanguageFeaturesService } from "../vs/editor/common/services/languageFeaturesService.ts";
import { getCodeActions } from "../vs/editor/contrib/codeAction/codeAction.ts";
import type { IFoldingRegion } from "../vs/editor/contrib/folding/iFoldingRegion.ts";
import { provideFoldingRanges } from "../vs/editor/contrib/folding/syntaxRangeProvider.ts";
import { documentRange, formatDocument, formatRange } from "../vs/editor/contrib/format/format.ts";
import { CommandRegistry } from "../vs/platform/commands/common/commandRegistry.ts";
import { ConfigurationRegistry } from "../vs/platform/configuration/common/configurationRegistry.ts";
import type { IConfigurationService } from "../vs/platform/configuration/common/iConfigurationService.ts";
import { InMemoryConfigurationService } from "../vs/platform/configuration/common/inMemoryConfigurationService.ts";
import { NULL_CONFIGURATION_SERVICE } from "../vs/platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../vs/platform/files/common/iFileWatcher.ts";
import { TrashService } from "../vs/platform/files/node/trashService.ts";
import type { ILogger } from "../vs/platform/log/common/iLogger.ts";
import { NULL_LOG_SERVICE } from "../vs/platform/log/common/nullLogService.ts";
import type { IEnvironmentVariableCollectionStore } from "../vs/platform/terminal/common/environmentVariable.ts";
import { UndoRedoService } from "../vs/platform/undoRedo/common/undoRedoService.ts";
import { CommandServiceAdapter } from "../vs/workbench/api/browser/commandServiceAdapter.ts";
import { bindDocumentSync, openDocumentSnapshots } from "../vs/workbench/api/browser/documentSyncAdapter.ts";
import { EditorLayoutServiceAdapter } from "../vs/workbench/api/browser/editorLayoutServiceAdapter.ts";
import { EditorOptionsServiceAdapter } from "../vs/workbench/api/browser/editorOptionsServiceAdapter.ts";
import { LanguageFeaturesAdapter } from "../vs/workbench/api/browser/languageFeaturesAdapter.ts";
import { ThemeColorResolverAdapter } from "../vs/workbench/api/browser/themeColorResolverAdapter.ts";
import type { IEditorDecorationsService } from "../vs/workbench/api/common/iEditorDecorationsService.ts";
import type { IExtensionFileWatcher } from "../vs/workbench/api/common/iExtensionFileWatcher.ts";
import type {
    DiagnosticsSink,
    INotificationSink,
    IOutputSink,
    IProgressSink,
    IQuickInputSink,
    IStatusBarItemSink,
} from "../vs/workbench/api/common/iExtensionWindowSinks.ts";
import type { IFileDecorationsService } from "../vs/workbench/api/common/iFileDecorationsService.ts";
import type { IThemeColorResolver } from "../vs/workbench/api/common/iThemeColorResolver.ts";
import type { IWorkspaceFoldersSink } from "../vs/workbench/api/common/iWorkspaceFoldersSink.ts";
import { EditorGroupComponent } from "../vs/workbench/browser/parts/editor/editorGroupComponent.ts";
import { BulkEditBuffers } from "../vs/workbench/contrib/bulkEdit/browser/bulkEditBuffers.ts";
import { WorkspaceEditService } from "../vs/workbench/contrib/bulkEdit/browser/workspaceEditService.ts";
import { getDefinitions } from "../vs/workbench/contrib/gotoDefinition/browser/goToSymbol.ts";
import { getHovers } from "../vs/workbench/contrib/hover/browser/getHover.ts";
import { provideInlineCompletions as provideInlineCompletionsFrom } from "../vs/workbench/contrib/inlineCompletions/browser/provideInlineCompletions.ts";
import { provideSignatureHelp as provideSignatureHelpFrom } from "../vs/workbench/contrib/parameterHints/browser/provideSignatureHelp.ts";
import { getReferences } from "../vs/workbench/contrib/references/browser/getReferences.ts";
import type { IPreparedRename } from "../vs/workbench/contrib/rename/browser/renameSymbol.ts";
import { prepareRename, renameSymbol } from "../vs/workbench/contrib/rename/browser/renameSymbol.ts";
import { provideCompletions as provideCompletionsFrom } from "../vs/workbench/contrib/suggest/browser/provideCompletions.ts";
import { EditorService } from "../vs/workbench/services/editor/browser/editorService.ts";
import { ExtensionConfigurationContributor } from "../vs/workbench/services/extensions/common/extensionConfigurationContributor.ts";
import type { IMarkerReader } from "../vs/workbench/services/extensions/node/customers/diagnosticsCustomer.ts";
import type { IExtensionHostEnvironment } from "../vs/workbench/services/extensions/node/customers/envCustomer.ts";
import {
    ExtensionHost,
    type IExtensionHostConfigProvider,
    type IWorkspaceFolderInfo,
} from "../vs/workbench/services/extensions/node/extensionHost.ts";
import type { IExtensionSecretStore } from "../vs/workbench/services/extensions/node/extensionSecretsStore.ts";
import type { IExtensionStateStore } from "../vs/workbench/services/extensions/node/extensionStateStore.ts";
import type { IExtensionStorageHomes } from "../vs/workbench/services/extensions/node/extensionStoragePaths.ts";
import type { IExtensionRegistration } from "../vs/workbench/services/extensions/node/iExtensionEntry.ts";
import type { IWorkspaceScanner } from "../vs/workbench/services/extensions/node/workspaceContainsActivation.ts";

import { diskFileService } from "./diskFileService.ts";
import { removeDirLoud } from "./removeDirLoud.ts";
import { createTestContextMenuService } from "./testContextMenuService.ts";
import { createTestEditorContextMenuController } from "./testEditorContextMenu.ts";

const SUBPROCESS_ENTRY = fileURLToPath(
    new URL("../vs/workbench/services/extensions/node/__fixtures__/subprocessEntry.ts", import.meta.url),
);

/**
 * - `"tsx"` — полный `tsx`, не `tsx/esm`: расширения грузятся `createRequire`, и
 *   `.ts`-main (builtin `git`) требует CJS-хука;
 * - `"node"` — родное стирание типов; единственный режим, где виден настоящий
 *   резолв ESM-расширений: `tsx` уводит `import … from "vscode"` в CJS-резолвер и
 *   маскирует отсутствие нашего ESM-хука. Фикстуры такого теста — `.cjs`/`.mjs`.
 */
export type SubprocessLoader = "tsx" | "node";

/** В vitest `process.argv[1]` — vitest CLI, а не `main.ts`, поэтому свой entry. */
export function subprocessSpawnArgsForTests(
    loader: SubprocessLoader = "tsx",
): () => { command: string; args: string[]; env?: NodeJS.ProcessEnv } {
    const loaderArgs = loader === "tsx" ? ["--import", "tsx"] : ["--experimental-transform-types", "--no-warnings"];
    return () => ({
        command: process.execPath,
        args: [...loaderArgs, SUBPROCESS_ENTRY],
        env: { ...process.env },
    });
}

export const EXTENSION_FIXTURES_DIR = path.dirname(SUBPROCESS_ENTRY);

export function extensionFixture(id: string, file: string): IExtensionRegistration {
    return {
        id,
        manifest: { name: id, publisher: "test", version: "0.0.1" },
        mainPath: path.join(EXTENSION_FIXTURES_DIR, file),
        activationEvents: ["*"],
    };
}

/**
 * Без своих событий расширение eager — удобство тестов, в проде пусто значит пусто;
 * плюс неявные `onCommand:<id>`, как их посчитал бы `computeActivationEvents`.
 */
export function testRegistration(reg: IExtensionRegistration): IExtensionRegistration {
    const events = [...(reg.activationEvents ?? ["*"])];
    for (const id of Object.keys(reg.commandTitles ?? {})) {
        if (!events.includes(`onCommand:${id}`)) events.push(`onCommand:${id}`);
    }
    return { ...reg, activationEvents: events };
}

export function manifestWithDefaults(
    manifest: IExtensionRegistration["manifest"],
    defaults: Readonly<Record<string, unknown>>,
): IExtensionRegistration["manifest"] {
    const properties = Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, { default: value }]));
    return { ...manifest, contributes: { configuration: { properties } } };
}

export async function registerAndActivate(host: ExtensionHost, reg: IExtensionRegistration): Promise<IDisposable> {
    const disposable = host.registerExtension(testRegistration(reg));
    await host.activateByEvent("*");
    return disposable;
}
import { WorkbenchTheme } from "../vs/platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../vs/workbench/services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../vs/workbench/services/themes/common/themeService.ts";

import { TestApp } from "./TestApp.ts";

export interface IExtensionHarnessOptions {
    readonly initialFile?: { readonly name: string; readonly content: string };
    readonly extensions?: readonly IExtensionRegistration[];
    /** `[]` — драйвить `harness.host.activateByEvent(...)` вручную. */
    readonly activateEvents?: readonly string[];
    readonly configuration?: Readonly<Record<string, unknown>>;
    readonly workspaceConfiguration?: Readonly<Record<string, unknown>>;
    /** `uri.toString()`; нет — окно из папки. */
    readonly workspaceFile?: string;
    /** То, что в приложении кладёт хост (`builtinConfigInjection`); дефолты манифестов харнесс собирает сам. */
    readonly configurationDefaults?: Readonly<Record<string, unknown>>;
    /** Настройки ЯДРА (`EditorService`, onSave-участники) — не путать с `configuration` для субпроцесса. */
    readonly configurationService?: IConfigurationService;
    /**
     * По умолчанию — in-memory над `configuration`/`workspaceConfiguration`, диск не
     * трогает; передан файловый — те две опции не читаются.
     */
    readonly extensionConfigurationService?: IConfigurationService;
    /** Строка — путь на ФС; объект — когда нужна не-`file:` схема. */
    readonly workspaceFolders?: readonly (string | IWorkspaceFolderInfo)[];
    readonly languageService?: ILanguageService;
    readonly diagnosticsSink?: DiagnosticsSink;
    readonly markers?: IMarkerReader;
    readonly progressSink?: IProgressSink;
    readonly outputSink?: IOutputSink;
    readonly statusBarItemSink?: IStatusBarItemSink;
    /** Не подключён — расширение мгновенно получает «отменено». */
    readonly quickInputSink?: IQuickInputSink;
    readonly notificationSink?: INotificationSink;
    readonly workspaceFoldersSink?: IWorkspaceFoldersSink;
    readonly editorDecorations?: IEditorDecorationsService;
    readonly fileDecorations?: IFileDecorationsService;
    readonly themeColorResolver?: IThemeColorResolver;
    /** Не подключён — watcher'ы расширений создаются, но не стреляют. */
    readonly fileWatcher?: IExtensionFileWatcher;
    readonly storageHomes?: () => IExtensionStorageHomes;
    readonly secrets?: IExtensionSecretStore;
    readonly extensionState?: IExtensionStateStore;
    readonly logger?: ILogger;
    readonly workspaceScanner?: IWorkspaceScanner;
    readonly environment?: IExtensionHostEnvironment;
    readonly environmentVariableCollections?: IEnvironmentVariableCollectionStore;
    readonly languageConfigurations?: Pick<ILanguageConfigurationService, "register">;
    readonly subprocessLoader?: SubprocessLoader;
}

export interface IExtensionHarness {
    readonly app: TestApp;
    readonly host: ExtensionHost;
    readonly group: EditorService;
    readonly languageFeatures: ILanguageFeaturesService;
    readonly themeService: ThemeService;
    readonly commandRegistry: CommandRegistry;
    readonly tmpDir: string;
    writeFile(name: string, content: string): string;
    /** Один round-trip RPC через `queueMicrotask` — два оборота (request → handler → response). */
    flushRpc(turns?: number): Promise<void>;
    dispose(): Promise<void>;
}

/** Проводка — зеркально extensionHostModule и main.ts: меняешь там — меняй здесь. */
export async function createExtensionTestHarness(options: IExtensionHarnessOptions = {}): Promise<IExtensionHarness> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-ext-"));

    const themeService = new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme));
    const configurationService = options.configurationService ?? NULL_CONFIGURATION_SERVICE;
    const undoRedoService = new UndoRedoService();
    // Один экземпляр у группы (on-save участники) и адаптера хоста, как DI-синглтон.
    const languageFeatures = new LanguageFeaturesService();
    const group = new EditorService(
        themeService,
        new TokenizationRegistry(),
        NULL_TOKEN_STYLE_RESOLVER,
        options.languageService ?? NULL_LANGUAGE_SERVICE,
        configurationService,
        undoRedoService,
        NULL_FILE_WATCHER,
        createTestEditorContextMenuController(),
        NULL_LOG_SERVICE,
        undefined,
        undefined,
        [],
        languageFeatures,
        diskFileService(),
    );
    const groupComponent = new EditorGroupComponent(
        group.editorGroups.activeGroup,
        group,
        createTestContextMenuService(),
        group.editorGroups,
    );

    const workspaceEditService = new WorkspaceEditService(
        undoRedoService,
        new TrashService(),
        configurationService,
        new BulkEditBuffers(group, group.textFileModels),
        diskFileService(),
    );
    const adapter = new EditorOptionsServiceAdapter(group, group.editorGroups, workspaceEditService);
    const commandRegistry = new CommandRegistry();
    const commandAdapter = new CommandServiceAdapter(commandRegistry);
    const folders = (options.workspaceFolders ?? [tmpDir]).map((folder, index) =>
        typeof folder === "string" ? { uri: Uri.file(folder).toString(), name: path.basename(folder), index } : folder,
    );
    const configurationRegistry = new ConfigurationRegistry();
    new ExtensionConfigurationContributor(options.extensions ?? [], configurationRegistry, (ext) =>
        curatedConfigInjection(ext.id),
    ).apply();
    configurationRegistry.registerDefaultConfigurations(options.configurationDefaults ?? {});
    const extensionConfigurationService =
        options.extensionConfigurationService ??
        new InMemoryConfigurationService(
            configurationRegistry,
            options.configuration,
            // Папки нет — и слоя воркспейса нет: запись туда отклоняется, как в пустом окне.
            folders.length === 0 ? undefined : (options.workspaceConfiguration ?? {}),
        );
    const configuration: IExtensionHostConfigProvider = {
        getSnapshot: () => extensionConfigurationService.getConfigurationData(),
        getWorkspaceFolders: () => folders,
        getWorkspaceFile: () => options.workspaceFile,
        onDidChange: (cb) =>
            extensionConfigurationService.onDidChangeConfiguration((event) => {
                cb(event.affectedKeys);
            }),
        updateValue: (key, value, target) => extensionConfigurationService.updateValue(key, value, target),
        getConfigurationScopes: () => configurationRegistry.getConfigurationScopes(),
    };
    const editorLayout = new EditorLayoutServiceAdapter(group, group.editorGroups);
    // Внутри tmpDir: тест не должен писать в user-data машины.
    const storageHomes =
        options.storageHomes ??
        ((): IExtensionStorageHomes => ({
            globalStorageHome: path.join(tmpDir, "globalStorage"),
            workspaceStorageHome: path.join(tmpDir, "workspaceStorage"),
            logsHome: path.join(tmpDir, "logs"),
        }));
    const host = new ExtensionHost(adapter, commandAdapter, {
        spawnArgs: subprocessSpawnArgsForTests(options.subprocessLoader),
        configuration,
        storageHomes,
        ...(options.logger !== undefined ? { logger: options.logger } : {}),
        openDocumentsProvider: () => openDocumentSnapshots(group),
        editorLayout,
        ...(options.diagnosticsSink !== undefined ? { diagnosticsSink: options.diagnosticsSink } : {}),
        ...(options.markers !== undefined ? { markers: options.markers } : {}),
        ...(options.progressSink !== undefined ? { progressSink: options.progressSink } : {}),
        ...(options.outputSink !== undefined ? { outputSink: options.outputSink } : {}),
        ...(options.statusBarItemSink !== undefined ? { statusBarItemSink: options.statusBarItemSink } : {}),
        ...(options.quickInputSink !== undefined ? { quickInputSink: options.quickInputSink } : {}),
        ...(options.notificationSink !== undefined ? { notificationSink: options.notificationSink } : {}),
        ...(options.workspaceFoldersSink !== undefined ? { workspaceFoldersSink: options.workspaceFoldersSink } : {}),
        ...(options.editorDecorations !== undefined ? { editorDecorations: options.editorDecorations } : {}),
        ...(options.fileDecorations !== undefined ? { fileDecorations: options.fileDecorations } : {}),
        themeColorResolver: options.themeColorResolver ?? new ThemeColorResolverAdapter(themeService),
        ...(options.fileWatcher !== undefined ? { fileWatcher: options.fileWatcher } : {}),
        ...(options.secrets !== undefined ? { secrets: options.secrets } : {}),
        ...(options.extensionState !== undefined ? { extensionState: options.extensionState } : {}),
        ...(options.workspaceScanner !== undefined ? { workspaceScanner: options.workspaceScanner } : {}),
        ...(options.environment !== undefined ? { environment: options.environment } : {}),
        ...(options.environmentVariableCollections !== undefined
            ? { environmentVariableCollections: options.environmentVariableCollections }
            : {}),
        ...(options.languageConfigurations !== undefined
            ? { languageConfigurations: options.languageConfigurations }
            : {}),
    });

    new LanguageFeaturesAdapter(host, languageFeatures);
    group.saveParticipant = (snapshot) => host.willSaveTextDocument(snapshot);
    group.onEditorSaved((meta) => {
        host.didSaveTextDocument(meta);
    });
    bindDocumentSync(group, group.editorGroups, host);
    group.virtualDocumentSource = {
        canProvide: (scheme) => host.hasTextContentProvider(scheme),
        provide: (uri) => host.provideTextDocumentContent(uri),
    };
    host.onDidChangeTextContent((uri) => {
        group.refreshVirtualDocument(uri);
    });

    const writeFile = (name: string, content: string): string => {
        const fp = path.join(tmpDir, name);
        fs.writeFileSync(fp, content, "utf-8");
        return fp;
    };

    if (options.initialFile !== undefined) {
        const fp = writeFile(options.initialFile.name, options.initialFile.content);
        group.openFile(fp);
    }

    const app = TestApp.createWithContent(groupComponent.view);

    const flushRpc = async (turns = 2): Promise<void> => {
        for (let i = 0; i < turns; i++) {
            await new Promise<void>((resolve) => {
                queueMicrotask(resolve);
            });
        }
    };

    for (const reg of options.extensions ?? []) {
        host.registerExtension(testRegistration(reg));
    }
    for (const event of options.activateEvents ?? ["*"]) {
        await host.activateByEvent(event);
    }

    const dispose = async (): Promise<void> => {
        // Ждём выхода субпроцесса, а не окно: живой, он пишет в `tmpDir`, и снос либо
        // падает, либо каталог воскресает его `mkdir` — отсюда были гигабайты `diode-ext-*`.
        await host.shutdown();
        groupComponent.dispose();
        group.dispose();
        removeDirLoud(tmpDir, "ExtensionTestHarness");
    };

    return { app, host, group, languageFeatures, themeService, commandRegistry, tmpDir, writeFile, flushRpc, dispose };
}

/** Запросы текста не везут: субпроцесс читает зеркало документа этой версии. */
export function documentVersion(harness: IExtensionHarness, uri: string): number {
    const editor = harness.group.getEditors().find((candidate) => candidate.uri.toString() === uri);
    if (editor === undefined) throw new Error(`no open editor for ${uri}`);
    return editor.model.document.versionId;
}

export function provideHovers(
    harness: IExtensionHarness,
    request: IHoverRequest,
    token: ICancellationToken = CancellationTokenNone,
): Promise<ICoreHover[]> {
    return getHovers(harness.languageFeatures.hoverProvider, targetOf(request), request, token);
}

export function provideDefinitions(
    harness: IExtensionHarness,
    request: IDefinitionRequest,
    token: ICancellationToken = CancellationTokenNone,
): Promise<ICoreDefinitionLocation[]> {
    return getDefinitions(harness.languageFeatures.definitionProvider, targetOf(request), request, token);
}

export function provideReferences(
    harness: IExtensionHarness,
    request: IReferenceRequest,
    token: ICancellationToken = CancellationTokenNone,
): Promise<ICoreReference[]> {
    return getReferences(harness.languageFeatures.referenceProvider, targetOf(request), request, token);
}

export function provideSignatureHelp(
    harness: IExtensionHarness,
    request: ISignatureHelpRequest,
    token: ICancellationToken = CancellationTokenNone,
): Promise<ICoreSignatureHelp | null> {
    return provideSignatureHelpFrom(
        harness.languageFeatures.signatureHelpProvider.ordered(targetOf(request)),
        request,
        token,
    );
}

export function signatureHelpCharacters(
    harness: IExtensionHarness,
    document: { readonly uri: string; readonly languageId: string },
): { triggerCharacters: string[]; retriggerCharacters: string[] } {
    const providers = harness.languageFeatures.signatureHelpProvider.ordered(targetOf(document));
    return {
        triggerCharacters: [...new Set(providers.flatMap((provider) => provider.triggerCharacters))],
        retriggerCharacters: [...new Set(providers.flatMap((provider) => provider.retriggerCharacters))],
    };
}

/** Без word-based пунктов `CompletionService`. */
export async function provideCompletions(
    harness: IExtensionHarness,
    request: ICompletionRequest,
    token: ICancellationToken = CancellationTokenNone,
): Promise<ICoreCompletionResult> {
    const providers = harness.languageFeatures.completionProvider.ordered(targetOf(request));
    const { items, isIncomplete } = await provideCompletionsFrom(providers, request, token);
    return { items, isIncomplete };
}

export function completionTriggerCharacters(
    harness: IExtensionHarness,
    document: { readonly uri: string; readonly languageId: string },
): string[] {
    const providers = harness.languageFeatures.completionProvider.ordered(targetOf(document));
    return [...new Set(providers.flatMap((provider) => provider.triggerCharacters))];
}

/** `null` — форматтера для документа нет. */
export function formatDocumentFor(
    harness: IExtensionHarness,
    request: IFormattingRequest,
    token: ICancellationToken = CancellationTokenNone,
): Promise<readonly ITextEdit[] | null> {
    const { range } = request;
    // Диапазон документа — для range-форматтера без документного, как у команды.
    const text =
        harness.group
            .getEditors()
            .find((editor) => editor.uri.toString() === request.uri)
            ?.getText() ?? "";
    return range === undefined
        ? formatDocument(harness.languageFeatures, targetOf(request), request, documentRange(text), token)
        : formatRange(harness.languageFeatures, targetOf(request), { ...request, range }, token);
}

export async function provideCodeActions(
    harness: IExtensionHarness,
    request: ICodeActionRequest,
    token: ICancellationToken = CancellationTokenNone,
): Promise<readonly ICoreCodeAction[]> {
    const items = await getCodeActions(harness.languageFeatures.codeActionProvider, targetOf(request), request, token);
    return items.map((item) => item.action);
}

export function provideFoldingRegions(
    harness: IExtensionHarness,
    request: IFoldingRequest,
    token: ICancellationToken = CancellationTokenNone,
): Promise<IFoldingRegion[]> {
    return provideFoldingRanges(
        harness.languageFeatures.foldingRangeProvider.ordered(targetOf(request)),
        request,
        token,
    );
}

export function provideInlineCompletions(
    harness: IExtensionHarness,
    request: IInlineCompletionRequest,
    token: ICancellationToken = CancellationTokenNone,
): Promise<ICoreInlineCompletionItem[]> {
    const providers = harness.languageFeatures.inlineCompletionsProvider.ordered(targetOf(request));
    return provideInlineCompletionsFrom(providers, request, token);
}

export function prepareRenameAt(harness: IExtensionHarness, request: IRenameRequest): Promise<IPreparedRename> {
    return prepareRename(harness.languageFeatures.renameProvider, targetOf(request), request);
}

export function provideRename(
    harness: IExtensionHarness,
    request: IRenameRequest,
    newName: string,
): Promise<ICoreRenameResult> {
    return renameSymbol(harness.languageFeatures.renameProvider, targetOf(request), request, newName);
}

function targetOf(request: { readonly uri: string; readonly languageId: string }): ILanguageFeatureTarget {
    return { uri: Uri.parse(request.uri), languageId: request.languageId };
}
