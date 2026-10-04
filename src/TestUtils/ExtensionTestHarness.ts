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
import type { ILanguageService } from "../vs/editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../vs/editor/common/languages/iLanguageService.ts";
import type { ICoreReference, IReferenceRequest } from "../vs/editor/common/languages/iReferenceSource.ts";
import type { ICoreSignatureHelp, ISignatureHelpRequest } from "../vs/editor/common/languages/iSignatureHelpSource.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../vs/editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../vs/editor/common/languages/tokenizationRegistry.ts";
import type { ILanguageFeaturesService } from "../vs/editor/common/services/languageFeatures.ts";
import { LanguageFeaturesService } from "../vs/editor/common/services/languageFeaturesService.ts";
import { getCodeActions } from "../vs/editor/contrib/codeAction/codeAction.ts";
import type { IFoldingRegion } from "../vs/editor/contrib/folding/iFoldingRegion.ts";
import { provideFoldingRanges } from "../vs/editor/contrib/folding/syntaxRangeProvider.ts";
import { formatDocument, formatRange } from "../vs/editor/contrib/format/format.ts";
import { CommandRegistry } from "../vs/platform/commands/common/commandRegistry.ts";
import { ConfigurationRegistry } from "../vs/platform/configuration/common/configurationRegistry.ts";
import type { IConfigurationService } from "../vs/platform/configuration/common/iConfigurationService.ts";
import { NULL_CONFIGURATION_SERVICE } from "../vs/platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../vs/platform/files/common/iFileWatcher.ts";
import { TrashService } from "../vs/platform/files/node/trashService.ts";
import type { ILogger } from "../vs/platform/log/common/iLogger.ts";
import { NULL_LOG_SERVICE } from "../vs/platform/log/common/nullLogService.ts";
import { UndoRedoService } from "../vs/platform/undoRedo/common/undoRedoService.ts";
import { CommandServiceAdapter } from "../vs/workbench/api/browser/commandServiceAdapter.ts";
import { bindDocumentSync, openDocumentSnapshots } from "../vs/workbench/api/browser/documentSyncAdapter.ts";
import { EditorLayoutServiceAdapter } from "../vs/workbench/api/browser/editorLayoutServiceAdapter.ts";
import { EditorOptionsServiceAdapter } from "../vs/workbench/api/browser/editorOptionsServiceAdapter.ts";
import { LanguageFeaturesAdapter } from "../vs/workbench/api/browser/languageFeaturesAdapter.ts";
import { ThemeColorResolverAdapter } from "../vs/workbench/api/browser/themeColorResolverAdapter.ts";
import type { IEditorDecorationsService } from "../vs/workbench/api/common/iEditorDecorationsService.ts";
import type { IExtensionFileWatcher } from "../vs/workbench/api/common/iExtensionFileWatcher.ts";
import type { IFileDecorationsService } from "../vs/workbench/api/common/iFileDecorationsService.ts";
import type { IThemeColorResolver } from "../vs/workbench/api/common/iThemeColorResolver.ts";
import { EditorGroupComponent } from "../vs/workbench/browser/parts/editor/editorGroupComponent.ts";
import { BulkEditBuffers } from "../vs/workbench/contrib/bulkEdit/browser/bulkEditBuffers.ts";
import { WorkspaceEditService } from "../vs/workbench/contrib/bulkEdit/browser/workspaceEditService.ts";
import { getDefinitions } from "../vs/workbench/contrib/gotoDefinition/browser/goToSymbol.ts";
import { getHovers } from "../vs/workbench/contrib/hover/browser/getHover.ts";
import { provideInlineCompletions as provideInlineCompletionsFrom } from "../vs/workbench/contrib/inlineCompletions/browser/provideInlineCompletions.ts";
import { provideSignatureHelp as provideSignatureHelpFrom } from "../vs/workbench/contrib/parameterHints/browser/provideSignatureHelp.ts";
import { getReferences } from "../vs/workbench/contrib/references/browser/getReferences.ts";
import { provideCompletions as provideCompletionsFrom } from "../vs/workbench/contrib/suggest/browser/provideCompletions.ts";
import { EditorService } from "../vs/workbench/services/editor/browser/editorService.ts";
import { ExtensionConfigurationContributor } from "../vs/workbench/services/extensions/common/extensionConfigurationContributor.ts";
import {
    type DiagnosticsSink,
    ExtensionHost,
    type IExtensionHostConfigProvider,
    type IOutputSink,
    type IProgressSink,
    type IQuickInputSink,
    type IStatusBarItemSink,
    type IWorkspaceFolderInfo,
} from "../vs/workbench/services/extensions/node/extensionHost.ts";
import type { IExtensionSecretStore } from "../vs/workbench/services/extensions/node/extensionSecretsStore.ts";
import type { IExtensionStateStore } from "../vs/workbench/services/extensions/node/extensionStateStore.ts";
import type { IExtensionStorageHomes } from "../vs/workbench/services/extensions/node/extensionStoragePaths.ts";
import type { IExtensionRegistration } from "../vs/workbench/services/extensions/node/iExtensionEntry.ts";
import type { IWorkspaceScanner } from "../vs/workbench/services/extensions/node/workspaceContainsActivation.ts";

