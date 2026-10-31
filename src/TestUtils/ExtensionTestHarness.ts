import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { CancellationTokenNone, type ICancellationToken } from "../vs/base/common/cancellation.ts";
import type { IDisposable } from "../vs/base/common/lifecycle.ts";
import { Uri } from "../vs/base/common/uri.ts";
import { curatedConfigInjection } from "../vs/diode/curatedConfigInjection.ts";
import {
    bindExtensionHostToEditors,
    bindFileOperationParticipant,
    configProviderOver,
} from "../vs/diode/modules/extensionHostModule.ts";
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
import { openDocumentSyncSources } from "../vs/workbench/api/browser/documentSyncAdapter.ts";
import { EditorLayoutServiceAdapter } from "../vs/workbench/api/browser/editorLayoutServiceAdapter.ts";
import { EditorOptionsServiceAdapter } from "../vs/workbench/api/browser/editorOptionsServiceAdapter.ts";
import { ThemeColorResolverAdapter } from "../vs/workbench/api/browser/themeColorResolverAdapter.ts";
import type { IEditorDecorationsService } from "../vs/workbench/api/common/iEditorDecorationsService.ts";
import type { IExtensionFileWatcher } from "../vs/workbench/api/common/iExtensionFileWatcher.ts";
import type { IExtensionTreeViewsSink } from "../vs/workbench/api/common/iExtensionTreeViewsSink.ts";
import type {
    DiagnosticsSink,
    INotificationSink,
    IOutputSink,
    IProgressSink,
    IQuickInputSink,
    IStatusBarItemSink,
} from "../vs/workbench/api/common/iExtensionWindowSinks.ts";
import type { IFileDecorationsService } from "../vs/workbench/api/common/iFileDecorationsService.ts";
import type { ILanguageStatusSink } from "../vs/workbench/api/common/iLanguageStatusSink.ts";
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
import { ExtensionHost, type IWorkspaceFolderInfo } from "../vs/workbench/services/extensions/node/extensionHost.ts";
import type { IExtensionSecretStore } from "../vs/workbench/services/extensions/node/extensionSecretsStore.ts";
import type { IExtensionStateStore } from "../vs/workbench/services/extensions/node/extensionStateStore.ts";
import type { IExtensionStorageHomes } from "../vs/workbench/services/extensions/node/extensionStoragePaths.ts";
import type { IExtensionRegistration } from "../vs/workbench/services/extensions/node/iExtensionEntry.ts";
import type { IWorkspaceScanner } from "../vs/workbench/services/extensions/node/workspaceContainsActivation.ts";

import { diskFileService } from "./diskFileService.ts";
import { removeDirLoud } from "./removeDirLoud.ts";
import { createTestConfigurationService } from "./testConfigurationService.ts";
import { createTestContextMenuService } from "./testContextMenuService.ts";
import { createTestEditorContextMenuController } from "./testEditorContextMenu.ts";

const SUBPROCESS_ENTRY = fileURLToPath(
    new URL("../vs/workbench/services/extensions/node/__fixtures__/subprocessEntry.ts", import.meta.url),
);

/**
 * Under vitest `process.argv[1]` is the vitest CLI, not `main.ts`, hence a dedicated entry.
 * Full `tsx`, not `tsx/esm`: extensions are loaded via `createRequire`, and a `.ts` main
 * (builtin `git`) needs the CJS hook. The same loader `npm start` runs the host with; the
 * tsx ESM hook routes `import … from "vscode"` to the CJS resolver, so the ESM path of our
 * `vscode` hook is proven only on the built binary (e2e/prettierFormat.test.ts), not here.
 */
