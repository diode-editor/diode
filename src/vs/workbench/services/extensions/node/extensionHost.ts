import * as path from "node:path";

import {
    CancellationTokenNone,
    CancellationTokenSource,
    type ICancellationToken,
} from "../../../../base/common/cancellation.ts";
import { renderCodicons } from "../../../../base/common/codicons.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { matchGlob } from "../../../../base/common/glob.ts";
import { Disposable, DisposableStore, type IDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { withCursorChangeSource } from "../../../../editor/common/core/cursorChangeSource.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
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
import type { IGutterChangeDecoration } from "../../../../editor/common/model/iGutterChangeDecoration.ts";
import type { IFoldingRegion } from "../../../../editor/contrib/folding/iFoldingRegion.ts";
import type { IClipboard } from "../../../../platform/clipboard/common/iClipboard.ts";
import type { IConfigurationData } from "../../../../platform/configuration/common/iConfigurationService.ts";
import type { ITreeFileChange } from "../../../../platform/files/common/iTreeFileWatcher.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import {
    type IEditorDecorationsService,
    NULL_EDITOR_DECORATIONS_SERVICE,
} from "../../../api/common/iEditorDecorationsService.ts";
import { type IEditorLayoutService, NULL_EDITOR_LAYOUT_SERVICE } from "../../../api/common/iEditorLayoutService.ts";
import type { IEditorOptionsPatch, IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { type IExtensionFileWatcher, NULL_EXTENSION_FILE_WATCHER } from "../../../api/common/iExtensionFileWatcher.ts";
import {
    type IFileDecorationsService,
    NULL_FILE_DECORATIONS_SERVICE,
} from "../../../api/common/iFileDecorationsService.ts";
import { type IThemeColorResolver, NULL_THEME_COLOR_RESOLVER } from "../../../api/common/iThemeColorResolver.ts";
import type { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";
import type { IWireLanguageProviderRegistration } from "../../../api/common/wireTypes.ts";
import {
    type IWireColorTheme,
    type IWireDocumentSyncSnapshot,
    type IWireExtensionCatalog,
    type IWireExtensionDescription,
    type IWireInputBoxRequest,
    type IWireQuickPickRequest,
    type IWireShowMessageRequest,
    type IWireStatusBarItem,
    type IWireValidationMessage,
    type IWireWatcherCreate,
    type IWireWatcherEvent,
    parseDecorationRanges,
    parseWireApplyWorkspaceEditParams,
    parseWireCloseGroupsParams,
    parseWireCloseTabsParams,
    parseWireEditorEdits,
    parseWireFileDecorations,
    parseWireLanguageProviderRegistration,
    parseWireLanguageProviderUnregistration,
    parseWireMementoUpdate,
    parseWireReadFileResult,
    parseWireSchemes,
    parseWireSelections,
    parseWireShowTextDocumentParams,
    parseWireTextContentResult,
    parseWireWatcherCreate,
    parseWireWatcherDispose,
    requestApplyCodeAction,
    requestCodeActions,
    requestCompletionItems,
    requestDefinition,
    requestFoldingRanges,
    requestFormattingEdits,
    requestHover,
    requestInlineCompletions,
    requestPrepareRename,
    requestReferences,
    requestRename,
    requestResolveCompletionItem,
    requestSignatureHelp,
    requestWillSaveEdits,
    type SerializedDecorationRenderOptions,
    themeColorIdOf,
    type WireMarker,
    type WireOutputLevel,
} from "../../../api/common/wireTypes.ts";
import {
    hasWorkspaceContainsPatterns,
    type IWorkspaceContainsPatterns,
    readActivationEvents,
    readCommandActivationIds,
    readWorkspaceContainsPatterns,
} from "../common/activationEvents.ts";
import { ProviderRequestBatcher } from "../common/providerRequestBatcher.ts";

import { createInMemoryExtensionSecretStore, type IExtensionSecretStore } from "./extensionSecretsStore.ts";
import { createTransientExtensionStateStore, type IExtensionStateStore } from "./extensionStateStore.ts";
import {
    ensureExtensionStorageParents,
    fallbackExtensionStorageHomes,
    type IExtensionStorageHomes,
    resolveExtensionStoragePaths,
} from "./extensionStoragePaths.ts";
import {
    createNodeWorkspaceScanner,
    type IWorkspaceContainsResult,
    type IWorkspaceScanner,
    matchWorkspaceContains,
} from "./workspaceContainsActivation.ts";

/**
 * Сток диагностик расширений (`diagnostics.publish`): владелец (коллекция),
 * ресурс как `uri.toString()` и его полный набор маркеров (замена, не мерж).
 * Подключается в module/харнессе к `MarkerService.changeOne`.
 */
export type DiagnosticsSink = (owner: string, resource: string, markers: readonly WireMarker[]) => void;

/**
 * Сток прогресса расширений (`window.withProgress` → `window.progress.*`):
 * потребитель (module/харнесс) рисует запись статус-бара на `start`, обновляет
 * на `report` и снимает на `end`. `handle` уникален в рамках subprocess'а.
 */
export interface IProgressSink {
    start(handle: number, title: string): void;
    report(handle: number, message?: string, increment?: number): void;
    end(handle: number): void;
}

import type { IExternalOpener } from "../../externalOpener/common/iExternalOpener.ts";
import type { ISaveEdit, ISaveSnapshot } from "../../textfile/common/iSaveParticipant.ts";
import type { IExtensionHostCustomer } from "../common/extensionHostCustomer.ts";

import { EnvCustomer } from "./customers/envCustomer.ts";
import { SecretsCustomer } from "./customers/secretsCustomer.ts";
import { WindowCustomer } from "./customers/windowCustomer.ts";
import { defaultSpawnArgs, ExtensionHostProcess } from "./extensionHostProcess.ts";
import { extensionRootPath, type IExtensionRegistration } from "./iExtensionEntry.ts";

/**
 * Сток output-каналов расширений (`window.createOutputChannel` →
 * `output.append`/`output.show`): потребитель (module/харнесс) регистрирует
 * канал в реестре Output лениво по label и пишет строку логгером уровня `level`.
 */
export interface IOutputSink {
    append(channel: string, label: string, level: WireOutputLevel, value: string): void;
    show(channel: string, label: string): void;
}

/**
 * Сток пунктов статус-бара расширений (`window.createStatusBarItem` →
 * `window.statusBarItem.*`): потребитель (module/харнесс) держит запись полосы
 * на каждый живой пункт. `update` — upsert полного состояния, `remove` —
 * `hide()`/`dispose()` со стороны расширения, `clear` — субпроцесс умер и его
 * `remove` уже не придёт.
 */
export interface IStatusBarItemSink {
    update(item: IWireStatusBarItem): void;
    remove(handle: number): void;
    clear(): void;
}

/**
 * Сток ввода от расширений (`window.showInputBox` / `window.showQuickPick`):
 * потребитель (module/харнесс) поднимает QuickInput-оверлей приложения и
 * резолвится тем, что человек ввёл/выбрал, либо `undefined` на отмене.
 *
 * `cancel(handle)` закрывает показ извне — токеном отмены расширения или
 * смертью его процесса. Закрытие ОБЯЗАНО довести обещание расширения до
 * `undefined`: иначе команда расширения зависает навсегда и этого ниоткуда
 * не видно.
 */
export interface IQuickInputSink {
    showInputBox(request: IQuickInputBoxRequest): Promise<string | undefined>;
    showQuickPick(request: IWireQuickPickRequest): Promise<readonly number[] | undefined>;
    cancel(handle: number): void;
}

/**
 * Сток сообщений расширений (`window.show{Information,Warning,Error}Message`):
 * потребитель (module/харнесс) показывает их человеку — тостом над статус-баром
 * или, у модального сообщения, диалогом — и резолвится ИНДЕКСОМ нажатой кнопки
 * в `request.items` либо `undefined`, если человек закрыл сообщение не выбрав.
 *
 * Сообщение без кнопок сток обязан резолвить СРАЗУ (выбирать нечего): иначе
 * расширение, сделавшее `await showErrorMessage(...)`, повисло бы на времени
 * жизни тоста, а error-тост сам не гаснет.
 *
 * `cancel(handle)` снимает показ извне — смертью субпроцесса расширений: ответить
 * на сообщение стало некому, а на экране оно осталось бы навсегда.
 */
export interface INotificationSink {
    showMessage(request: INotificationRequest): Promise<number | undefined>;
    cancel(handle: number): void;
}

/**
 * Просьба показать сообщение плюс адрес показа. Адрес минтит ХОСТ, а не
 * расширение: отменять показ своими силами расширение не умеет (у `show*Message`
 * нет токена), а «погасить при смерти субпроцесса» нужно именно хосту.
 */
export interface INotificationRequest extends IWireShowMessageRequest {
    readonly handle: number;
}

/**
 * Просьба показать поле ввода плюс канал валидации: сама валидация живёт в
 * расширении, поэтому сток зовёт её через границу процессов на каждое изменение
 * значения. `undefined` вместо колбэка — у расширения `validateInput` нет.
 */
export interface IQuickInputBoxRequest extends IWireInputBoxRequest {
    readonly validate?: (value: string) => Promise<IWireValidationMessage | null>;
}

export const ExtensionHostDIToken = token<ExtensionHost>("ExtensionHost");

/** Порог, выше которого снапшот документа не гоняется через will-save RPC (8 MB). */
const MAX_WILL_SAVE_TEXT_BYTES = 8 * 1024 * 1024;

/** Ответ «автодополнений нет» — общий для всех ранних выходов completion. */
const EMPTY_COMPLETION_RESULT: ICoreCompletionResult = { items: [], isIncomplete: false };

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
     * Тайм-аут на ответ участника will-save (`workspace.willSaveTextDocument`), мс.
     * По истечении сохранение продолжается без правок расширения. Default: 1500.
     */
    readonly willSaveTimeoutMs?: number;
    /**
     * Тайм-аут на ответ провайдеров автодополнения
     * (`languages.provideCompletionItems`), мс. По истечении completion-UI
     * показывает пустой список. Default: 1500.
     */
    readonly completionTimeoutMs?: number;
    /**
     * Тайм-аут на ответ inline-completion-провайдеров
     * (`languages.provideInlineCompletions`), мс. По истечении призрачная
     * подсказка просто не показывается. Default: 5000 — щедрее completion:
     * за провайдером может стоять холодный LLM-бэкенд.
     */
    readonly inlineCompletionTimeoutMs?: number;
    /**
     * Тайм-аут на ответ провайдеров областей сворачивания
     * (`languages.provideFoldingRanges`), мс. По истечении ядро откатывается на
     * indentation-фолды. Default: 1500.
     */
    readonly foldingTimeoutMs?: number;
    /**
     * Тайм-аут на ответ definition-провайдеров (`languages.provideDefinition`),
     * мс. По истечении Go to Definition остаётся no-op. Default: 5000 — щедрее
     * остальных: холодный language server индексирует проект секундами.
     */
    readonly definitionTimeoutMs?: number;
    /**
     * Тайм-аут на ответ hover-провайдеров (`languages.provideHover`), мс. По
     * истечении hover-попап не открывается. Default: 5000 — как definition:
     * запрос идёт к тому же холодному language server'у.
     */
    readonly hoverTimeoutMs?: number;
    /**
     * Тайм-аут на ответ references-провайдеров (`languages.provideReferences`),
     * мс. По истечении панель Find All References остаётся пустой. Default:
     * 5000 — как definition/hover: тот же холодный language server, а поиск
     * ссылок по проекту у него ещё и дороже одиночного перехода.
     */
    readonly referencesTimeoutMs?: number;
    /**
     * Тайм-аут на ответ провайдеров подсказки параметров
     * (`languages.provideSignatureHelp`), мс. По истечении попап не
     * открывается. Default: 5000 — как hover: тот же холодный language server.
     */
    readonly signatureHelpTimeoutMs?: number;
    /**
     * Тайм-аут на ответ провайдеров форматирования
     * (`languages.provideFormattingEdits`), мс. По истечении команда молча
     * ничего не меняет. Default: 5000 — тот же холодный language server, а
     * формат целого документа дороже точечных запросов.
     */
    readonly formattingTimeoutMs?: number;
    /**
     * Тайм-аут на ответ code-action-провайдеров
     * (`languages.provideCodeActions`), мс. Default: 5000 — тот же холодный
     * language server.
     */
    readonly codeActionsTimeoutMs?: number;
    /**
     * Тайм-аут на ответ `languages.prepareRename`, мс. По истечении ядро
     * считает, что провайдеру сказать нечего, и добирает имя словом под
     * кареткой. Default: 5000 — тот же холодный language server.
     */
    readonly prepareRenameTimeoutMs?: number;
    /**
     * Тайм-аут применения переименования (`languages.provideRenameEdits`), мс.
     * Default: 10000 — как у applyCodeAction: внутри ЕЩЁ два круга RPC (rename
     * до сервера и `workspace.applyEdit` обратно до хоста).
     */
    readonly renameTimeoutMs?: number;
    /**
     * Тайм-аут применения code action (`languages.applyCodeAction`), мс.
     * Default: 10000 — внутри живут ЕЩЁ два круга RPC: ленивый
     * codeAction/resolve до сервера и `workspace.applyEdit` обратно до хоста.
     */
    readonly applyCodeActionTimeoutMs?: number;
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
     * stdio[1] переключается в `"pipe"`; иначе остаётся `"inherit"`.
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
     * «закрыто без выбора» (`undefined`), а не зависает.
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
export class ExtensionHost extends Disposable {
    private readonly editorOptions: IEditorOptionsService;
    private readonly commandService: ICommandService;
    /** Прокси-регистрации команд сабпроцесса в host CommandRegistry (по id). */
    private readonly proxyCommands = new Map<string, IDisposable>();
    /**
     * Заглушки команд под `onCommand:<id>` (id → регистрация в host-реестре).
     * Стоят ВМЕСТО прокси, пока расширение не активировано: исполнение такой
     * команды сперва поднимает расширение, а потом уходит в уже настоящий прокси
     * (см. {@link armCommandActivation}).
     */
    private readonly commandActivationStubs = new Map<string, IDisposable>();
    /** Заголовки команд из contributes.commands (id → title) для видимости в палитре. */
    private readonly commandTitles = new Map<string, string>();
    /** Группы команд из contributes.commands (id → category) — префикс подписи в палитре. */
    private readonly commandCategories = new Map<string, string>();
    private readonly options: Required<
        Pick<
            IExtensionHostOptions,
            | "spawnArgs"
            | "readyTimeoutMs"
            | "shutdownTimeoutMs"
            | "willSaveTimeoutMs"
            | "completionTimeoutMs"
            | "inlineCompletionTimeoutMs"
            | "foldingTimeoutMs"
            | "definitionTimeoutMs"
            | "hoverTimeoutMs"
            | "referencesTimeoutMs"
            | "signatureHelpTimeoutMs"
            | "formattingTimeoutMs"
            | "codeActionsTimeoutMs"
            | "prepareRenameTimeoutMs"
            | "renameTimeoutMs"
            | "applyCodeActionTimeoutMs"
            | "workspaceContainsTimeoutMs"
        >
    >;
    private readonly logger: ILogger | undefined;
    private readonly rpcLogger: ILogger | undefined;
    private readonly stdoutLogger: ILogger | undefined;
    private readonly stderrLogger: ILogger | undefined;
    private readonly configuration: IExtensionHostConfigProvider | undefined;
    private readonly editorDecorations: IEditorDecorationsService;
    private readonly fileDecorations: IFileDecorationsService;
    private readonly themeColorResolver: IThemeColorResolver;
    /** Реестр типов декораций: key → { overviewRulerColorId?, isWholeLine }. Gutter-тип = есть overviewRulerColor. */
    private readonly decorationTypes = new Map<number, { overviewRulerColorId?: string; isWholeLine: boolean }>();
    /** Держимые декорации редактора: uri → (key → ranges). Пере-резолвятся при смене темы. */
    private readonly editorDecorationsByFile = new Map<string, Map<number, readonly IRange[]>>();
    /** Держимые файловые декорации: absPath → { badge?, colorId? }. Пере-резолвятся при смене темы. */
    private readonly fileDecorationState = new Map<string, { badge?: string; colorId?: string }>();
    private readonly extensions = new Set<string>();
    /** Регистрации уже активированных расширений (нужны для оживления после смерти субпроцесса). */
    private readonly activatedRegistrations = new Map<string, IExtensionRegistration>();
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
    /** Активации в полёте (id → регистрация и промис): их ждут и соседние вызовы. */
    private readonly activating = new Map<string, { reg: IExtensionRegistration; done: Promise<void> }>();
    /**
     * Зарегистрированные, но ещё не активированные расширения (id → reg).
     * Заполняется `registerExtension`, опустошается `activateByEvent` по мере
     * наступления событий активации. Ленивость: пока reg здесь, subprocess под
     * него не поднимается.
     */
    private readonly pending = new Map<string, IExtensionRegistration>();
    /** Текущий субпроцесс: spawn, канал, выключение (см. {@link ExtensionHostProcess}). */
    private process: ExtensionHostProcess | null = null;
    private rpc: RpcEndpoint | null = null;
    private readyPromise: Promise<void> | null = null;
    /**
     * Подписки одного спавна субпроцесса (на события ядра, которые шлют ему
     * нотификации). Наполняет {@link installHostHandlers}, а
     * {@link resetSubprocessState} снимает целиком и заводит чистый для
     * следующего спавна: иначе каждый респавн копил бы вечных слушателей,
     * шлющих в мёртвый канал.
     */
    private spawnStore = new DisposableStore();
    /** Поверхности API, вынесенные из хоста (G1); подключаются на каждый спавн. */
    private readonly customers: readonly IExtensionHostCustomer[];
    private hostDisposed = false;
    /** Прощание с субпроцессом, начатое {@link dispose}: его ждёт {@link shutdown}. */
    private shutdownDone: Promise<void> = Promise.resolve();
    /** Субпроцесс, которого вежливо попросили выйти, а он ещё не вышел (см. {@link disposeNow}). */
    private exitingProcess: ExtensionHostProcess | null = null;
    /** Есть ли в субпроцессе активные подписки на will/did-save (см. `workspace.updateSubscriptions`). */
    private willSaveSubscribed = false;
    private didSaveSubscribed = false;
    /** Есть ли в субпроцессе подписки document sync (onDidOpen/onDidChangeTextDocument). */
    private documentSyncSubscribed = false;
    /**
     * Коалесинг didChange в пределах тика (latest-wins ПО ДОКУМЕНТУ) — правка на
     * каждое нажатие не гоняет RPC-шторм. Map, а не один слот: с per-document
     * sync два документа, изменившиеся в один тик (bulk-правки), потеряли бы
     * одно из сообщений.
     */
    private readonly pendingDidChange = new Map<string, IWireDocumentSyncSnapshot>();
    private readonly openDocumentsProvider: (() => IWireDocumentSyncSnapshot[]) | undefined;
    private readonly editorLayout: IEditorLayoutService;
    private readonly fileWatcher: IExtensionFileWatcher;
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
    /**
     * ВСЕ известные хосту регистрации в порядке появления — источник каталога
     * `vscode.extensions`. Отдельно от `pending`/`activatedRegistrations`: те
     * описывают фазу жизненного цикла и по ходу дела перекладывают записи
     * между собой, а состав каталога от фазы не зависит.
     */
    private readonly registrations = new Map<string, IExtensionRegistration>();
    /** Живые watcher'ы субпроцесса (`workspace.createFileSystemWatcher`) по id. */
    private readonly fileWatchers = new Map<number, IDisposable>();
    /** Схемы, для которых субпроцесс держит FileSystemProvider'ы. */
    private fileSystemSchemesValue: readonly string[] = [];
    private readonly onFileSystemProvidersChangedEmitter = this.register(new Emitter<void>());
    private readonly onDidChangeProvidedFileEmitter = this.register(new Emitter<readonly Uri[]>());
    /** Схемы, для которых субпроцесс держит TextDocumentContentProvider'ы (`jdt:`, `class:`). */
    // Stryker disable next-line ArrayDeclaration: начальный список наблюдаем только через `hasTextContentProvider(scheme)`, а мутант подкладывает в него строку, которая схемой ресурса не бывает — отличить её от пустого списка нечем
    private textContentSchemesValue: readonly string[] = [];
    private readonly onDidChangeTextContentEmitter = this.register(new Emitter<Uri>());
    /**
     * Языковые провайдеры субпроцесса, переехавшие в реестр ядра (`languages.register`),
     * по handle. Потребитель — `LanguageFeaturesAdapter`.
     */
    private readonly languageProviders = new Map<number, IWireLanguageProviderRegistration>();
    private readonly onLanguageProvidersChangedEmitter = this.register(new Emitter<void>());
    /** Вызовы inline-прокси с одним запросом — одним RPC (см. `provideInlineCompletions`). */
    private readonly inlineCompletionsBatcher = new ProviderRequestBatcher<
        IInlineCompletionRequest,
        readonly ICoreInlineCompletionItem[]
    >((handles, req, token) => this.requestInlineCompletionsBatch(handles, req, token), []);
    /** Вызовы folding-прокси с одним запросом — одним RPC (см. `provideFoldingRanges`). */
    private readonly foldingBatcher = new ProviderRequestBatcher<IFoldingRequest, readonly IFoldingRegion[]>(
        (handles, req) => this.requestFoldingBatch(handles, req),
        [],
    );
    /** Вызовы completion-прокси с одним запросом — одним RPC (см. `provideCompletionItems`). */
    private readonly completionBatcher = new ProviderRequestBatcher<ICompletionRequest, ICoreCompletionResult>(
        (handles, req) => this.requestCompletionBatch(handles, req),
        EMPTY_COMPLETION_RESULT,
    );

    public constructor(
        editorOptions: IEditorOptionsService,
        commandService: ICommandService,
        options: IExtensionHostOptions = {},
    ) {
        super();
        this.editorOptions = editorOptions;
        this.commandService = commandService;
        this.options = {
            spawnArgs: options.spawnArgs ?? defaultSpawnArgs,
            readyTimeoutMs: options.readyTimeoutMs ?? 5000,
            shutdownTimeoutMs: options.shutdownTimeoutMs ?? 1500,
            willSaveTimeoutMs: options.willSaveTimeoutMs ?? 1500,
            completionTimeoutMs: options.completionTimeoutMs ?? 1500,
            inlineCompletionTimeoutMs: options.inlineCompletionTimeoutMs ?? 5000,
            foldingTimeoutMs: options.foldingTimeoutMs ?? 1500,
            definitionTimeoutMs: options.definitionTimeoutMs ?? 5000,
            hoverTimeoutMs: options.hoverTimeoutMs ?? 5000,
            referencesTimeoutMs: options.referencesTimeoutMs ?? 5000,
            signatureHelpTimeoutMs: options.signatureHelpTimeoutMs ?? 5000,
            formattingTimeoutMs: options.formattingTimeoutMs ?? 5000,
            codeActionsTimeoutMs: options.codeActionsTimeoutMs ?? 5000,
            prepareRenameTimeoutMs: options.prepareRenameTimeoutMs ?? 5000,
            renameTimeoutMs: options.renameTimeoutMs ?? 10000,
            applyCodeActionTimeoutMs: options.applyCodeActionTimeoutMs ?? 10000,
            workspaceContainsTimeoutMs: options.workspaceContainsTimeoutMs ?? 7000,
        };
        this.logger = options.logger;
        this.rpcLogger = options.rpcLogger;
        this.stdoutLogger = options.stdoutLogger;
        this.stderrLogger = options.stderrLogger;
        this.configuration = options.configuration;
        this.editorDecorations = options.editorDecorations ?? NULL_EDITOR_DECORATIONS_SERVICE;
        this.fileDecorations = options.fileDecorations ?? NULL_FILE_DECORATIONS_SERVICE;
        this.themeColorResolver = options.themeColorResolver ?? NULL_THEME_COLOR_RESOLVER;
        this.openDocumentsProvider = options.openDocumentsProvider;
        this.editorLayout = options.editorLayout ?? NULL_EDITOR_LAYOUT_SERVICE;
        this.fileWatcher = options.fileWatcher ?? NULL_EXTENSION_FILE_WATCHER;
        this.storageHomes = options.storageHomes ?? fallbackExtensionStorageHomes;
        this.extensionState = options.extensionState ?? createTransientExtensionStateStore();
        this.workspaceScanner = options.workspaceScanner ?? createNodeWorkspaceScanner();
        this.customers = [
            new SecretsCustomer(options.secrets ?? createInMemoryExtensionSecretStore()),
            new EnvCustomer(options.clipboard, options.externalOpener),
            new WindowCustomer({
                diagnosticsSink: options.diagnosticsSink,
                progressSink: options.progressSink,
                outputSink: options.outputSink,
                statusBarItemSink: options.statusBarItemSink,
                quickInputSink: options.quickInputSink,
                notificationSink: options.notificationSink,
            }),
        ];
        // Смена темы → пере-резолв держимых декораций в обе поверхности + новая
        // тема расширениям (`window.onDidChangeActiveColorTheme`).
        this.register(
            this.themeColorResolver.onDidChange(() => {
                this.repushAllDecorations();
                this.pushActiveColorTheme();
            }),
        );
    }

    /**
     * Запоминает регистрацию расширения (bookkeeping) — subprocess НЕ поднимается.
     * Реальная активация происходит лениво в {@link activateByEvent}, когда
     * наступает событие из `reg.activationEvents`. Заголовки команд регистрируем
     * сразу: команда расширения должна быть видна в палитре ещё до активации —
     * и, вместе с заголовком, заглушку-активатор на каждый `onCommand:<id>`
     * (см. {@link armCommandActivation}), иначе видимая команда была бы no-op.
     */
    public registerExtension(reg: IExtensionRegistration): IDisposable {
        if (this.hostDisposed) throw new Error("ExtensionHost disposed");
        if (this.extensions.has(reg.id) || this.pending.has(reg.id)) {
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
        if (reg.commandTitles !== undefined) {
            for (const [id, title] of Object.entries(reg.commandTitles)) {
                this.commandTitles.set(id, renderCodicons(title));
            }
        }
        if (reg.commandCategories !== undefined) {
            for (const [id, category] of Object.entries(reg.commandCategories)) {
                this.commandCategories.set(id, renderCodicons(category));
            }
        }
        this.pending.set(reg.id, reg);
        this.registrations.set(reg.id, reg);
        // ПОСЛЕ pending: заглушка исполняется асинхронно и обязана найти
        // расширение в очереди, когда до неё дойдёт активация.
        for (const id of readCommandActivationIds(reg)) this.armCommandActivation(id);
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
                if (!this.registrations.delete(reg.id)) return;
                this.pushExtensionCatalog();
                // Заглушки-активаторы снятого расширения: команды больше некому
                // поднимать, и в палитре им висеть не за что. Кроме тех, что
                // объявляет ещё кто-то: id бывает общим, и чужую дверь снятие
                // соседа захлопывать не должно.
                for (const id of readCommandActivationIds(reg)) {
                    if (!this.isCommandActivationClaimed(id)) this.disarmCommandActivation(id);
                }
                if (this.pending.delete(reg.id)) return; // ещё не активировано (или ждёт оживления)
                // Осталась одна фаза — активное расширение; собственный гард
                // на это держит сам unregisterExtension, второго не надо.
                void this.unregisterExtension(reg.id);
            },
        };
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
        for (const reg of this.registrations.values()) {
            extensions.push({
                id: reg.id,
                extensionPath: extensionRootPath(reg),
                packageJSON: reg.manifest,
                isActive: this.extensions.has(reg.id),
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
        return [...this.pending.values()].filter((reg) =>
            readActivationEvents(reg).some((event) => events.includes(event)),
        );
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
        for (const reg of this.pending.values()) {
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

    private activateRegistration(rpc: RpcEndpoint, reg: IExtensionRegistration, reason: string): Promise<void> {
        // Guard на случай, если параллельная активация уже занялась им: тот
        // вызов и дождётся (см. `activating`).
        if (!this.pending.delete(reg.id)) return this.activating.get(reg.id)?.done ?? Promise.resolve();
        // Stryker disable next-line BlockStatement: гигиена — ждать завершённую (уже резолвленную) активацию мгновенно, а заново она встаёт в карту поверх старой записи; наблюдаемой разницы нет
        const done = this.requestActivation(rpc, reg, reason).finally(() => {
            // Stryker disable next-line CallExpression: см. выше
            this.activating.delete(reg.id);
        });
        this.activating.set(reg.id, { reg, done });
        return done;
    }

    private async requestActivation(rpc: RpcEndpoint, reg: IExtensionRegistration, reason: string): Promise<void> {
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
            this.extensions.add(reg.id);
            this.activatedRegistrations.set(reg.id, reg);
            // Точечно, а не целым каталогом: манифесты тяжёлые (у языковых
            // серверов package.json со схемой настроек — сотни килобайт), а
            // меняется здесь ровно один флаг.
            rpc.notify("extensions.activated", { id: reg.id });
        } catch (err) {
            // Субпроцесс умер, пока шла активация: запрос оборван вместе с его
            // каналом. Расширение тут ни при чём — возвращаем его к оживлению
            // вместе с остальными активными (если его за это время не сняли).
            if (rpc !== this.rpc && this.registrations.get(reg.id) === reg) {
                this.pending.set(reg.id, reg);
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

    /**
     * Ставит заглушку-активатор на команду `id`: до активации расширения
     * команда уже есть в host-реестре (значит видна в палитре и исполнима по
     * id), а её исполнение СНАЧАЛА поднимает расширение и только потом уходит в
     * настоящий прокси. Без ожидания активации команда не нашлась бы: реальный
     * прокси заводит сам субпроцесс в `commands.registerCommand`.
     *
     * Настоящий прокси заглушкой не затирается: если команда уже живая (её
     * зарегистрировало активное расширение), ставить поверх нечего.
     */
    private armCommandActivation(id: string): void {
        if (this.proxyCommands.has(id) || this.commandActivationStubs.has(id)) return;
        const event = `onCommand:${id}`;
        this.commandActivationStubs.set(
            id,
            this.commandService.registerProxy(
                id,
                async (args): Promise<unknown> => {
                    try {
                        await this.activateByEvent(event);
                    } catch (err) {
                        // Провал хоста (subprocess не поднялся) гасим здесь:
                        // вызывающие команду (палитра, бинд) результат не ждут,
                        // и reject ушёл бы в unhandledRejection главного процесса.
                        this.logger?.error(`failed to activate extension for command "${id}"`, err);
                        return undefined;
                    }
                    // Расширение поднялось, но команду не завело (ошибка в
                    // `activate()`, опечатка в манифесте) — исполнять нечего, и
                    // зваться повторно через заглушку тоже: получилась бы петля.
                    if (!this.proxyCommands.has(id)) {
                        this.logger?.warn(`command "${id}" is still unregistered after activation`);
                        return undefined;
                    }
                    return this.commandService.execute(id, args);
                },
                this.commandTitles.get(id),
                this.commandCategories.get(id),
            ),
        );
    }

    /** Снимает заглушку-активатор команды (расширение активировалось или снято). */
    private disarmCommandActivation(id: string): void {
        this.commandActivationStubs.get(id)?.dispose();
        this.commandActivationStubs.delete(id);
    }

    /** Объявляет ли команду `id` хоть одна из оставшихся регистраций. */
    private isCommandActivationClaimed(id: string): boolean {
        for (const reg of this.registrations.values()) {
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
        if (!this.extensions.has(id)) return;
        this.extensions.delete(id);
        this.activatedRegistrations.delete(id);
        // Каталог трогаем только если запись и правда ушла: снятие может
        // прийти вторым заходом (сначала disposable регистрации), и лишнего
        // `extensions.catalog` субпроцессу слать не за что.
        if (this.registrations.delete(id)) this.pushExtensionCatalog();
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
     * Запрашивает у субпроцесса правки will-save (`onWillSaveTextDocument`).
     * Возвращает `[]`, если субпроцесса нет, никто не подписан, документ слишком
     * большой или расширение не ответило за `willSaveTimeoutMs`. Подключается в
     * `EditorService.saveParticipant` (wiring в module/харнессе).
     */
    public async willSaveTextDocument(snapshot: ISaveSnapshot): Promise<readonly ISaveEdit[]> {
        const rpc = this.rpc;
        if (rpc === null || !this.willSaveSubscribed) return [];
        // Guard: очень большой документ не гоняем через RPC (арх-решение плана).
        /* v8 ignore start -- защитный лимит на снапшот 8 МБ; открытие такого файла в редакторе неподъёмно для unit-теста */
        if (snapshot.text.length > MAX_WILL_SAVE_TEXT_BYTES) {
            this.logger?.warn("skipping will-save participant: document too large", {
                uri: snapshot.uri,
                length: snapshot.text.length,
            });
            return [];
        }
        /* v8 ignore stop */
        return requestWillSaveEdits(
            (method, params) => rpc.request(method, params),
            {
                uri: snapshot.uri,
                languageId: snapshot.languageId,
                version: snapshot.versionId,
                isDirty: snapshot.isDirty,
                text: snapshot.text,
                reason: 1, // TextDocumentSaveReason.Manual
                eol: snapshot.eol,
                encoding: snapshot.encoding,
            },
            this.options.willSaveTimeoutMs,
        );
    }

    /**
     * Уведомляет субпроцесс о состоявшемся сохранении (`onDidSaveTextDocument`).
     * No-op, если субпроцесса нет или никто не подписан.
     */
    public didSaveTextDocument(meta: { uri: string; languageId: string }): void {
        const rpc = this.rpc;
        if (rpc === null || !this.didSaveSubscribed) return;
        rpc.notify("workspace.didSaveTextDocument", meta);
    }

    /**
     * Пушит открытие документа в subprocess (`editor.didOpen`) — там пополняется
     * `workspace.textDocuments` и фаерится `onDidOpenTextDocument`, на которое
     * подписан document sync стокового vscode-languageclient. Подпиской НЕ
     * гейтится (в отличие от didChange): `workspace.textDocuments` обязан нести
     * полный текст активного документа ещё ДО активации клиента — стоковый
     * languageclient на `start()` рассылает серверу didOpen для всех документов
     * реестра, и meta-обёртка с пустым текстом отравила бы сервер. No-op без
     * subprocess'а и для слишком больших документов.
     */
    public didOpenTextDocument(snapshot: IWireDocumentSyncSnapshot): void {
        const rpc = this.rpc;
        if (rpc === null || this.extensions.size === 0) return;
        if (!this.fitsDocumentSyncLimit(snapshot)) return;
        rpc.notify("editor.didOpen", snapshot);
    }

    /**
     * Пушит изменение документа (`editor.didChange` → `onDidChangeTextDocument`).
     * Снапшоты коалесируются в пределах тика (latest-wins): многошаговая правка
     * даёт одну нотификацию с последним текстом, версии остаются монотонными.
     */
    public didChangeTextDocument(snapshot: IWireDocumentSyncSnapshot): void {
        const rpc = this.documentSyncRpc(snapshot);
        if (rpc === null) return;
        const alreadyScheduled = this.pendingDidChange.size > 0;
        this.pendingDidChange.set(snapshot.uri, snapshot);
        if (alreadyScheduled) return;
        queueMicrotask(() => {
            const pending = [...this.pendingDidChange.values()];
            this.pendingDidChange.clear();
            for (const item of pending) {
                rpc.notify("editor.didChange", item);
            }
        });
    }

    /**
     * Пушит закрытие документа (`editor.didClose` → `onDidCloseTextDocument` +
     * сброс didOpen-дедупа в субпроцессе). Не гейтится подпиской — симметрично
     * didOpen: bookkeeping открытых документов у реестра всегда честный.
     */
    public didCloseTextDocument(uri: string): void {
        const rpc = this.rpc;
        if (rpc === null || this.extensions.size === 0) return;
        this.pendingDidChange.delete(uri);
        rpc.notify("editor.didClose", { uri });
    }

    /**
     * Гейт didChange: возвращает rpc, если subprocess жив, подписка document
     * sync есть и документ подъёмный; иначе `null` (no-op).
     */
    private documentSyncRpc(snapshot: IWireDocumentSyncSnapshot): RpcEndpoint | null {
        const rpc = this.rpc;
        if (rpc === null || !this.documentSyncSubscribed) return null;
        if (!this.fitsDocumentSyncLimit(snapshot)) return null;
        return rpc;
    }

    /** Защитный лимит на снапшот document sync (8 МБ). */
    private fitsDocumentSyncLimit(snapshot: IWireDocumentSyncSnapshot): boolean {
        if (snapshot.text.length <= MAX_WILL_SAVE_TEXT_BYTES) return true;
        this.logger?.warn("skipping document sync: document too large", {
            uri: snapshot.uri,
            length: snapshot.text.length,
        });
        return false;
    }

    /**
     * Запрашивает у completion-провайдера субпроцесса `handle` элементы
     * автодополнения для позиции курсора (`languages.provideCompletionItems`).
     * Пустой результат, если субпроцесса нет, документ слишком большой или
     * расширение не ответило за `completionTimeoutMs`. Зовёт его прокси из
     * реестра ядра (`LanguageFeaturesAdapter`); вызовы прокси с одним запросом
     * уходят одним RPC (`ProviderRequestBatcher` — полный текст документа не
     * множится на число провайдеров).
     */
    public provideCompletionItems(handle: number, req: ICompletionRequest): Promise<ICoreCompletionResult> {
        return this.completionBatcher.call(handle, req);
    }

    private async requestCompletionBatch(
        handles: readonly number[],
        req: ICompletionRequest,
    ): Promise<readonly ICoreCompletionResult[]> {
        const rpc = this.rpc;
        // Stryker disable next-line ConditionalExpression,ArrayDeclaration: `rpc` обнуляется только в resetSubprocessState, который тем же блоком снимает регистрации, а с ними и прокси в реестре — пара «канала нет, а прокси зовут» недостижима; проверка стоит защитой от обращения к мёртвому каналу
        if (rpc === null) return [];
        /* v8 ignore start -- защитный лимит на снапшот 8 МБ; открытие такого файла в редакторе неподъёмно для unit-теста */
        if (req.text.length > MAX_WILL_SAVE_TEXT_BYTES) {
            this.logger?.warn("skipping completion: document too large", {
                uri: req.uri,
                length: req.text.length,
            });
            // Stryker disable next-line ArrayDeclaration: см. v8 ignore выше — ветку юнит не достаёт
            return [];
        }
        /* v8 ignore stop */
        return requestCompletionItems(
            (method, params) => rpc.request(method, params),
            {
                handles,
                uri: req.uri,
                languageId: req.languageId,
                text: req.text,
                line: req.line,
                character: req.character,
                ...(req.triggerKind !== undefined ? { triggerKind: req.triggerKind } : {}),
                ...(req.triggerCharacter !== undefined ? { triggerCharacter: req.triggerCharacter } : {}),
            },
            this.options.completionTimeoutMs,
        );
    }

    /**
     * Догружает detail/documentation/additionalTextEdits пункта автодополнения
     * (`languages.resolveCompletionItem`). У стокового LSP-стека это ЕДИНСТВЕННЫЙ
     * путь к описанию и авто-импорту: `typescript-language-server` присылает их
     * не в списке, а по запросу выбранного пункта. `null` — резолвить нечего или
     * расширение не ответило за `completionTimeoutMs`. `id` уникален сквозь
     * провайдеров: кэш субпроцесса сам знает, чей это пункт.
     */
    public async resolveCompletionItem(id: string): Promise<ICoreResolvedCompletion | null> {
        const rpc = this.rpc;
        // Stryker disable next-line ConditionalExpression: см. requestCompletionBatch — без канала прокси уже сняты из реестра
        if (rpc === null) return null;
        return requestResolveCompletionItem(
            (method, params) => rpc.request(method, params),
            id,
            this.options.completionTimeoutMs,
        );
    }

    /**
     * Запрашивает у inline-провайдера субпроцесса `handle` подсказки для позиции
     * каретки (`languages.provideInlineCompletions`). Возвращает `[]`, если
     * субпроцесса нет, документ слишком большой или расширение не ответило за
     * отпущенный срок. Зовёт его прокси из
     * реестра ядра (`LanguageFeaturesAdapter`); вызовы с одним запросом уходят
     * одним RPC (`ProviderRequestBatcher`, токен отмены — общий у пачки).
     *
     * Срок берётся из САМОГО запроса (`req.timeoutMs` —
     * `editor.inlineSuggest.requestTimeout`), и только в его отсутствие — из
     * `inlineCompletionTimeoutMs` хоста. Асимметрия с остальным семейством
     * таймаутов осознанная: остальные фиксируются при создании хоста, а этот
     * человек правит в settings.json и ждёт эффекта без перезапуска.
     */
    public provideInlineCompletions(
        handle: number,
        req: IInlineCompletionRequest,
        token: ICancellationToken = CancellationTokenNone,
    ): Promise<readonly ICoreInlineCompletionItem[]> {
        return this.inlineCompletionsBatcher.call(handle, req, token);
    }

    private async requestInlineCompletionsBatch(
        handles: readonly number[],
        req: IInlineCompletionRequest,
        token: ICancellationToken | undefined,
    ): Promise<readonly (readonly ICoreInlineCompletionItem[])[]> {
        const rpc = this.rpc;
        // Stryker disable next-line ConditionalExpression: `rpc` обнуляется только в resetSubprocessState, который тем же блоком снимает регистрации, а с ними и прокси в реестре — пара «канала нет, а прокси зовут» недостижима; проверка стоит защитой от обращения к мёртвому каналу
        if (rpc === null) return [];
        /* v8 ignore start -- защитный лимит на снапшот 8 МБ; открытие такого файла в редакторе неподъёмно для unit-теста */
        // Stryker disable ConditionalExpression,EqualityOperator,BlockStatement,StringLiteral,ObjectLiteral,OptionalChaining,ArrayDeclaration: 8 МБ снапшот неподъёмен юнитом, см. v8 ignore
        if (req.text.length > MAX_WILL_SAVE_TEXT_BYTES) {
            this.logger?.warn("skipping inline completion: document too large", {
                uri: req.uri,
                length: req.text.length,
            });
            return [];
        }
        // Stryker restore ConditionalExpression,EqualityOperator,BlockStatement,StringLiteral,ObjectLiteral,OptionalChaining,ArrayDeclaration
        /* v8 ignore stop */
        return requestInlineCompletions(
            (method, params, cancellation) => rpc.request(method, params, cancellation),
            {
                handles,
                uri: req.uri,
                languageId: req.languageId,
                text: req.text,
                line: req.line,
                character: req.character,
                triggerKind: req.triggerKind,
            },
            req.timeoutMs ?? this.options.inlineCompletionTimeoutMs,
            token,
        );
    }

    /**
     * Отдаёт области сворачивания folding-провайдера субпроцесса `handle` для
     * документа (`languages.provideFoldingRanges`). Пустой массив, если
     * субпроцесса нет, документ слишком большой или расширение не ответило за
     * `foldingTimeoutMs` — ядро в этом случае остаётся на indentation-фолдах.
     * Зовёт его прокси из реестра ядра (`LanguageFeaturesAdapter`); вызовы с
     * одним запросом уходят одним RPC (`ProviderRequestBatcher`).
     */
    public provideFoldingRanges(handle: number, req: IFoldingRequest): Promise<readonly IFoldingRegion[]> {
        return this.foldingBatcher.call(handle, req);
    }

    private async requestFoldingBatch(
        handles: readonly number[],
        req: IFoldingRequest,
    ): Promise<readonly (readonly IFoldingRegion[])[]> {
        const rpc = this.rpc;
        // Stryker disable next-line ConditionalExpression: `rpc` обнуляется только в resetSubprocessState, который тем же блоком снимает регистрации, а с ними и прокси в реестре — пара «канала нет, а прокси зовут» недостижима; проверка стоит защитой от обращения к мёртвому каналу
        if (rpc === null) return [];
        /* v8 ignore start -- защитный лимит на снапшот 8 МБ; открытие такого файла в редакторе неподъёмно для unit-теста */
        if (req.text.length > MAX_WILL_SAVE_TEXT_BYTES) {
            this.logger?.warn("skipping folding: document too large", {
                uri: req.uri,
                length: req.text.length,
            });
            return [];
        }
        /* v8 ignore stop */
        return requestFoldingRanges(
            (method, params) => rpc.request(method, params),
            {
                handles,
                uri: req.uri,
                languageId: req.languageId,
                text: req.text,
            },
            this.options.foldingTimeoutMs,
        );
    }

    /**
     * Запрашивает у definition-провайдера субпроцесса `handle` цели для позиции
     * курсора (`languages.provideDefinition`). Возвращает `[]`, если субпроцесса
     * нет, документ слишком большой или расширение не ответило за
     * `definitionTimeoutMs`. Зовёт его прокси из реестра ядра
     * (`LanguageFeaturesAdapter`).
     */
    public async provideDefinition(
        handle: number,
        req: IDefinitionRequest,
    ): Promise<readonly ICoreDefinitionLocation[]> {
        const rpc = this.rpc;
        // Stryker disable next-line ConditionalExpression,ArrayDeclaration: `rpc` обнуляется только в resetSubprocessState, который тем же блоком снимает регистрации, а с ними и прокси в реестре — пара «канала нет, а прокси зовут» недостижима; проверка стоит защитой от обращения к мёртвому каналу
        if (rpc === null) return [];
        if (req.text.length > MAX_WILL_SAVE_TEXT_BYTES) {
            this.logger?.warn("skipping definition: document too large", {
                uri: req.uri,
                length: req.text.length,
            });
            return [];
        }
        return requestDefinition(
            (method, params) => rpc.request(method, params),
            {
                handle,
                uri: req.uri,
                languageId: req.languageId,
                text: req.text,
                line: req.line,
                character: req.character,
            },
            this.options.definitionTimeoutMs,
        );
    }

    /**
     * Запрашивает у hover-провайдера субпроцесса `handle` hover для позиции
     * курсора (`languages.provideHover`). Возвращает `undefined`, если
     * субпроцесса нет, документ слишком большой или расширение не ответило за
     * `hoverTimeoutMs`. Зовёт его прокси, который `LanguageFeaturesAdapter`
     * держит в реестре ядра.
     */
    public async provideHover(handle: number, req: IHoverRequest): Promise<ICoreHover | undefined> {
        const rpc = this.rpc;
        // Stryker disable next-line ConditionalExpression: `rpc` обнуляется только в resetSubprocessState, который тем же блоком снимает регистрации, а с ними и прокси в реестре — пара «канала нет, а прокси зовут» недостижима; проверка стоит защитой от обращения к мёртвому каналу
        if (rpc === null) return undefined;
        if (req.text.length > MAX_WILL_SAVE_TEXT_BYTES) {
            this.logger?.warn("skipping hover: document too large", {
                uri: req.uri,
                length: req.text.length,
            });
            return undefined;
        }
        return requestHover(
            (method, params) => rpc.request(method, params),
            {
                handle,
                uri: req.uri,
                languageId: req.languageId,
                text: req.text,
                line: req.line,
                character: req.character,
            },
            this.options.hoverTimeoutMs,
        );
    }

    /**
     * Запрашивает у references-провайдера субпроцесса `handle` ссылки на символ
     * под курсором (`languages.provideReferences`). Возвращает `[]`, если
     * субпроцесса нет, документ слишком большой или расширение не ответило за
     * `referencesTimeoutMs`. Зовёт его прокси из реестра ядра
     * (`LanguageFeaturesAdapter`).
     */
    public async provideReferences(handle: number, req: IReferenceRequest): Promise<readonly ICoreReference[]> {
        const rpc = this.rpc;
        // Stryker disable next-line ConditionalExpression: `rpc` обнуляется только в resetSubprocessState, который тем же блоком снимает регистрации, а с ними и прокси в реестре — пара «канала нет, а прокси зовут» недостижима; проверка стоит защитой от обращения к мёртвому каналу
        if (rpc === null) return [];
        if (req.text.length > MAX_WILL_SAVE_TEXT_BYTES) {
            this.logger?.warn("skipping references: document too large", {
                uri: req.uri,
                length: req.text.length,
            });
            return [];
        }
        return requestReferences(
            (method, params) => rpc.request(method, params),
            {
                handle,
                uri: req.uri,
                languageId: req.languageId,
                text: req.text,
                line: req.line,
                character: req.character,
                includeDeclaration: req.includeDeclaration,
            },
            this.options.referencesTimeoutMs,
        );
    }

    /**
     * Запрашивает у провайдера подсказки параметров `handle` подсказку для
     * позиции каретки (`languages.provideSignatureHelp`). `null`, если
     * субпроцесса нет, документ слишком большой или расширение не ответило за
     * `signatureHelpTimeoutMs`. Зовёт его прокси из реестра ядра
     * (`LanguageFeaturesAdapter`).
     */
    public async provideSignatureHelp(handle: number, req: ISignatureHelpRequest): Promise<ICoreSignatureHelp | null> {
        const rpc = this.rpc;
        // Stryker disable next-line ConditionalExpression: `rpc` обнуляется только в resetSubprocessState, который тем же блоком снимает регистрации, а с ними и прокси в реестре — пара «канала нет, а прокси зовут» недостижима; проверка стоит защитой от обращения к мёртвому каналу
        if (rpc === null) return null;
        if (req.text.length > MAX_WILL_SAVE_TEXT_BYTES) {
            this.logger?.warn("skipping signature help: document too large", {
                uri: req.uri,
                length: req.text.length,
            });
            return null;
        }
        return requestSignatureHelp(
            (method, params) => rpc.request(method, params),
            {
                handle,
                uri: req.uri,
                languageId: req.languageId,
                text: req.text,
                line: req.line,
                character: req.character,
                triggerKind: req.triggerKind,
                // Оба спреда — про чистоту payload'а: `undefined`-ключи всё равно
                // выбрасывает JSON-транспорт RPC, поэтому за границей канала
                // разницы не видно (потому и Stryker disable).
                // Stryker disable next-line ConditionalExpression: см. выше
                ...(req.triggerCharacter === undefined ? {} : { triggerCharacter: req.triggerCharacter }),
                isRetrigger: req.isRetrigger,
                // Stryker disable next-line ConditionalExpression: см. выше
                ...(req.activeSignatureHelp === undefined ? {} : { activeSignatureHelp: req.activeSignatureHelp }),
            },
            this.options.signatureHelpTimeoutMs,
        );
    }

    /**
     * Запрашивает у провайдера форматирования `handle` правки документа (без
     * `req.range` — документный провайдер) или диапазона (с ним — range-провайдер)
     * — `languages.provideFormattingEdits`. Пустой массив — менять нечего,
     * субпроцесса нет, документ слишком большой или таймаут `formattingTimeoutMs`
     * (молчаливый no-op). «Нет форматтера» решает ядро по реестру. Зовёт его
     * прокси из реестра ядра (`LanguageFeaturesAdapter`).
     */
    public async provideFormattingEdits(handle: number, req: IFormattingRequest): Promise<readonly ITextEdit[]> {
        const rpc = this.rpc;
        // Stryker disable next-line ConditionalExpression: `rpc` обнуляется только в resetSubprocessState, который тем же блоком снимает регистрации, а с ними и прокси в реестре — пара «канала нет, а прокси зовут» недостижима; проверка стоит защитой от обращения к мёртвому каналу
        if (rpc === null) return [];
        if (req.text.length > MAX_WILL_SAVE_TEXT_BYTES) {
            this.logger?.warn("skipping formatting: document too large", {
                uri: req.uri,
                length: req.text.length,
            });
            return [];
        }
        return requestFormattingEdits(
            (method, params) => rpc.request(method, params),
            {
                handle,
                uri: req.uri,
                languageId: req.languageId,
                text: req.text,
                tabSize: req.tabSize,
                insertSpaces: req.insertSpaces,
                // Спред — про чистоту payload'а: `undefined`-ключи всё равно
                // выбрасывает JSON-транспорт RPC, поэтому за границей канала
                // разницы не видно.
                // Stryker disable next-line ConditionalExpression: см. выше
                ...(req.range === undefined
                    ? {}
                    : {
                          range: {
                              startLine: req.range.start.line,
                              startCharacter: req.range.start.character,
                              endLine: req.range.end.line,
                              endCharacter: req.range.end.character,
                          },
                      }),
            },
            this.options.formattingTimeoutMs,
        );
    }

    /**
     * Запрашивает у code-action-провайдера `handle` действия для диапазона
     * (`languages.provideCodeActions`). Пустой массив — действий не нашлось,
     * субпроцесса нет, документ слишком большой или таймаут. Зовёт его прокси из
     * реестра ядра (`LanguageFeaturesAdapter`).
     */
    public async provideCodeActions(handle: number, req: ICodeActionRequest): Promise<readonly ICoreCodeAction[]> {
        const rpc = this.rpc;
        // Stryker disable next-line ConditionalExpression: `rpc` обнуляется только в resetSubprocessState, который тем же блоком снимает регистрации, а с ними и прокси в реестре — пара «канала нет, а прокси зовут» недостижима; проверка стоит защитой от обращения к мёртвому каналу
        if (rpc === null) return [];
        if (req.text.length > MAX_WILL_SAVE_TEXT_BYTES) {
            this.logger?.warn("skipping code actions: document too large", {
                uri: req.uri,
                length: req.text.length,
            });
            return [];
        }
        return requestCodeActions(
            (method, params) => rpc.request(method, params),
            {
                handle,
                uri: req.uri,
                languageId: req.languageId,
                text: req.text,
                range: {
                    startLine: req.range.start.line,
                    startCharacter: req.range.start.character,
                    endLine: req.range.end.line,
                    endCharacter: req.range.end.character,
                },
                // Спред — про чистоту payload'а: `undefined`-ключи всё равно
                // выбрасывает JSON-транспорт RPC.
                // Stryker disable next-line ConditionalExpression: см. выше
                ...(req.only === undefined ? {} : { only: req.only }),
            },
            this.options.codeActionsTimeoutMs,
        );
    }

    /**
     * Просит субпроцесс применить закэшированное действие
     * (`languages.applyCodeAction`): ленивый resolve + правки через
     * `workspace.applyEdit` + команда действия — всё на его стороне. `false` —
     * субпроцесса нет, действие протухло, правки не легли или таймаут
     * `applyCodeActionTimeoutMs`. `id` уникален сквозь провайдеров: кэш
     * субпроцесса сам знает, чьё это действие.
     */
    public async applyCodeAction(id: string): Promise<boolean> {
        const rpc = this.rpc;
        // Stryker disable next-line ConditionalExpression: см. provideCodeActions — без канала прокси уже сняты из реестра
        if (rpc === null) return false;
        return requestApplyCodeAction(
            (method, params) => rpc.request(method, params),
            id,
            this.options.applyCodeActionTimeoutMs,
        );
    }

    /**
     * Спрашивает у rename-провайдера `handle` текущее имя символа в позиции
     * каретки (`languages.prepareRename`). `null` — субпроцесса нет, документ
     * слишком большой, провайдеру сказать нечего или он не ответил за
     * `prepareRenameTimeoutMs`; ядро в этом случае спрашивает следующего
     * провайдера, а в конце добирает слово под кареткой само.
     */
    public async prepareRename(handle: number, req: IRenameRequest): Promise<ICoreRenameLocation | null> {
        const rpc = this.rpc;
        // Stryker disable next-line ConditionalExpression: см. provideCodeActions — без канала прокси уже сняты из реестра
        if (rpc === null) return null;
        if (req.text.length > MAX_WILL_SAVE_TEXT_BYTES) {
            this.logger?.warn("skipping prepare rename: document too large", {
                uri: req.uri,
                length: req.text.length,
            });
            return null;
        }
        return requestPrepareRename(
            (method, params) => rpc.request(method, params),
            { handle, ...renameTarget(req) },
            this.options.prepareRenameTimeoutMs,
        );
    }

    /**
     * Просит rename-провайдера `handle` переименовать символ под кареткой
     * (`languages.provideRenameEdits`): вызов провайдера и правки существующим
     * `workspace.applyEdit` — всё на стороне субпроцесса. Отказ С СООБЩЕНИЕМ,
     * если субпроцесса нет, документ слишком большой или расширение не
     * ответило за `renameTimeoutMs`: человек ввёл имя и обязан узнать, что
     * ничего не произошло.
     */
    public async provideRenameEdits(
        handle: number,
        req: IRenameRequest,
        newName: string,
    ): Promise<ICoreRenameResult> {
        const rpc = this.rpc;
        // Stryker disable next-line ConditionalExpression: см. provideCodeActions — без канала прокси уже сняты из реестра
        if (rpc === null) return { applied: false, error: "Rename failed" };
        if (req.text.length > MAX_WILL_SAVE_TEXT_BYTES) {
            this.logger?.warn("skipping rename: document too large", {
                uri: req.uri,
                length: req.text.length,
            });
            return { applied: false, error: "Document too large to rename" };
        }
        return requestRename(
            (method, params) => rpc.request(method, params),
            { handle, ...renameTarget(req), newName },
            this.options.renameTimeoutMs,
        );
    }

    // ─── Языковые провайдеры (мост под ILanguageFeaturesService) ──────────────

    /**
     * Языковые провайдеры, объявленные субпроцессом (`languages.register`).
     * Потребитель — адаптер, регистрирующий их прокси в реестре ядра.
     */
    public getLanguageProviders(): readonly IWireLanguageProviderRegistration[] {
        return [...this.languageProviders.values()];
    }

    /** Состав провайдеров изменился: регистрация, снятие или смерть субпроцесса. */
    public readonly onLanguageProvidersChanged = this.onLanguageProvidersChangedEmitter.event;

    private fireLanguageProvidersChanged(): void {
        this.onLanguageProvidersChangedEmitter.fire();
    }

    // ─── Провайдеры ФС расширений (мост под IFileSystemProviderRegistry) ──────

    /**
     * Схемы, для которых субпроцесс держит `FileSystemProvider`. Потребитель —
     * адаптер, регистрирующий хост поставщиком этих схем в реестре ядра.
     */
    public getFileSystemSchemes(): readonly string[] {
        return this.fileSystemSchemesValue;
    }

    /** Набор схем изменился (расширение зарегистрировало/сняло провайдера). */
    public readonly onFileSystemProvidersChanged = this.onFileSystemProvidersChangedEmitter.event;

    /**
     * Читает недисковый ресурс провайдером субпроцесса. Отклоняется, если host
     * не поднят или провайдер схемы не зарегистрирован — потребитель обязан
     * это пережить (для гуттера «git-расширения нет» — штатная ситуация).
     */
    public async readProvidedFile(uri: Uri): Promise<Uint8Array> {
        const rpc = this.rpc;
        if (rpc === null) throw new Error("extension host is not running");
        return parseWireReadFileResult(await rpc.request("workspace.fs.readFile", { uri: uri.toString() }));
    }

    /** Содержимое ресурсов провайдера изменилось снаружи. */
    public readonly onDidChangeProvidedFile = this.onDidChangeProvidedFileEmitter.event;

    // ─── Провайдеры содержимого недисковых ресурсов (IVirtualDocumentSource) ──

    /**
     * Держит ли субпроцесс `TextDocumentContentProvider` для схемы. Ответ
     * меняется по ходу жизни окна: расширение активируется асинхронно и
     * регистрирует провайдера уже после того, как человек открыл первый файл, —
     * поэтому спрашивать надо в момент открытия ресурса, а не один раз.
     */
    public hasTextContentProvider(scheme: string): boolean {
        return this.textContentSchemesValue.includes(scheme);
    }

    /**
     * Содержимое недискового ресурса от провайдера субпроцесса. `null` —
     * провайдер отказался отдать ресурс. Отклоняется, если host не поднят,
     * схема не зарегистрирована или провайдер бросил: ядру нужна причина, чтобы
     * показать её человеку.
     */
    public async provideTextDocumentContent(uri: Uri): Promise<string | null> {
        const rpc = this.rpc;
        if (rpc === null) throw new Error("extension host is not running");
        return parseWireTextContentResult(
            await rpc.request("workspace.provideTextDocumentContent", { uri: uri.toString() }),
        );
    }

    /** Провайдер объявил, что содержимое недискового ресурса изменилось. */
    public readonly onDidChangeTextContent = this.onDidChangeTextContentEmitter.event;

    public hasExtension(id: string): boolean {
        return this.extensions.has(id);
    }

    public get extensionCount(): number {
        return this.extensions.size;
    }

    public override dispose(): void {
        if (this.hostDisposed) return;
        this.hostDisposed = true;
        this.pending.clear();
        this.extensions.clear();
        // Stryker disable next-line CallExpression: гигиена — после dispose карту уже никто не читает (ожившим некуда вернуться: `pending` пуст и регистраций больше не принимает), наблюдаемой разницы нет
        this.activatedRegistrations.clear();
        // Stryker disable next-line CallExpression: гигиена — каталог после dispose никто не запрашивает (субпроцесса уже нет), наблюдаемой разницы нет
        this.registrations.clear();
        // Заглушки-активаторы живут в ОБЩЕМ реестре команд ядра (как и
        // прокси, см. clearProxyCommands) — после dispose там висели бы записи,
        // которые уже некого поднимать.
        for (const id of [...this.commandActivationStubs.keys()]) this.disarmCommandActivation(id);
        this.disposeFileWatchers();
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

    /** Снимает один watcher субпроцесса (если он есть). */
    private disposeFileWatcher(id: number): void {
        const existing = this.fileWatchers.get(id);
        if (existing === undefined) return;
        existing.dispose();
        this.fileWatchers.delete(id);
    }

    /** Снимает все watcher'ы: субпроцесс умер или host выключается. */
    private disposeFileWatchers(): void {
        for (const subscription of this.fileWatchers.values()) subscription.dispose();
        this.fileWatchers.clear();
    }

    /**
     * Ленивая инициализация subprocess'а. Идемпотентна — параллельные вызовы
     * получают одну и ту же `readyPromise`.
     */
    private async ensureSubprocess(): Promise<RpcEndpoint> {
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
            if (this.configuration !== undefined) {
                rpc.notify("workspace.initialize", {
                    configuration: this.configuration.getSnapshot(),
                    workspaceFolders: this.configuration.getWorkspaceFolders(),
                });
            }
            // Полоса групп — ДО меты активного редактора: `visibleTextEditors`/
            // `tabGroups` обязаны существовать к моменту активации (стоковый
            // languageclient читает их на start()).
            rpc.notify("editor.layoutChanged", this.editorLayout.getLayoutSnapshot());
            // Send initial active editor state so that window.activeTextEditor
            // is correct before the first host.activateExtension call.
            rpc.notify("editor.activeEditorChanged", this.editorOptions.getActiveEditorMeta());
            // Активная тема — тоже ДО первой активации: расширение читает
            // `window.activeColorTheme` уже в `activate()` (так делают все,
            // кто подбирает иконки/цвета под светлую и тёмную).
            this.pushActiveColorTheme();
            // Каталог расширений — тоже ДО первой активации: `getExtension`
            // зовут прямо в `activate()`, детектя соседей (так делают все
            // AI-автодополнения). На оживлении после смерти субпроцесса это же
            // семя возвращает новому субпроцессу и состав, и флаги активности.
            rpc.notify("extensions.catalog", this.extensionCatalog());
            // Наполняем `workspace.textDocuments` открытыми документами ДО первой
            // активации: стоковый vscode-languageclient читает его на start().
            // Мимо гейта подписки — подписчиков в этот момент ещё нет.
            const openDocuments = this.openDocumentsProvider?.() ?? [];
            for (const snapshot of openDocuments) rpc.notify("editor.didOpen", snapshot);
        });
        await this.readyPromise;
        return rpc;
    }

    private installHostHandlers(rpc: RpcEndpoint): void {
        const spawnStore = this.spawnStore;
        // Поверхности, вынесенные в customers: их состояние спавна живёт в
        // attach и уходит вместе со spawnStore.
        for (const customer of this.customers) spawnStore.add(customer.attach({ rpc, logger: this.logger }));
        this.installMementoHandlers(rpc);
        rpc.handleRequest("editor.setOptions", (params): unknown => {
            const patch = sanitizeOptionsPatch(params);
            this.editorOptions.setActiveEditorOptions(patch);
            return null;
        });
        rpc.handleRequest("editor.getOptions", (): unknown => {
            return this.editorOptions.getActiveEditorOptions();
        });
        // Сабпроцесс просит выставить выделения активного редактора
        // (`TextEditor.selection(s) =`). Fire-and-forget со стороны расширения,
        // но обрабатывается в порядке прихода (до последующего executeCommand).
        rpc.handleNotification("editor.setSelection", (params): void => {
            const p = params as { uri?: unknown; selections?: unknown; groupId?: unknown };
            if (typeof p.uri !== "string") return;
            this.editorOptions.setActiveEditorSelections(
                p.uri,
                parseWireSelections(p.selections),
                typeof p.groupId === "number" ? p.groupId : undefined,
            );
        });
        // Сабпроцесс просит применить правки `TextEditor.edit` одним undoable-батчем.
        rpc.handleRequest("editor.applyEdit", (params): unknown => {
            const p = params as { uri?: unknown; edits?: unknown };
            if (typeof p.uri !== "string") return false;
            return this.editorOptions.applyActiveEditorEdits(p.uri, parseWireEditorEdits(p.edits));
        });
        // Сабпроцесс просит применить workspace edit (`workspace.applyEdit`):
        // текстовые правки по ресурсам плюс файловые операции, all-or-nothing
        // по валидации. Мусор в параметрах — честный `false`, а не частичный edit.
        rpc.handleRequest("workspace.applyEdit", async (params): Promise<unknown> => {
            const ops = parseWireApplyWorkspaceEditParams(params);
            if (ops === null) return false;
            return this.editorOptions.applyWorkspaceEdit(ops);
        });
        // Сабпроцесс просит исполнить команду ядра (напр. встроенную
        // editor.action.trimTrailingWhitespace). Нормализуем через Promise —
        // handler ядра может вернуть значение или thenable.
        rpc.handleRequest("commands.executeCommand", (params): unknown => {
            const { id, args } = parseCommandInvocation(params);
            // Источник `command` для смены каретки: команда, сдвинувшая курсор,
            // приедет расширению как `TextEditorSelectionChangeKind.Command`.
            // Область синхронная — команда, двигающая каретку уже после await,
            // отдаст `kind === undefined` (см. cursorChangeSource.ts).
            return Promise.resolve(withCursorChangeSource("command", () => this.commandService.execute(id, args)));
        });
        // Сабпроцесс зарегистрировал команду — заводим прокси в host-реестре,
        // который уводит исполнение обратно в сабпроцесс обратным RPC.
        rpc.handleNotification("commands.registerCommand", (params): void => {
            const id = parseCommandId(params);
            if (id === null) return;
            // Заглушка-активатор отработала (или её никто не трогал) — теперь
            // команду держит настоящий прокси, и ждать активации больше нечего.
            this.disarmCommandActivation(id);
            this.proxyCommands.get(id)?.dispose();
            this.proxyCommands.set(
                id,
                this.commandService.registerProxy(
                    id,
                    (args) => rpc.request("commands.executeCommand", { id, args }),
                    this.commandTitles.get(id),
                    this.commandCategories.get(id),
                ),
            );
        });
        rpc.handleNotification("commands.unregisterCommand", (params): void => {
            const id = parseCommandId(params);
            if (id === null) return;
            this.proxyCommands.get(id)?.dispose();
            this.proxyCommands.delete(id);
        });
        // Полоса групп: снимки по изменениям (коалесинг в адаптере). Инвариант
        // порядка: layoutChanged всегда раньше связанного activeEditorChanged —
        // подписка на layout стоит первой, а мета дополнительно флашит отложенный
        // снимок, чтобы `visibleTextEditors` не отставал от `activeTextEditor`.
        spawnStore.add(
            this.editorLayout.onDidChangeLayout((layout) => {
                rpc.notify("editor.layoutChanged", layout);
            }),
        );
        // `window.showTextDocument`: открыть/активировать ресурс в колонке;
        // ответ уезжает ПОСЛЕ layoutChanged (flush перед reply) — после `await`
        // расширение видит свежий `tabGroups`.
        rpc.handleRequest("editor.showTextDocument", async (params): Promise<unknown> => {
            const parsed = parseWireShowTextDocumentParams(params);
            if (parsed === null) throw new Error("editor.showTextDocument: malformed params");
            const result = await this.editorLayout.showTextDocument(parsed);
            this.editorLayout.flushPendingLayout();
            return result;
        });
        rpc.handleRequest("editor.closeTabs", async (params): Promise<unknown> => {
            const parsed = parseWireCloseTabsParams(params);
            if (parsed === null) throw new Error("editor.closeTabs: malformed params");
            const result = await this.editorLayout.closeTabs(parsed);
            this.editorLayout.flushPendingLayout();
            return result;
        });
        rpc.handleRequest("editor.closeGroups", async (params): Promise<unknown> => {
            const parsed = parseWireCloseGroupsParams(params);
            if (parsed === null) throw new Error("editor.closeGroups: malformed params");
            const result = await this.editorLayout.closeGroups(parsed);
            this.editorLayout.flushPendingLayout();
            return result;
        });
        spawnStore.add(
            this.editorOptions.onActiveEditorChanged((meta) => {
                this.editorLayout.flushPendingLayout();
                rpc.notify("editor.activeEditorChanged", meta);
            }),
        );
        // Движение каретки/смена выделения — отдельным сообщением, чтобы
        // `activeTextEditor.selection` в расширении не залипал на состоянии момента
        // открытия файла. Именно `activeEditorChanged` слать нельзя: он дёргает
        // `onDidChangeActiveTextEditor`, и, например, встроенный git пересчитывал бы
        // статус на каждое нажатие стрелки.
        spawnStore.add(
            this.editorOptions.onActiveEditorSelectionChanged((selections) => {
                rpc.notify("editor.selectionChanged", selections);
            }),
        );
        // Субпроцесс сообщает, есть ли подписчики на will/did-save. Без них хост
        // не гоняет RPC на сохранении (save остаётся синхронным).
        rpc.handleNotification("workspace.updateSubscriptions", (params) => {
            const p = params as { willSave?: unknown; didSave?: unknown; documentSync?: unknown };
            this.willSaveSubscribed = p.willSave === true;
            this.didSaveSubscribed = p.didSave === true;
            // didOpen подпиской не гейтится (см. didOpenTextDocument) — реестр
            // документов субпроцесса всегда несёт полный текст активного, и
            // доталкивать его на переходе подписки не нужно.
            this.documentSyncSubscribed = p.documentSync === true;
        });
        // Языковые провайдеры, переехавшие в реестр ядра: субпроцесс объявляет
        // каждого с handle и селектором, ядро само решает, кого спрашивать.
        rpc.handleNotification("languages.register", (params) => {
            const registration = parseWireLanguageProviderRegistration(params);
            // Stryker disable next-line ConditionalExpression: без проверки null падает на `.handle` до события — RpcEndpoint глотает исключение нотификации, наблюдаемо то же «проигнорировано»
            if (registration === null) return;
            this.languageProviders.set(registration.handle, registration);
            this.fireLanguageProvidersChanged();
        });
        rpc.handleNotification("languages.unregister", (params) => {
            const unregistration = parseWireLanguageProviderUnregistration(params);
            // Stryker disable next-line ConditionalExpression: без проверки null падает на `.handle` до события — RpcEndpoint глотает исключение нотификации, наблюдаемо то же «проигнорировано»
            if (unregistration === null || !this.languageProviders.delete(unregistration.handle)) return;
            this.fireLanguageProvidersChanged();
        });
        // Субпроцесс объявляет схемы, для которых расширения зарегистрировали
        // FileSystemProvider (у встроенного git — `git:`). Ядро по ним читает
        // недисковые ресурсы через IFileSystemProviderRegistry.
        rpc.handleNotification("workspace.fileSystemProvidersChanged", (params) => {
            this.fileSystemSchemesValue = parseWireSchemes(params);
            this.onFileSystemProvidersChangedEmitter.fire();
        });
        // То же для TextDocumentContentProvider'ов (`jdt:`/`class:` у redhat.java):
        // это отдельный реестр — провайдер отдаёт текст, а не байты, и только на
        // чтение. По ним ядро открывает read-only вкладки недисковых ресурсов.
        rpc.handleNotification("workspace.textDocumentContentProvidersChanged", (params) => {
            this.textContentSchemesValue = parseWireSchemes(params);
        });
        // Провайдер объявил, что содержимое ресурса изменилось — открытая вкладка
        // обязана перечитаться (`TextDocumentContentProvider.onDidChange`).
        rpc.handleNotification("workspace.textDocumentContentChanged", (params) => {
            const uri = (params as { uri?: unknown }).uri;
            if (typeof uri !== "string") return;
            this.onDidChangeTextContentEmitter.fire(Uri.parse(uri));
        });
        // Провайдер расширения сообщил, что содержимое ресурсов изменилось
        // (для git: — сдвинулся HEAD/индекс): потребители сбрасывают кэш.
        rpc.handleNotification("workspace.fs.didChangeFile", (params) => {
            const p = params as { uris?: unknown };
            const raw = Array.isArray(p.uris) ? p.uris.filter((u): u is string => typeof u === "string") : [];
            if (raw.length === 0) return;
            const uris = raw.map((u) => Uri.parse(u));
            this.onDidChangeProvidedFileEmitter.fire(uris);
        });
        // Файловые watcher'ы расширений (`workspace.createFileSystemWatcher`).
        // Слежение за деревом ведёт ядро (оно владеет excludes и бюджетом
        // inotify), а матчинг шаблона — здесь: субпроцессу уезжают только
        // подошедшие события, а не весь поток по воркспейсу.
        rpc.handleNotification("workspace.watcher.create", (params) => {
            const request = parseWireWatcherCreate(params);
            if (request === null) return;
            // Повторный id — пересоздание: старую подписку роняем, иначе она
            // осталась бы висеть без владельца.
            this.disposeFileWatcher(request.id);
            const subscription = this.fileWatcher.watch(
                request.base,
                isRecursiveWatchPattern(request.pattern),
                (changes) => {
                    const events = toWatcherEvents(request, changes);
                    if (events.length > 0) rpc.notify("workspace.watcher.events", { id: request.id, events });
                },
            );
            this.fileWatchers.set(request.id, subscription);
        });
        rpc.handleNotification("workspace.watcher.dispose", (params) => {
            const id = parseWireWatcherDispose(params);
            if (id === null) return;
            this.disposeFileWatcher(id);
        });
        // ─── Decorations bridge (Chunk 4) ────────────────────────────────────
        // Субпроцесс завёл тип декорации. Регистрируем его форму: наличие
        // overviewRulerColor делает тип gutter change-bar'ом.
        rpc.handleNotification("window.createTextEditorDecorationType", (params) => {
            const p = params as { key?: unknown; options?: unknown };
            if (typeof p.key !== "number") return;
            const options: SerializedDecorationRenderOptions =
                typeof p.options === "object" && p.options !== null
                    ? (p.options as SerializedDecorationRenderOptions)
                    : {};
            const overviewRulerColorId = themeColorIdOf(options.overviewRulerColor);
            this.decorationTypes.set(p.key, {
                ...(overviewRulerColorId !== undefined ? { overviewRulerColorId } : {}),
                isWholeLine: options.isWholeLine === true,
            });
        });
        // Тип снят — гасим его декорации во всех файлах и пере-push.
        rpc.handleNotification("window.disposeTextEditorDecorationType", (params) => {
            const p = params as { key?: unknown };
            if (typeof p.key !== "number") return;
            this.decorationTypes.delete(p.key);
            const affected: string[] = [];
            for (const [uri, byKey] of this.editorDecorationsByFile) {
                if (byKey.delete(p.key)) affected.push(uri);
            }
            for (const uri of affected) this.pushEditorDecorations(uri);
        });
        // Набор диапазонов типа в ресурсе. Пере-резолвим ThemeColor и проталкиваем
        // gutter-декорации в редактор(ы) этого ресурса.
        rpc.handleNotification("editor.setDecorations", (params) => {
            const p = params as { key?: unknown; uri?: unknown; ranges?: unknown };
            if (typeof p.key !== "number" || typeof p.uri !== "string") return;
            const ranges = parseDecorationRanges(p.ranges);
            let byKey = this.editorDecorationsByFile.get(p.uri);
            if (byKey === undefined) {
                byKey = new Map();
                this.editorDecorationsByFile.set(p.uri, byKey);
            }
            if (ranges.length === 0) byKey.delete(p.key);
            else byKey.set(p.key, ranges);
            this.pushEditorDecorations(p.uri);
        });
        // Изменившиеся файловые декорации. Мержим в держимый набор (голый uri без
        // цвета/бейджа = снятие) и пере-push всего набора в дерево.
        rpc.handleNotification("window.fileDecorationsChanged", (params) => {
            const p = params as { decorations?: unknown };
            for (const d of parseWireFileDecorations(p.decorations)) {
                const filePath = fileUriToPath(d.uri);
                if (filePath === null) continue;
                if (d.badge === undefined && d.colorId === undefined) {
                    this.fileDecorationState.delete(filePath);
                } else {
                    this.fileDecorationState.set(filePath, {
                        ...(d.badge !== undefined ? { badge: d.badge } : {}),
                        ...(d.colorId !== undefined ? { colorId: d.colorId } : {}),
                    });
                }
            }
            this.pushFileDecorations();
        });
        const configuration = this.configuration;
        if (configuration !== undefined) {
            spawnStore.add(
                configuration.onDidChange((affectedKeys) => {
                    rpc.notify("workspace.configurationChanged", {
                        configuration: configuration.getSnapshot(),
                        affectedKeys,
                    });
                }),
            );
        }
    }

    /**
     * Схлопывает держимые декорации файла в gutter change-bar'ы (только
     * gutter-типы — есть overviewRulerColor) с пере-резолвом ThemeColor и
     * проталкивает их в редактор(ы) этого ресурса. Пустой набор снимает бары.
     */
    private pushEditorDecorations(uri: string): void {
        const byKey = this.editorDecorationsByFile.get(uri);
        const decorations: IGutterChangeDecoration[] = [];
        /* v8 ignore start -- defensive: pushEditorDecorations зовётся только для ресурсов с записью (setDecorations/disposeType/repushAll) */
        if (byKey === undefined) {
            this.editorDecorations.setGutterChangeDecorations(uri, decorations);
            return;
        }
        /* v8 ignore stop */
        for (const [key, ranges] of byKey) {
            const type = this.decorationTypes.get(key);
            if (type?.overviewRulerColorId === undefined) continue;
            const color = this.themeColorResolver.resolve(type.overviewRulerColorId);
            if (color === undefined) continue;
            // VS Code's dirty-diff draws modified lines dashed, added/deleted solid.
            const dashed = type.overviewRulerColorId === "editorGutter.modifiedBackground";
            for (const range of ranges) decorations.push({ range, color, ...(dashed ? { dashed: true } : {}) });
        }
        this.editorDecorations.setGutterChangeDecorations(uri, decorations);
    }

    /** Пере-резолвит держимые файловые декорации и проталкивает полный набор в дерево. */
    private pushFileDecorations(): void {
        const entries: { path: string; color?: number; badge?: string }[] = [];
        for (const [filePath, state] of this.fileDecorationState) {
            const color = state.colorId !== undefined ? this.themeColorResolver.resolve(state.colorId) : undefined;
            entries.push({
                path: filePath,
                ...(color !== undefined ? { color } : {}),
                ...(state.badge !== undefined ? { badge: state.badge } : {}),
            });
        }
        this.fileDecorations.setFileDecorations(entries);
    }

    /**
     * `ExtensionContext.globalState` / `workspaceState`: субпроцесс держит
     * словарь у себя (синхронные `get`/`keys`), а каждый `update` присылает его
     * сюда целиком. Запись `workspaceState` из воркспейса, отличного от того, в
     * котором расширение активировано, отбрасывается с предупреждением: иначе
     * словарь воркспейса A протёк бы в стор B (честное лечение — перезапуск
     * хоста при смене папки, как reload окна у vscode).
     */
    private installMementoHandlers(rpc: RpcEndpoint): void {
        rpc.handleRequest("memento.update", (params): unknown => {
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
     * Шлёт субпроцессу вид активной темы. Молча ничего не делает, пока
     * субпроцесса нет: тема приедет семенем на его подъёме (`ensureSubprocess`),
     * и досылать её мёртвому некому.
     */
    private pushActiveColorTheme(): void {
        const theme: IWireColorTheme = { kind: this.themeColorResolver.kind() };
        this.rpc?.notify("window.themeChanged", theme);
    }

    /** Пере-push всех держимых декораций в обе поверхности (на смену темы). */
    private repushAllDecorations(): void {
        for (const uri of this.editorDecorationsByFile.keys()) this.pushEditorDecorations(uri);
        this.pushFileDecorations();
    }

    /** Снимает все прокси-регистрации команд (при смерти сабпроцесса). */
    private clearProxyCommands(): void {
        for (const disposable of this.proxyCommands.values()) {
            disposable.dispose();
        }
        this.proxyCommands.clear();
    }

    /**
     * Сбрасывает всё, что принадлежало ушедшему субпроцессу: ссылки на канал,
     * флаги подписок и поверхности, которые он держал (спиннеры, пункты полосы,
     * декорации, прокси-команды). Общий для вежливого выключения
     * ({@link shutdownSubprocess}) и для внезапной смерти
     * ({@link handleSubprocessDeath}).
     */
    private resetSubprocessState(): void {
        // Подписки спавна на ядро и watcher'ы расширений принадлежали ушедшему
        // субпроцессу: слать их события больше некому, а оставь их — каждый
        // респавн добавлял бы новых поверх (и держал inotify-бюджет дерева).
        this.spawnStore.dispose();
        this.spawnStore = new DisposableStore();
        this.disposeFileWatchers();
        this.rpc = null;
        this.process = null;
        this.readyPromise = null;
        this.willSaveSubscribed = false;
        this.didSaveSubscribed = false;
        this.documentSyncSubscribed = false;
        // Провайдеры умерли вместе с субпроцессом: адаптер снимет их прокси из
        // реестра ядра, и запросы к мёртвым handle не уйдут.
        if (this.languageProviders.size > 0) {
            this.languageProviders.clear();
            this.fireLanguageProvidersChanged();
        }
        this.pendingDidChange.clear();
        // Декорации принадлежали умирающему сабпроцессу — сбрасываем реестр, чтобы
        // респавн начинал с чистого листа (сами поверхности перерисует расширение).
        this.decorationTypes.clear();
        this.editorDecorationsByFile.clear();
        this.fileDecorationState.clear();
        // Прокси-команды указывали на умирающий сабпроцесс — снимаем их из
        // общего DI-синглтона CommandRegistry, чтобы не оставить висячие записи.
        this.clearProxyCommands();
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
        this.resetSubprocessState();
        // Канал мертвеца закрываем: запросы в полёте (прежде всего
        // `host.activateExtension`) получают отказ, а не висят вечно, — и
        // оборванная активация возвращается к оживлению (см. requestActivation).
        subprocess.dispose();
        // Активные возвращаются в `pending` и оживут на ЛЮБОМ следующем событии
        // активации — оно проиграет журнал (см. `requestedEvents`).
        for (const [id, reg] of this.activatedRegistrations) this.pending.set(id, reg);
        this.replayPending = true;
        // Прокси-команды мертвеца сняты вместе с ним (`clearProxyCommands`) —
        // возвращаем на их место заглушки-активаторы. Иначе команда исчезла бы и
        // из палитры, и вместе с ней единственный способ оживить расширение
        // руками: оживление ждёт события активации, а команда им и была.
        for (const reg of this.activatedRegistrations.values()) {
            for (const id of readCommandActivationIds(reg)) this.armCommandActivation(id);
        }
        this.activatedRegistrations.clear();
        this.extensions.clear();
    }

    private async shutdownSubprocess(): Promise<void> {
        const rpc = this.rpc;
        const subprocess = this.process;
        this.resetSubprocessState();
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

/**
 * Общая часть параметров обеих rename-ручек: документ и позиция каретки.
 * `prepareRename` и `provideRenameEdits` спрашивают об одном и том же месте,
 * и расходятся только новым именем.
 */
function renameTarget(req: IRenameRequest): {
    uri: string;
    languageId: string;
    text: string;
    line: number;
    character: number;
} {
    return {
        uri: req.uri,
        languageId: req.languageId,
        text: req.text,
        line: req.line,
        character: req.character,
    };
}

function sanitizeOptionsPatch(raw: unknown): IEditorOptionsPatch {
    if (typeof raw !== "object" || raw === null) return {};
    const obj = raw as { tabSize?: unknown; insertSpaces?: unknown; indentSize?: unknown };
    const patch: { tabSize?: number; insertSpaces?: boolean } = {};
    if (typeof obj.tabSize === "number" && Number.isFinite(obj.tabSize) && obj.tabSize > 0) {
        patch.tabSize = Math.floor(obj.tabSize);
    }
    // `indentSize` — алиас tabSize (Diode пока не различает их): применяем только
    // если явного tabSize нет. editorconfig шлёт indent_size именно так.
    if (
        patch.tabSize === undefined &&
        typeof obj.indentSize === "number" &&
        Number.isFinite(obj.indentSize) &&
        obj.indentSize > 0
    ) {
        patch.tabSize = Math.floor(obj.indentSize);
    }
    if (typeof obj.insertSpaces === "boolean") {
        patch.insertSpaces = obj.insertSpaces;
    }
    return patch;
}

function parseCommandInvocation(raw: unknown): { id: string; args: unknown[] } {
    if (typeof raw !== "object" || raw === null) {
        throw new Error("commands.executeCommand: params must be an object");
    }
    const obj = raw as { id?: unknown; args?: unknown };
    if (typeof obj.id !== "string" || obj.id === "") {
        throw new Error("commands.executeCommand: id must be a non-empty string");
    }
    const args = Array.isArray(obj.args) ? (obj.args as unknown[]) : [];
    return { id: obj.id, args };
}

/**
 * Переводит wire-uri файловой декорации в абсолютный путь; `null` — если ресурс
 * не на диске. Субпроцесс шлёт `Uri.toString()`, разбираем тем же типом.
 *
 * Раньше не-file строки возвращались как есть («best-effort»), и схема уезжала в
 * ключ `fileDecorationState` (`git:/foo.ts?{...}`), где молча не совпадала ни с
 * одним путём дерева. Декорацию для не-file ресурса честнее отбросить: дерево
 * адресуется путями, показать там `git:`-ресурс всё равно нечем.
 */
function fileUriToPath(uri: string): string | null {
    const parsed = Uri.parse(uri);
    return parsed.scheme === "file" ? parsed.fsPath : null;
}

function parseCommandId(raw: unknown): string | null {
    if (typeof raw !== "object" || raw === null) return null;
    const obj = raw as { id?: unknown };
    return typeof obj.id === "string" && obj.id !== "" ? obj.id : null;
}

/**
 * Рекурсивен ли watcher с таким шаблоном. Правило VS Code: `RelativePattern`
 * с простым `*` (или другим односегментным шаблоном) следит только за прямыми
 * детьми базы, а как только в шаблоне появляется `**` или разделитель — за
 * поддеревом. Именно на этом различии держится дешёвый watcher `.git`:
 * `new RelativePattern(dotGit, "*")` не тащит за собой `.git/objects`.
 */
export function isRecursiveWatchPattern(pattern: string): boolean {
    return pattern.includes("**") || pattern.includes("/");
}

/**
 * Фильтрует пачку изменений одного watcher'а и переводит её в wire-события:
 * отбрасывает то, что вне базы, не подошло шаблону или выключено флагами
 * `ignore*Events`. Путь матчится относительно базы в posix-форме — так шаблон
 * `RelativePattern` работает одинаково на всех платформах.
 */
export function toWatcherEvents(request: IWireWatcherCreate, changes: readonly ITreeFileChange[]): IWireWatcherEvent[] {
    const events: IWireWatcherEvent[] = [];
    for (const change of changes) {
        if (change.type === "created" && request.ignoreCreateEvents) continue;
        if (change.type === "changed" && request.ignoreChangeEvents) continue;
        if (change.type === "deleted" && request.ignoreDeleteEvents) continue;
        const relative = path.relative(request.base, change.path);
        // Вне базы (`..`) или сама база (пустой путь) — не наше событие.
        if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) continue;
        if (!matchGlob(request.pattern, relative.split(path.sep).join("/"))) continue;
        events.push({ type: change.type, uri: Uri.file(change.path).toString() });
    }
    return events;
}