import { diskFileService } from "./diskFileService.ts";
import { createTestContextMenuService } from "./testContextMenuService.ts";
import { createTestEditorContextMenuController } from "./testEditorContextMenu.ts";

const SUBPROCESS_ENTRY = fileURLToPath(
    new URL("../vs/workbench/services/extensions/node/__fixtures__/subprocessEntry.ts", import.meta.url),
);

/**
 * Чем транспилировать `.ts` внутри тестового subprocess'а.
 *
 * - `"tsx"` (дефолт) — полный `tsx` (не `tsx/esm`) регистрирует и ESM-, и
 *   CJS-хук: расширения грузятся через `createRequire(mainPath)`, поэтому
 *   `.ts`-main (напр. builtin `git`) требует CJS-транспиляции;
 * - `"node"` — родное стирание типов Node (`--experimental-transform-types`,
 *   нужен из-за `enum`). Это ЕДИНСТВЕННЫЙ режим, в котором виден настоящий
 *   резолв ESM-расширений: `tsx` своим хуком уводит `import … from "vscode"` в
 *   CJS-резолвер и тем самым маскирует отсутствие нашего ESM-хука. Платой идёт
 *   отсутствие CJS-транспиляции `.ts` — фикстуры такого теста обязаны быть
 *   `.cjs`/`.mjs`.
 */
export type SubprocessLoader = "tsx" | "node";

/**
 * Возвращает `spawnArgs`-фабрику для тестового запуска subprocess'а — вместо
 * `main.ts` запускает {@link SUBPROCESS_ENTRY}. Это нужно, т.к. в vitest
 * `process.argv[1]` указывает на vitest CLI, а не на `main.ts`. Чем
 * транспилировать `.ts` — см. {@link SubprocessLoader}.
 */
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

/** Абсолютный путь к `src/Extensions/Host/__fixtures__` с тестовыми `.cjs`-расширениями. */
export const EXTENSION_FIXTURES_DIR = path.dirname(SUBPROCESS_ENTRY);

/**
 * Регистрация fixture-расширения из {@link EXTENSION_FIXTURES_DIR} с минимальным
 * тестовым манифестом (`publisher: "test"`) и eager-событием `*`. Расширяемые поля
 * (`commandTitles`, свои `activationEvents`) добавляются спредом:
 * `{ ...extensionFixture(...), commandTitles }`.
 */
export function extensionFixture(id: string, file: string): IExtensionRegistration {
    return {
        id,
        manifest: { name: id, publisher: "test", version: "0.0.1" },
        mainPath: path.join(EXTENSION_FIXTURES_DIR, file),
        // Eager — тестовый дефолт (см. `testRegistration`); свои события — спредом.
        activationEvents: ["*"],
    };
}

/**
 * Регистрация в тестовом виде: без своих событий расширение eager (`["*"]`) —
 * в проде такого дефолта нет (пусто значит пусто), это удобство тестов, — плюс
 * неявные `onCommand:<id>` из `commandTitles`, как их посчитал бы
 * `computeActivationEvents` по `contributes.commands` при сборке регистрации.
 */
export function testRegistration(reg: IExtensionRegistration): IExtensionRegistration {
    const events = [...(reg.activationEvents ?? ["*"])];
    for (const id of Object.keys(reg.commandTitles ?? {})) {
        if (!events.includes(`onCommand:${id}`)) events.push(`onCommand:${id}`);
    }
    return { ...reg, activationEvents: events };
}

/**
 * Манифест с `contributes.configuration` из dotted-map дефолтов — так тест
 * описывает настройки расширения там же, где их объявляет настоящее
 * расширение; харнесс регистрирует их в общем реестре, как `main.ts`.
 */