export function subprocessSpawnArgsForTests(): () => { command: string; args: string[]; env?: NodeJS.ProcessEnv } {
    return () => ({
        command: process.execPath,
        args: ["--import", "tsx", SUBPROCESS_ENTRY],
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
 * An extension without its own events is eager — a test convenience; in production empty means empty.
 * Plus the implicit `onCommand:<id>` events, as `computeActivationEvents` would compute them.
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
    /** `[]` — drive `harness.host.activateByEvent(...)` manually. */
    readonly activateEvents?: readonly string[];
    readonly configuration?: Readonly<Record<string, unknown>>;
    readonly workspaceConfiguration?: Readonly<Record<string, unknown>>;
    /** `uri.toString()`; absent — a folder window. */
    readonly workspaceFile?: string;
    /** What the host injects in the app (`builtinConfigInjection`); the harness collects manifest defaults itself. */
    readonly configurationDefaults?: Readonly<Record<string, unknown>>;
    /** CORE settings (`EditorService`, onSave participants) — not the subprocess `configuration`. */
    readonly configurationService?: IConfigurationService;
    /**
     * Defaults to in-memory over `configuration`/`workspaceConfiguration`, without touching
     * the disk; when a file-backed one is passed, those two options are ignored.
     */
    readonly extensionConfigurationService?: IConfigurationService;
    /** A string is a file system path; an object is for a non-`file:` scheme. */
    readonly workspaceFolders?: readonly (string | IWorkspaceFolderInfo)[];
    readonly languageService?: ILanguageService;
    readonly diagnosticsSink?: DiagnosticsSink;
    readonly markers?: IMarkerReader;
    readonly progressSink?: IProgressSink;
    readonly outputSink?: IOutputSink;
    readonly statusBarItemSink?: IStatusBarItemSink;
    /** When not wired, the extension gets "cancelled" immediately. */
    readonly quickInputSink?: IQuickInputSink;
    readonly notificationSink?: INotificationSink;
    readonly workspaceFoldersSink?: IWorkspaceFoldersSink;
    readonly languageStatusSink?: ILanguageStatusSink;
    readonly treeViewsSink?: IExtensionTreeViewsSink;
    /** The workbench's registry, when its menus (a tree row's `view/item/context`) must see the extension's commands. */
    readonly commandRegistry?: CommandRegistry;
    readonly editorDecorations?: IEditorDecorationsService;
    readonly fileDecorations?: IFileDecorationsService;
    readonly themeColorResolver?: IThemeColorResolver;
    /** When not wired, extension watchers are created but never fire. */
    readonly fileWatcher?: IExtensionFileWatcher;
    readonly storageHomes?: () => IExtensionStorageHomes;
    readonly secrets?: IExtensionSecretStore;
    readonly extensionState?: IExtensionStateStore;
    readonly logger?: ILogger;
    /** The subprocess's stderr, line by line (`[ext-host] …` warnings land here). */
    readonly stderrLogger?: ILogger;
    readonly workspaceScanner?: IWorkspaceScanner;
    readonly workspaceContainsTimeoutMs?: number;
    readonly environment?: IExtensionHostEnvironment;
    readonly environmentVariableCollections?: IEnvironmentVariableCollectionStore;
    readonly languageConfigurations?: Pick<ILanguageConfigurationService, "register">;
    /** What the editors read pairs and `onEnterRules` from; pass the same service as {@link languageConfigurations}. */
    readonly editorLanguageConfigurations?: ILanguageConfigurationService;
}

export interface IExtensionHarness {
    readonly app: TestApp;
    readonly host: ExtensionHost;
    readonly group: EditorService;
    readonly languageFeatures: ILanguageFeaturesService;
    readonly themeService: ThemeService;
    readonly commandRegistry: CommandRegistry;
    readonly tmpDir: string;
    readonly workspaceEditService: WorkspaceEditService;
    writeFile(name: string, content: string): string;
    /** One RPC round trip over `queueMicrotask` takes two turns (request → handler → response). */
    flushRpc(turns?: number): Promise<void>;
    dispose(): Promise<void>;
}

/** The editor and configuration wiring is extensionHostModule's own (`bindExtensionHostToEditors`, `configProviderOver`). */
export async function createExtensionTestHarness(options: IExtensionHarnessOptions = {}): Promise<IExtensionHarness> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-ext-"));

    const themeService = new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme));
    const configurationService = options.configurationService ?? NULL_CONFIGURATION_SERVICE;
    const undoRedoService = new UndoRedoService();
    // One instance shared by the group (on-save participants) and the host adapter, like a DI singleton.
    const languageFeatures = new LanguageFeaturesService();
    // Shared like the DI singleton: the group follows moves through this instance's events.
    const files = diskFileService();
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
        options.editorLanguageConfigurations,
        undefined,
        [],
        languageFeatures,
        files,
    );
    const groupComponent = new EditorGroupComponent(
        group.editorGroups.activeGroup,
        group,
        createTestContextMenuService(),
        group.editorGroups,
    );

    const harnessConfiguration =
        options.configurationService ??
        createTestConfigurationService({ "files.refactoring.autoSave": true, "files.participants.timeout": 60000 });
    const workspaceEditService = new WorkspaceEditService(
        undoRedoService,
        new TrashService(),
        // Schema defaults: without them a refactoring would stay in dirty models instead of reaching the disk.
        harnessConfiguration,
        new BulkEditBuffers(group, group.textFileModels),
        files,
    );
    const adapter = new EditorOptionsServiceAdapter(group, group.editorGroups, workspaceEditService);
    const commandRegistry = options.commandRegistry ?? new CommandRegistry();
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
            // No folder means no workspace layer: writes to it are rejected, as in an empty window.
            folders.length === 0 ? undefined : (options.workspaceConfiguration ?? {}),
        );
    const configuration = configProviderOver(
        extensionConfigurationService,
        configurationRegistry,
        () => folders,
        () => options.workspaceFile,
    );
    const editorLayout = new EditorLayoutServiceAdapter(
        group,
        group.editorGroups,
        options.languageService ?? NULL_LANGUAGE_SERVICE,
    );
    // Inside tmpDir: a test must not write to the machine's user data.
    const storageHomes =
        options.storageHomes ??
        ((): IExtensionStorageHomes => ({
            globalStorageHome: path.join(tmpDir, "globalStorage"),
            workspaceStorageHome: path.join(tmpDir, "workspaceStorage"),
            logsHome: path.join(tmpDir, "logs"),
        }));
    const host = new ExtensionHost(adapter, commandAdapter, {
        spawnArgs: subprocessSpawnArgsForTests(),
        configuration,
        storageHomes,
        ...(options.logger !== undefined ? { logger: options.logger } : {}),
        ...(options.stderrLogger !== undefined ? { stderrLogger: options.stderrLogger } : {}),
        openDocumentsProvider: () => openDocumentSyncSources(group),
        editorLayout,
        ...(options.diagnosticsSink !== undefined ? { diagnosticsSink: options.diagnosticsSink } : {}),
        ...(options.markers !== undefined ? { markers: options.markers } : {}),
        ...(options.progressSink !== undefined ? { progressSink: options.progressSink } : {}),
        ...(options.outputSink !== undefined ? { outputSink: options.outputSink } : {}),
        ...(options.statusBarItemSink !== undefined ? { statusBarItemSink: options.statusBarItemSink } : {}),
        ...(options.quickInputSink !== undefined ? { quickInputSink: options.quickInputSink } : {}),
        ...(options.notificationSink !== undefined ? { notificationSink: options.notificationSink } : {}),
        ...(options.workspaceFoldersSink !== undefined ? { workspaceFoldersSink: options.workspaceFoldersSink } : {}),
        ...(options.languageStatusSink !== undefined ? { languageStatusSink: options.languageStatusSink } : {}),
        ...(options.treeViewsSink !== undefined ? { treeViewsSink: options.treeViewsSink } : {}),
        ...(options.editorDecorations !== undefined ? { editorDecorations: options.editorDecorations } : {}),
        ...(options.fileDecorations !== undefined ? { fileDecorations: options.fileDecorations } : {}),
        themeColorResolver: options.themeColorResolver ?? new ThemeColorResolverAdapter(themeService),
        ...(options.fileWatcher !== undefined ? { fileWatcher: options.fileWatcher } : {}),
        ...(options.secrets !== undefined ? { secrets: options.secrets } : {}),
        ...(options.extensionState !== undefined ? { extensionState: options.extensionState } : {}),
        ...(options.workspaceScanner !== undefined ? { workspaceScanner: options.workspaceScanner } : {}),
        ...(options.workspaceContainsTimeoutMs !== undefined
            ? { workspaceContainsTimeoutMs: options.workspaceContainsTimeoutMs }
            : {}),
        ...(options.environment !== undefined ? { environment: options.environment } : {}),
        ...(options.environmentVariableCollections !== undefined
            ? { environmentVariableCollections: options.environmentVariableCollections }
            : {}),
        ...(options.languageConfigurations !== undefined
            ? { languageConfigurations: options.languageConfigurations }
            : {}),
    });

    bindExtensionHostToEditors(host, group, group.editorGroups, languageFeatures);
    bindFileOperationParticipant(host, workspaceEditService, harnessConfiguration, {
        withProgress: (_options, task) => task(),
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
        // Wait for the subprocess to exit, not a fixed window: while alive it writes to `tmpDir`, and removal
        // either fails or its `mkdir` resurrects the directory — that is how gigabytes of `diode-ext-*` piled up.
        await host.shutdown();
        groupComponent.dispose();
        group.dispose();
        removeDirLoud(tmpDir, "ExtensionTestHarness");
    };

    return {
        app,
        host,
        group,
        languageFeatures,
        themeService,
        commandRegistry,
        tmpDir,
        workspaceEditService,
        writeFile,
        flushRpc,
        dispose,
    };
}

/** Requests carry no text: the subprocess reads its mirror of the document at this version. */
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

export async function provideDefinitions(
    harness: IExtensionHarness,
    request: IDefinitionRequest,
    token: ICancellationToken = CancellationTokenNone,
): Promise<readonly ICoreDefinitionLocation[]> {
    const model = await getDefinitions(harness.languageFeatures.definitionProvider, targetOf(request), request, token);
    return model.references;
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

/** Without the word-based items of `CompletionService`. */
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

/** `null` — no formatter for the document. */
export function formatDocumentFor(
    harness: IExtensionHarness,
    request: IFormattingRequest,
    token: ICancellationToken = CancellationTokenNone,
): Promise<readonly ITextEdit[] | null> {
    const { range } = request;
    // Whole-document range — for a range formatter without a document one, as the command does.
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