export function manifestWithDefaults(
    manifest: IExtensionRegistration["manifest"],
    defaults: Readonly<Record<string, unknown>>,
): IExtensionRegistration["manifest"] {
    const properties = Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, { default: value }]));
    return { ...manifest, contributes: { configuration: { properties } } };
}

/**
 * Тест-хелпер: регистрирует расширение (в тестовом виде, см.
 * {@link testRegistration}) и сразу активирует его через `activateByEvent("*")`.
 * Заменяет прежний eager `await host.registerExtension(reg)` в тестах, которым
 * важно, что расширение активно сразу. Возвращает disposable от регистрации.
 */
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
    /**
     * Событие(я) активации, которые харнесс фаерит после регистрации расширений.
     * По умолчанию — `["*"]` (eager, эквивалент прежнего поведения). Тесты
     * ленивой активации передают собственный набор (или `[]`, чтобы драйвить
     * `harness.host.activateByEvent(...)` вручную).
     */
    readonly activateEvents?: readonly string[];
    /**
     * Пользовательский слой настроек (дерево), который host запушит в subprocess
     * (`workspace.initialize`). Читается расширением через `getConfiguration`.
     */
    readonly configuration?: Readonly<Record<string, unknown>>;
    /**
     * Дополнительные переопределения дефолтов (dotted-ключи) — то, что в
     * приложении кладёт хост (`builtinConfigInjection`: пути вшитого tsserver).
     * Дефолты `contributes.configuration` зарегистрированных расширений и
     * курируемые инъекции харнесс собирает сам — тем же контрибьютором, что и
     * `main.ts`.
     */
    readonly configurationDefaults?: Readonly<Record<string, unknown>>;
    /**
     * Сервис настроек ЯДРА (`EditorService` и его onSave-участники). По
     * умолчанию — NULL-заглушка; тесты codeActionsOnSave/formatOnSave передают
     * стаб с нужными ключами. Не путать с `configuration` — снапшотом для
     * subprocess'а.
     */
    readonly configurationService?: IConfigurationService;
    /**
     * Папки воркспейса (`workspace.workspaceFolders`). Строка — ПУТЬ на ФС
     * (тесту удобнее оперировать `tmpDir`, uri харнесс поднимет сам); объект —
     * готовый дескриптор, когда тесту нужна не-`file:` схема. По умолчанию —
     * tmpDir.
     */
    readonly workspaceFolders?: readonly (string | IWorkspaceFolderInfo)[];
    /**
     * Сервис определения языка (для `document.languageId`). По умолчанию —
     * {@link NULL_LANGUAGE_SERVICE} (всё — `plaintext`).
     */
    readonly languageService?: ILanguageService;
    /** Сток диагностик расширений (`diagnostics.publish`). По умолчанию не подключён. */
    readonly diagnosticsSink?: DiagnosticsSink;
    /** Сток прогресса расширений (`window.progress.*`). По умолчанию не подключён. */
    readonly progressSink?: IProgressSink;
    /** Сток output-каналов расширений (`output.append`/`show`). По умолчанию не подключён. */
    readonly outputSink?: IOutputSink;
    /** Сток пунктов статус-бара расширений (`window.statusBarItem.*`). По умолчанию не подключён. */
    readonly statusBarItemSink?: IStatusBarItemSink;
    /**
     * Сток ввода расширений (`window.showInputBox`/`showQuickPick`). По умолчанию
     * не подключён — расширение мгновенно получает «отменено».
     */
    readonly quickInputSink?: IQuickInputSink;
    /** Мост gutter-декораций к редакторам (Chunk 4). По умолчанию не подключён. */
    readonly editorDecorations?: IEditorDecorationsService;
    /** Мост файловых декораций к дереву (Chunk 4). По умолчанию не подключён. */
    readonly fileDecorations?: IFileDecorationsService;
    /** Резолвер ThemeColor id → packed-RGB (+ смена темы). По умолчанию не подключён. */
    readonly themeColorResolver?: IThemeColorResolver;
    /**
     * Наблюдатель за деревом для `workspace.createFileSystemWatcher`. По
     * умолчанию не подключён — watcher'ы расширений создаются, но не стреляют.
     */
    readonly fileWatcher?: IExtensionFileWatcher;
    /**
     * Корни приватных каталогов расширений (`globalStorageUri`/`storageUri`/`logUri`).
     * По умолчанию — внутри `tmpDir` харнесса (изолировано на прогон, как и
     * файлы-фикстуры); `storageUri` при этом есть, как при открытой папке.
     */
    readonly storageHomes?: () => IExtensionStorageHomes;
    /**
     * Хранилище `ExtensionContext.secrets`. По умолчанию — in-memory (живёт
     * ровно прогон). Тесты персистентности передают файловое, чтобы увидеть
     * записанное на диске.
     */
    readonly secrets?: IExtensionSecretStore;
    /**
     * Хранилище memento расширений (`globalState`/`workspaceState`). По
     * умолчанию — без персиста (memento живёт в памяти субпроцесса).
     */
    readonly extensionState?: IExtensionStateStore;
    /** Логгер хоста — тестам, которые проверяют предупреждения. По умолчанию его нет. */
    readonly logger?: ILogger;
    /**
     * Доступ к дереву воркспейса для `workspaceContains:`-активации. По
     * умолчанию — настоящая ФС (то есть `tmpDir` харнесса, куда пишет
     * `writeFile`); тесты обхода передают карту каталогов в памяти.
     */
    readonly workspaceScanner?: IWorkspaceScanner;
    /**
     * Чем транспилировать `.ts` в subprocess'е. По умолчанию `"tsx"`; `"node"`
     * нужен тестам ESM-расширений — см. {@link SubprocessLoader}.
     */
    readonly subprocessLoader?: SubprocessLoader;
}

export interface IExtensionHarness {
    readonly app: TestApp;
    readonly host: ExtensionHost;
    readonly group: EditorService;
    /**
     * Реестры языковых провайдеров ядра: прокси провайдеров субпроцесса в них
     * держит `LanguageFeaturesAdapter` — зеркально extensionHostModule.
     */
    readonly languageFeatures: ILanguageFeaturesService;
    /** ThemeService, за которым стоит харнесс (для тестов смены темы). */
    readonly themeService: ThemeService;
    /**
     * Host-реестр команд, за которым стоит {@link ExtensionHost}. Тест может
     * `execute(...)` прокси-команду сабпроцесса (host → subprocess) или
     * `register(...)` хостовую команду, которую сабпроцесс вызовет fall-through.
     */
    readonly commandRegistry: CommandRegistry;
    readonly tmpDir: string;
    writeFile(name: string, content: string): string;
    /**
     * Прокачивает microtask-очередь — RPC в Phase 1 идёт через `queueMicrotask`,
     * один полный round-trip = два «оборота» (request → handler → response).
     */
    flushRpc(turns?: number): Promise<void>;
    dispose(): Promise<void>;
}

/**
 * Test harness для расширений: поднимает реальный {@link EditorService} (плюс
 * {@link EditorGroupComponent} как view группы) + {@link ExtensionHost},
 * оборачивает в {@link TestApp} (через body вокруг view группы), опционально
 * открывает файл и регистрирует расширения.
 *
 * Расширения регистрируются (bookkeeping), затем харнесс фаерит события
 * активации (`activateEvents`, по умолчанию `["*"]`) — каждое `activateByEvent`
 * ждёт завершения `activate()` и RPC-вызовов внутри него.
 */
export async function createExtensionTestHarness(options: IExtensionHarnessOptions = {}): Promise<IExtensionHarness> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-ext-"));

    const themeService = new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme));
    const configurationService = options.configurationService ?? NULL_CONFIGURATION_SERVICE;
    const undoRedoService = new UndoRedoService();
    // Реестры языковых провайдеров — общие у группы (on-save участники) и
    // адаптера host'а, как один DI-синглтон в extensionHostModule.
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
    const groupComponent = new EditorGroupComponent(group.activeGroup, group, createTestContextMenuService());

    // Настоящий исполнитель `workspace.applyEdit` — зеркально extensionHostModule:
    // правки по закрытым файлам ложатся на диск, по открытым — в их буферы, и
    // весь edit остаётся одним шагом общей истории (`undoRedoService`).
    const workspaceEditService = new WorkspaceEditService(
        undoRedoService,
        new TrashService(),
        configurationService,
        new BulkEditBuffers(group),
        diskFileService(),
    );
    const adapter = new EditorOptionsServiceAdapter(group, workspaceEditService);
    const commandRegistry = new CommandRegistry();
    const commandAdapter = new CommandServiceAdapter(commandRegistry);
    // `IWorkspaceFolderInfo.uri` — настоящий uri, как в extensionHostModule:
    // хост читает из него путь папки (`workspaceContains:`), а субпроцесс —
    // `WorkspaceFolder.uri`. Опция харнесса при этом принимает ПУТЬ, потому что
    // тесту удобнее оперировать `tmpDir`.
    const folders = (options.workspaceFolders ?? [tmpDir]).map((folder, index) =>
        typeof folder === "string" ? { uri: Uri.file(folder).toString(), name: path.basename(folder), index } : folder,
    );
    // Дефолты — зеркально main.ts: общий реестр, в который контрибьютор кладёт
    // `contributes.configuration` и курируемые инъекции всех расширений харнесса.
    const configurationRegistry = new ConfigurationRegistry();
    new ExtensionConfigurationContributor(options.extensions ?? [], configurationRegistry, (ext) =>
        curatedConfigInjection(ext.id),
    ).apply();
    configurationRegistry.registerDefaultConfigurations(options.configurationDefaults ?? {});
    const configurationData = {
        defaults: configurationRegistry.getDefaultConfiguration(),
        user: options.configuration ?? {},
    };
    const configuration: IExtensionHostConfigProvider = {
        getSnapshot: () => configurationData,
        getWorkspaceFolders: () => folders,
        onDidChange: () => ({ dispose: () => undefined }),
    };
    // Полоса групп — зеркально extensionHostModule (правило двух сим-точек).
    const editorLayout = new EditorLayoutServiceAdapter(group);
    // Каталоги хранения расширений — зеркально extensionHostModule, но корни
    // внутри tmpDir харнесса: тест не должен писать в user-data машины.
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
        ...(options.progressSink !== undefined ? { progressSink: options.progressSink } : {}),
        ...(options.outputSink !== undefined ? { outputSink: options.outputSink } : {}),
        ...(options.statusBarItemSink !== undefined ? { statusBarItemSink: options.statusBarItemSink } : {}),
        ...(options.quickInputSink !== undefined ? { quickInputSink: options.quickInputSink } : {}),
        ...(options.editorDecorations !== undefined ? { editorDecorations: options.editorDecorations } : {}),
        ...(options.fileDecorations !== undefined ? { fileDecorations: options.fileDecorations } : {}),
        // Дефолт — настоящий адаптер поверх `themeService` харнесса (зеркально
        // extensionHostModule): `harness.themeService.setTheme(...)` доезжает до
        // расширения как `window.onDidChangeActiveColorTheme`.
        themeColorResolver: options.themeColorResolver ?? new ThemeColorResolverAdapter(themeService),
        ...(options.fileWatcher !== undefined ? { fileWatcher: options.fileWatcher } : {}),
        ...(options.secrets !== undefined ? { secrets: options.secrets } : {}),
        ...(options.extensionState !== undefined ? { extensionState: options.extensionState } : {}),
        ...(options.workspaceScanner !== undefined ? { workspaceScanner: options.workspaceScanner } : {}),
    });

    // Языковые провайдеры (languages.register) → прокси в реестрах ядра — как в extensionHostModule.
    new LanguageFeaturesAdapter(host, languageFeatures);
    // Save-pipeline (WP6): проброс will-save/did-save между группой и хостом.
    group.saveParticipant = (snapshot) => host.willSaveTextDocument(snapshot);
    group.onEditorSaved((meta) => {
        host.didSaveTextDocument(meta);
    });
    // Document sync (LSP): продюсер didOpen/didChange — как в extensionHostModule.
    bindDocumentSync(group, host);
    // Содержимое недисковых ресурсов (registerTextDocumentContentProvider) — как
    // в extensionHostModule: по нему открываются read-only вкладки `jdt:`/`class:`.
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
    // Активация теперь событийная: фаерим согласованные события (по умолчанию
    // `*` — eager, как раньше). Последовательно — каждый activateByEvent ждёт
    // завершения activate() и внутренних RPC.
    for (const event of options.activateEvents ?? ["*"]) {
        await host.activateByEvent(event);
    }

    const dispose = async (): Promise<void> => {
        host.dispose();
        // ExtensionHost.dispose стартует асинхронный shutdownSubprocess(); ждём
        // короткое окно, чтобы дать ему успеть отправить host.shutdown и
        // дочерний процесс корректно завершился.
        await new Promise((resolve) => setTimeout(resolve, 100));
        groupComponent.dispose();
        group.dispose();
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    };

    return { app, host, group, languageFeatures, themeService, commandRegistry, tmpDir, writeFile, flushRpc, dispose };
}

/**
 * Hover'ы для запроса так, как их собирает `HoverService`: подошедшие документу
 * провайдеры реестра харнесса, склейка в порядке `ordered`.
 */
export function provideHovers(harness: IExtensionHarness, request: IHoverRequest): Promise<ICoreHover[]> {
    return getHovers(harness.languageFeatures.hoverProvider, targetOf(request), request);
}

/** Цели definition так, как их собирает `DefinitionService` (реестр харнесса). */
export function provideDefinitions(
    harness: IExtensionHarness,
    request: IDefinitionRequest,
): Promise<ICoreDefinitionLocation[]> {
    return getDefinitions(harness.languageFeatures.definitionProvider, targetOf(request), request);
}

/** Ссылки так, как их собирает `ReferencesService` (реестр харнесса). */
export function provideReferences(harness: IExtensionHarness, request: IReferenceRequest): Promise<ICoreReference[]> {
    return getReferences(harness.languageFeatures.referenceProvider, targetOf(request), request);
}

/** Подсказка параметров так, как её собирает `ParameterHintsService` (реестр харнесса). */
export function provideSignatureHelp(
    harness: IExtensionHarness,
    request: ISignatureHelpRequest,
): Promise<ICoreSignatureHelp | null> {
    return provideSignatureHelpFrom(harness.languageFeatures.signatureHelpProvider.ordered(targetOf(request)), request);
}

/**
 * Триггер- и ретриггер-символы подсказки параметров для документа — то, что
 * `ParameterHintsService` видит у подошедших провайдеров (объединение, без
 * повторов, в порядке `ordered`).
 */
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

/** Автодополнения так, как их собирает `CompletionService` (без word-based пунктов). */
export async function provideCompletions(
    harness: IExtensionHarness,
    request: ICompletionRequest,
): Promise<ICoreCompletionResult> {
    const providers = harness.languageFeatures.completionProvider.ordered(targetOf(request));
    const { items, isIncomplete } = await provideCompletionsFrom(providers, request);
    return { items, isIncomplete };
}

/** Триггер-символы completion для документа — объединение по подошедшим провайдерам. */
export function completionTriggerCharacters(
    harness: IExtensionHarness,
    document: { readonly uri: string; readonly languageId: string },
): string[] {
    const providers = harness.languageFeatures.completionProvider.ordered(targetOf(document));
    return [...new Set(providers.flatMap((provider) => provider.triggerCharacters))];
}

/**
 * Правки форматирования так, как их собирают команды Format Document/Selection
 * (`editor/contrib/format`): `null` — форматтера для документа нет.
 */
export function formatDocumentFor(
    harness: IExtensionHarness,
    request: IFormattingRequest,
): Promise<readonly ITextEdit[] | null> {
    const { range } = request;
    return range === undefined
        ? formatDocument(harness.languageFeatures, targetOf(request), request)
        : formatRange(harness.languageFeatures, targetOf(request), { ...request, range });
}

/** Code actions так, как их собирают команды (`editor/contrib/codeAction`). */
export async function provideCodeActions(
    harness: IExtensionHarness,
    request: ICodeActionRequest,
): Promise<readonly ICoreCodeAction[]> {
    const items = await getCodeActions(harness.languageFeatures.codeActionProvider, targetOf(request), request);
    return items.map((item) => item.action);
}

/** Области сворачивания от провайдеров так, как их собирает `EditorComponent`. */
export function provideFoldingRegions(harness: IExtensionHarness, request: IFoldingRequest): Promise<IFoldingRegion[]> {
    return provideFoldingRanges(harness.languageFeatures.foldingRangeProvider.ordered(targetOf(request)), request);
}

/** Инлайн-подсказки так, как их собирает `InlineCompletionsService`. */
export function provideInlineCompletions(
    harness: IExtensionHarness,
    request: IInlineCompletionRequest,
    token: ICancellationToken = CancellationTokenNone,
): Promise<ICoreInlineCompletionItem[]> {
    const providers = harness.languageFeatures.inlineCompletionsProvider.ordered(targetOf(request));
    return provideInlineCompletionsFrom(providers, request, token);
}

/** Документ запроса как цель скоринга реестра. */
function targetOf(request: { readonly uri: string; readonly languageId: string }): ILanguageFeatureTarget {
    return { uri: Uri.parse(request.uri), languageId: request.languageId };
}
