import { type ChildProcess, spawn } from "node:child_process";
import { createRequire } from "node:module";

import { Disposable, type IDisposable } from "../../../../../../tuidom/common/disposable.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import type { ICompletionRequest, ICoreCompletionItem } from "../../../../editor/common/languages/iCompletionSource.ts";
import type { ICoreDefinitionLocation, IDefinitionRequest } from "../../../../editor/common/languages/iDefinitionSource.ts";
import type { IFoldingRequest } from "../../../../editor/common/languages/iFoldingSource.ts";
import type { IGutterChangeDecoration } from "../../../../editor/common/model/iGutterChangeDecoration.ts";
import type { IFoldingRegion } from "../../../../editor/contrib/folding/iFoldingRegion.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import {
    type IEditorDecorationsService,
    NULL_EDITOR_DECORATIONS_SERVICE,
} from "../../../api/common/iEditorDecorationsService.ts";
import type { IEditorOptionsPatch, IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import {
    type IFileDecorationsService,
    NULL_FILE_DECORATIONS_SERVICE,
} from "../../../api/common/iFileDecorationsService.ts";
import type { IIpcEndpoint } from "../../../api/common/ipcMessageChannel.ts";
import { IpcMessageChannel } from "../../../api/common/ipcMessageChannel.ts";
import { type IThemeColorResolver, NULL_THEME_COLOR_RESOLVER } from "../../../api/common/iThemeColorResolver.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";
import {
    type IWireDocumentSyncSnapshot,
    parseDecorationRanges,
    parseWireDiagnosticsPublish,
    parseWireEditorEdits,
    parseWireFileDecorations,
    parseWireOutputAppend,
    parseWireOutputShow,
    parseWireProgressEnd,
    parseWireProgressReport,
    parseWireProgressStart,
    parseWireReadFileResult,
    parseWireSelections,
    requestCompletionItems,
    requestDefinition,
    requestFoldingRanges,
    requestWillSaveEdits,
    type SerializedDecorationRenderOptions,
    themeColorIdOf,
    type WireMarker,
    type WireOutputLevel,
} from "../../../api/common/wireTypes.ts";

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

import type { ISaveEdit, ISaveSnapshot } from "../../textfile/common/iSaveParticipant.ts";

import type { IExtensionRegistration } from "./iExtensionEntry.ts";

/**
 * Сток output-каналов расширений (`window.createOutputChannel` →
 * `output.append`/`output.show`): потребитель (module/харнесс) регистрирует
 * канал в реестре Output лениво по label и пишет строку логгером уровня `level`.
 */
export interface IOutputSink {
    append(channel: string, label: string, level: WireOutputLevel, value: string): void;
    show(channel: string, label: string): void;
}

export const ExtensionHostDIToken = token<ExtensionHost>("ExtensionHost");

/** Порог, выше которого снапшот документа не гоняется через will-save RPC (8 MB). */
const MAX_WILL_SAVE_TEXT_BYTES = 8 * 1024 * 1024;

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
    /** Полное слитое дерево настроек (`IConfigurationService.getValue()`). */
    getSnapshot(): unknown;
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
     * (расширение видит только `configDefaults` из своего манифеста).
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
     * Снимок активного документа для document sync. Хост пушит его как
     * `editor.didOpen` при готовности subprocess'а — чтобы `workspace.textDocuments`
     * был заполнен ДО активации расширения (стоковый vscode-languageclient читает
     * его на `start()`), — и при появлении первого подписчика document sync
     * (расширение активировалось уже после открытия файла).
     */
    readonly activeDocumentProvider?: () => IWireDocumentSyncSnapshot | null;
}

/**
 * Host-сторона extension subsystem'ы. Форкает один subprocess (через
 * `child_process.spawn(process.execPath, ..., { stdio: [...,'ipc'] })`) и
 * управляет жизненным циклом расширений через RPC поверх Node IPC-канала.
 *
 * Subprocess — это тот же бинарь / тот же main.ts с env-флагом
 * `VEXX_EXTENSION_HOST=1`; ранний branch в `main.ts` уводит управление в
 * `runExtensionHostSubprocess()`.
 *
 * Lifecycle:
 * - `registerExtension(reg)` — только запоминает регистрацию (`pending`) и
 *   заголовки команд для палитры; subprocess НЕ поднимается. Возвращает
 *   disposable для снятия расширения.
 * - `activateByEvent(event)` — активирует ещё не активные `pending`-расширения,
 *   чьи `activationEvents` содержат событие: лениво поднимает subprocess (если
 *   ещё не) и шлёт `host.activateExtension`. Идемпотентно.
 * - `unregisterExtension(id)` — `host.deactivateExtension`.
 * - `dispose()` — `host.shutdown` (best effort) → ждём exit → SIGTERM →
 *   SIGKILL fallback.
 */
export class ExtensionHost extends Disposable {
    private readonly editorOptions: IEditorOptionsService;
    private readonly commandService: ICommandService;
    /** Прокси-регистрации команд сабпроцесса в host CommandRegistry (по id). */
    private readonly proxyCommands = new Map<string, IDisposable>();
    /** Заголовки команд из contributes.commands (id → title) для видимости в палитре. */
    private readonly commandTitles = new Map<string, string>();
    private readonly options: Required<
        Pick<
            IExtensionHostOptions,
            | "spawnArgs"
            | "readyTimeoutMs"
            | "shutdownTimeoutMs"
            | "willSaveTimeoutMs"
            | "completionTimeoutMs"
            | "foldingTimeoutMs"
            | "definitionTimeoutMs"
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
    /**
     * Зарегистрированные, но ещё не активированные расширения (id → reg).
     * Заполняется `registerExtension`, опустошается `activateByEvent` по мере
     * наступления событий активации. Ленивость: пока reg здесь, subprocess под
     * него не поднимается.
     */
    private readonly pending = new Map<string, IExtensionRegistration>();
    private subprocess: ChildProcess | null = null;
    private channel: IpcMessageChannel | null = null;
    private rpc: RpcEndpoint | null = null;
    private readyPromise: Promise<void> | null = null;
    private hostDisposed = false;
    /** Есть ли в субпроцессе активные подписки на will/did-save (см. `workspace.updateSubscriptions`). */
    private willSaveSubscribed = false;
    private didSaveSubscribed = false;
    /** Есть ли в субпроцессе зарегистрированные completion-провайдеры (см. `languages.updateSubscriptions`). */
    private completionSubscribed = false;
    /** Есть ли в субпроцессе зарегистрированные folding-провайдеры (см. `languages.updateSubscriptions`). */
    private foldingSubscribed = false;
    /** Есть ли в субпроцессе зарегистрированные definition-провайдеры (см. `languages.updateSubscriptions`). */
    private definitionSubscribed = false;
    /** Есть ли в субпроцессе подписки document sync (onDidOpen/onDidChangeTextDocument). */
    private documentSyncSubscribed = false;
    /** Коалесинг didChange в пределах тика (latest-wins) — правка на каждое нажатие не гоняет RPC-шторм. */
    private pendingDidChange: IWireDocumentSyncSnapshot | null = null;
    private readonly activeDocumentProvider: (() => IWireDocumentSyncSnapshot | null) | undefined;
    private readonly diagnosticsSink: DiagnosticsSink | undefined;
    private readonly progressSink: IProgressSink | undefined;
    private readonly outputSink: IOutputSink | undefined;
    /** Живые handle'ы withProgress — на shutdown всем шлётся end (спиннеры не зависают). */
    private readonly activeProgressHandles = new Set<number>();
    /** Схемы, для которых субпроцесс держит FileSystemProvider'ы. */
    private fileSystemSchemesValue: readonly string[] = [];
    private readonly fileSystemSchemesListeners: (() => void)[] = [];
    private readonly fileSystemChangeListeners: ((uris: readonly Uri[]) => void)[] = [];
    /** Слушатели смены наличия folding-провайдеров (для пере-пересчёта фолдов открытых редакторов). */
    private readonly foldingProvidersChangedListeners: (() => void)[] = [];

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
            foldingTimeoutMs: options.foldingTimeoutMs ?? 1500,
            definitionTimeoutMs: options.definitionTimeoutMs ?? 5000,
        };
        this.logger = options.logger;
        this.rpcLogger = options.rpcLogger;
        this.stdoutLogger = options.stdoutLogger;
        this.stderrLogger = options.stderrLogger;
        this.configuration = options.configuration;
        this.editorDecorations = options.editorDecorations ?? NULL_EDITOR_DECORATIONS_SERVICE;
        this.fileDecorations = options.fileDecorations ?? NULL_FILE_DECORATIONS_SERVICE;
        this.themeColorResolver = options.themeColorResolver ?? NULL_THEME_COLOR_RESOLVER;
        this.activeDocumentProvider = options.activeDocumentProvider;
        this.diagnosticsSink = options.diagnosticsSink;
        this.progressSink = options.progressSink;
        this.outputSink = options.outputSink;
        // Смена темы → пере-резолв держимых декораций в обе поверхности.
        this.register(
            this.themeColorResolver.onDidChange(() => {
                this.repushAllDecorations();
            }),
        );
    }

    /**
     * Запоминает регистрацию расширения (bookkeeping) — subprocess НЕ поднимается.
     * Реальная активация происходит лениво в {@link activateByEvent}, когда
     * наступает событие из `reg.activationEvents`. Заголовки команд регистрируем
     * сразу: команда расширения должна быть видна в палитре ещё до активации.
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
            activationEvents: normalizeActivationEvents(reg.activationEvents),
        });
        // Заголовки команд из contributes.commands — нужны прокси-регистрации,
        // чтобы команда расширения показалась в палитре (см. commands.registerCommand).
        if (reg.commandTitles !== undefined) {
            for (const [id, title] of Object.entries(reg.commandTitles)) this.commandTitles.set(id, title);
        }
        this.pending.set(reg.id, reg);
        return {
            dispose: (): void => {
                if (this.pending.delete(reg.id)) return; // ещё не активировано
                if (!this.extensions.has(reg.id)) return;
                void this.unregisterExtension(reg.id);
            },
        };
    }

    /**
     * Активирует все ещё не активные `pending`-расширения, чьи `activationEvents`
     * содержат `event`. Идемпотентно: уже активные пропускаются. `event === "*"`
     * матчит расширения с `"*"` в списке событий (пустой список ⇒ трактуется как
     * `["*"]`). Именно здесь лениво поднимается subprocess и уходит
     * `host.activateExtension`.
     */
    public async activateByEvent(event: string): Promise<void> {
        // Disposed-случай покрыт неявно: dispose() чистит `pending`, поэтому
        // `toActivate` окажется пустым и метод выйдет до ensureSubprocess.
        const toActivate: IExtensionRegistration[] = [];
        for (const reg of this.pending.values()) {
            if (normalizeActivationEvents(reg.activationEvents).includes(event)) toActivate.push(reg);
        }
        if (toActivate.length === 0) return;
        // Спавним subprocess ОДИН раз до цикла: сбой хоста (spawn/ready) — это не
        // проблема конкретного расширения, он пробрасывается наверх.
        const rpc = await this.ensureSubprocess();
        for (const reg of toActivate) {
            // Второй guard на случай, если параллельный activateByEvent уже занялся им.
            if (!this.pending.delete(reg.id)) continue;
            // Per-extension изоляция: упавший `activate()` одного расширения не
            // блокирует активацию остальных и не роняет bootstrap (как в VS Code).
            try {
                await rpc.request("host.activateExtension", {
                    id: reg.id,
                    mainPath: reg.mainPath,
                    source: reg.source,
                    filename: reg.filename,
                    configDefaults: reg.configDefaults,
                });
                this.extensions.add(reg.id);
                this.logger?.info(`activated extension "${reg.id}"`);
            } catch (err) {
                this.logger?.error(`failed to activate extension "${reg.id}"`, err);
            }
        }
    }

    public async unregisterExtension(id: string): Promise<void> {
        if (!this.extensions.has(id)) return;
        this.extensions.delete(id);
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
        const alreadyScheduled = this.pendingDidChange !== null;
        this.pendingDidChange = snapshot;
        if (alreadyScheduled) return;
        queueMicrotask(() => {
            const pending = this.pendingDidChange;
            this.pendingDidChange = null;
            // Subprocess мог умереть, пока ждали тик (shutdown чистит pending вместе с rpc).
            if (pending === null) return;
            rpc.notify("editor.didChange", pending);
        });
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
     * Запрашивает у субпроцесса элементы автодополнения для позиции курсора
     * (`languages.provideCompletionItems`). Возвращает `[]`, если субпроцесса нет,
     * никто не зарегистрировал провайдеры, документ слишком большой или расширение
     * не ответило за `completionTimeoutMs`. Подключается в
     * `EditorService.completionSource` (wiring в module/харнессе).
     */
    public async provideCompletionItems(req: ICompletionRequest): Promise<readonly ICoreCompletionItem[]> {
        const rpc = this.rpc;
        if (rpc === null || !this.completionSubscribed) return [];
        /* v8 ignore start -- защитный лимит на снапшот 8 МБ; открытие такого файла в редакторе неподъёмно для unit-теста */
        if (req.text.length > MAX_WILL_SAVE_TEXT_BYTES) {
            this.logger?.warn("skipping completion: document too large", {
                uri: req.uri,
                length: req.text.length,
            });
            return [];
        }
        /* v8 ignore stop */
        return requestCompletionItems(
            (method, params) => rpc.request(method, params),
            {
                uri: req.uri,
                languageId: req.languageId,
                text: req.text,
                line: req.line,
                character: req.character,
            },
            this.options.completionTimeoutMs,
        );
    }

    /**
     * Отдаёт области сворачивания от folding-провайдеров субпроцесса для
     * документа. Возвращает пустой массив, если host не поднят, провайдеров нет,
     * документ слишком большой или расширение не ответило за `foldingTimeoutMs`
     * — ядро в этом случае откатывается на indentation-фолды. Подключается в
     * `EditorService.foldingRangeSource` (wiring в module/харнессе).
     */
    public async provideFoldingRanges(req: IFoldingRequest): Promise<readonly IFoldingRegion[]> {
        const rpc = this.rpc;
        if (rpc === null || !this.foldingSubscribed) return [];
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
                uri: req.uri,
                languageId: req.languageId,
                text: req.text,
            },
            this.options.foldingTimeoutMs,
        );
    }

    /**
     * Запрашивает у субпроцесса цели definition для позиции курсора
     * (`languages.provideDefinition`). Возвращает `[]`, если субпроцесса нет,
     * никто не зарегистрировал провайдеры, документ слишком большой или
     * расширение не ответило за `definitionTimeoutMs`. Подключается в
     * `EditorService.definitionSource` (wiring в module/харнессе).
     */
    public async provideDefinition(req: IDefinitionRequest): Promise<readonly ICoreDefinitionLocation[]> {
        const rpc = this.rpc;
        if (rpc === null || !this.definitionSubscribed) return [];
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
     * Событие смены наличия folding-провайдеров в субпроцессе. Потребитель
     * (ExtensionHostModule / харнесс) на него пере-подключает
     * `EditorService.foldingRangeSource`, что триггерит пересчёт фолдов уже
     * открытых редакторов — нужно, когда расширение активировалось после
     * открытия файла.
     */
    public onFoldingProvidersChanged(cb: () => void): { dispose(): void } {
        this.foldingProvidersChangedListeners.push(cb);
        return {
            dispose: (): void => {
                const idx = this.foldingProvidersChangedListeners.indexOf(cb);
                if (idx >= 0) this.foldingProvidersChangedListeners.splice(idx, 1);
            },
        };
    }

    private fireFoldingProvidersChanged(): void {
        for (const cb of [...this.foldingProvidersChangedListeners]) cb();
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
    public onFileSystemProvidersChanged(cb: () => void): { dispose(): void } {
        this.fileSystemSchemesListeners.push(cb);
        return {
            dispose: (): void => {
                const idx = this.fileSystemSchemesListeners.indexOf(cb);
                if (idx >= 0) this.fileSystemSchemesListeners.splice(idx, 1);
            },
        };
    }

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
    public onDidChangeProvidedFile(cb: (uris: readonly Uri[]) => void): { dispose(): void } {
        this.fileSystemChangeListeners.push(cb);
        return {
            dispose: (): void => {
                const idx = this.fileSystemChangeListeners.indexOf(cb);
                if (idx >= 0) this.fileSystemChangeListeners.splice(idx, 1);
            },
        };
    }

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
        void this.shutdownSubprocess();
        super.dispose();
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
        const spec = this.options.spawnArgs();
        const stdoutMode: "pipe" | "inherit" = this.stdoutLogger !== undefined ? "pipe" : "inherit";
        const stderrMode: "pipe" | "inherit" = this.stderrLogger !== undefined ? "pipe" : "inherit";
        this.logger?.debug("spawning extension host subprocess", {
            command: spec.command,
            args: spec.args,
            stdio: ["ignore", stdoutMode, stderrMode, "ipc"],
        });
        const child = spawn(spec.command, spec.args, {
            stdio: ["ignore", stdoutMode, stderrMode, "ipc"],
            env: spec.env ?? { ...process.env, VEXX_EXTENSION_HOST: "1" },
        });
        if (child.stdout !== null && this.stdoutLogger !== undefined) {
            pipeStreamToLogger(child.stdout, this.stdoutLogger, "info");
        }
        if (child.stderr !== null && this.stderrLogger !== undefined) {
            pipeStreamToLogger(child.stderr, this.stderrLogger, "warn");
        }
        child.once("exit", (code, signal) => {
            this.logger?.info("extension host subprocess exited", { code, signal });
        });
        child.once("error", (err) => {
            this.logger?.error("extension host subprocess error", err);
        });
        const channel = new IpcMessageChannel(child as unknown as IIpcEndpoint);
        const rpc = new RpcEndpoint(channel, this.rpcLogger);
        this.installHostHandlers(rpc);

        this.subprocess = child;
        this.channel = channel;
        this.rpc = rpc;

        this.readyPromise = waitForReady(rpc, child, this.options.readyTimeoutMs).then(() => {
            this.logger?.info("extension host ready");
            // Push конфигурацию ДО стартового active-editor и первого
            // activateExtension: расширение читает getConfiguration уже в activate().
            if (this.configuration !== undefined) {
                rpc.notify("workspace.initialize", {
                    configuration: this.configuration.getSnapshot(),
                    workspaceFolders: this.configuration.getWorkspaceFolders(),
                });
            }
            // Send initial active editor state so that window.activeTextEditor
            // is correct before the first host.activateExtension call.
            rpc.notify("editor.activeEditorChanged", this.editorOptions.getActiveEditorMeta());
            // Наполняем `workspace.textDocuments` активным документом ДО первой
            // активации: стоковый vscode-languageclient читает его на start().
            // Мимо гейта подписки — подписчиков в этот момент ещё нет.
            const snapshot = this.activeDocumentProvider?.();
            if (snapshot !== null && snapshot !== undefined) rpc.notify("editor.didOpen", snapshot);
        });
        await this.readyPromise;
        return rpc;
    }

    private installHostHandlers(rpc: RpcEndpoint): void {
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
            const p = params as { uri?: unknown; selections?: unknown };
            if (typeof p.uri !== "string") return;
            this.editorOptions.setActiveEditorSelections(p.uri, parseWireSelections(p.selections));
        });
        // Сабпроцесс просит применить правки `TextEditor.edit` одним undoable-батчем.
        rpc.handleRequest("editor.applyEdit", (params): unknown => {
            const p = params as { uri?: unknown; edits?: unknown };
            if (typeof p.uri !== "string") return false;
            return this.editorOptions.applyActiveEditorEdits(p.uri, parseWireEditorEdits(p.edits));
        });
        // Сабпроцесс просит исполнить команду ядра (напр. встроенную
        // editor.action.trimTrailingWhitespace). Нормализуем через Promise —
        // handler ядра может вернуть значение или thenable.
        rpc.handleRequest("commands.executeCommand", (params): unknown => {
            const { id, args } = parseCommandInvocation(params);
            return Promise.resolve(this.commandService.execute(id, args));
        });
        // Сабпроцесс зарегистрировал команду — заводим прокси в host-реестре,
        // который уводит исполнение обратно в сабпроцесс обратным RPC.
        rpc.handleNotification("commands.registerCommand", (params): void => {
            const id = parseCommandId(params);
            if (id === null) return;
            this.proxyCommands.get(id)?.dispose();
            this.proxyCommands.set(
                id,
                this.commandService.registerProxy(
                    id,
                    (args) => rpc.request("commands.executeCommand", { id, args }),
                    this.commandTitles.get(id),
                ),
            );
        });
        rpc.handleNotification("commands.unregisterCommand", (params): void => {
            const id = parseCommandId(params);
            if (id === null) return;
            this.proxyCommands.get(id)?.dispose();
            this.proxyCommands.delete(id);
        });
        this.register(
            this.editorOptions.onActiveEditorChanged((meta) => {
                rpc.notify("editor.activeEditorChanged", meta);
            }),
        );
        // Движение каретки/смена выделения — отдельным сообщением, чтобы
        // `activeTextEditor.selection` в расширении не залипал на состоянии момента
        // открытия файла. Именно `activeEditorChanged` слать нельзя: он дёргает
        // `onDidChangeActiveTextEditor`, и, например, встроенный git пересчитывал бы
        // статус на каждое нажатие стрелки.
        this.register(
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
        // Субпроцесс сообщает, есть ли зарегистрированные completion-провайдеры.
        // Без них хост не гоняет RPC на Ctrl+Space.
        rpc.handleNotification("languages.updateSubscriptions", (params) => {
            const p = params as {
                hasCompletionProviders?: unknown;
                hasFoldingProviders?: unknown;
                hasDefinitionProviders?: unknown;
            };
            this.completionSubscribed = p.hasCompletionProviders === true;
            this.definitionSubscribed = p.hasDefinitionProviders === true;
            const foldingBefore = this.foldingSubscribed;
            this.foldingSubscribed = p.hasFoldingProviders === true;
            // Провайдер folding появился/исчез (обычно — расширение активировалось
            // уже после открытия файла): просим пере-пересчитать фолды открытых
            // редакторов, иначе провайдерские области не подъедут до первой правки.
            if (foldingBefore !== this.foldingSubscribed) this.fireFoldingProvidersChanged();
        });
        // Субпроцесс объявляет схемы, для которых расширения зарегистрировали
        // FileSystemProvider (у встроенного git — `git:`). Ядро по ним читает
        // недисковые ресурсы через IFileSystemProviderRegistry.
        rpc.handleNotification("workspace.fileSystemProvidersChanged", (params) => {
            const p = params as { schemes?: unknown };
            const schemes = Array.isArray(p.schemes) ? p.schemes.filter((s): s is string => typeof s === "string") : [];
            this.fileSystemSchemesValue = schemes;
            for (const cb of [...this.fileSystemSchemesListeners]) cb();
        });
        // Провайдер расширения сообщил, что содержимое ресурсов изменилось
        // (для git: — сдвинулся HEAD/индекс): потребители сбрасывают кэш.
        rpc.handleNotification("workspace.fs.didChangeFile", (params) => {
            const p = params as { uris?: unknown };
            const raw = Array.isArray(p.uris) ? p.uris.filter((u): u is string => typeof u === "string") : [];
            if (raw.length === 0) return;
            const uris = raw.map((u) => Uri.parse(u));
            for (const cb of [...this.fileSystemChangeListeners]) cb(uris);
        });
        // Жизненный цикл withProgress расширения — отдаём стоку (module рисует
        // запись статус-бара со спиннером и снимает её на end).
        rpc.handleNotification("window.progress.start", (params) => {
            const start = parseWireProgressStart(params);
            if (start === null) return;
            this.activeProgressHandles.add(start.handle);
            this.progressSink?.start(start.handle, start.title);
        });
        rpc.handleNotification("window.progress.report", (params) => {
            const report = parseWireProgressReport(params);
            if (report === null) return;
            this.progressSink?.report(report.handle, report.message, report.increment);
        });
        rpc.handleNotification("window.progress.end", (params) => {
            const end = parseWireProgressEnd(params);
            if (end === null) return;
            this.activeProgressHandles.delete(end.handle);
            this.progressSink?.end(end.handle);
        });
        // Строка output-канала расширения / просьба показать канал — отдаём
        // стоку (module ведёт в реестр Output + логгер + команду show).
        rpc.handleNotification("output.append", (params) => {
            const append = parseWireOutputAppend(params);
            if (append === null) return;
            this.outputSink?.append(append.channel, append.label, append.level, append.value);
        });
        rpc.handleNotification("output.show", (params) => {
            const show = parseWireOutputShow(params);
            if (show === null) return;
            this.outputSink?.show(show.channel, show.label);
        });
        // Расширение опубликовало диагностики (createDiagnosticCollection().set)
        // — отдаём их стоку (module ведёт в MarkerService → squiggle + Problems).
        rpc.handleNotification("diagnostics.publish", (params) => {
            const publish = parseWireDiagnosticsPublish(params);
            if (publish === null) return;
            this.diagnosticsSink?.(publish.owner, publish.resource, publish.markers);
        });
        rpc.handleNotification("window.showMessage", (params) => {
            const { severity, message } = params as { severity?: unknown; message?: unknown };
            const text = typeof message === "string" ? message : String(message);
            if (severity === "error") this.logger?.error(`[extension] ${text}`);
            else if (severity === "warn") this.logger?.warn(`[extension] ${text}`);
            else this.logger?.info(`[extension] ${text}`);
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
            this.register(
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

    private async shutdownSubprocess(): Promise<void> {
        const rpc = this.rpc;
        const channel = this.channel;
        const child = this.subprocess;
        this.rpc = null;
        this.channel = null;
        this.subprocess = null;
        this.readyPromise = null;
        this.willSaveSubscribed = false;
        this.didSaveSubscribed = false;
        this.completionSubscribed = false;
        this.foldingSubscribed = false;
        this.definitionSubscribed = false;
        this.documentSyncSubscribed = false;
        this.pendingDidChange = null;
        // Subprocess умер — его `end` уже не придёт: гасим спиннеры сами.
        for (const handle of this.activeProgressHandles) this.progressSink?.end(handle);
        this.activeProgressHandles.clear();
        // Декорации принадлежали умирающему сабпроцессу — сбрасываем реестр, чтобы
        // респавн начинал с чистого листа (сами поверхности перерисует расширение).
        this.decorationTypes.clear();
        this.editorDecorationsByFile.clear();
        this.fileDecorationState.clear();
        // Прокси-команды указывали на умирающий сабпроцесс — снимаем их из
        // общего DI-синглтона CommandRegistry, чтобы не оставить висячие записи.
        this.clearProxyCommands();
        if (child === null) {
            rpc?.dispose();
            channel?.dispose();
            return;
        }
        const exit = waitForExit(child);
        /* v8 ignore start -- defensive: ensureSubprocess sets `subprocess` and `rpc` together and shutdownSubprocess captures them together, so a non-null child always implies a non-null rpc here */
        if (rpc !== null) {
            /* v8 ignore stop */
            try {
                await Promise.race([rpc.request("host.shutdown"), sleep(this.options.shutdownTimeoutMs)]);
            } catch {
                // ignore
            }
        }
        if (child.exitCode === null && !child.killed) {
            try {
                child.kill("SIGTERM");
            } catch {
                // ignore
            }
            await Promise.race([exit, sleep(500)]);
        }
        if (child.exitCode === null && !child.killed) {
            try {
                child.kill("SIGKILL");
            } catch {
                // ignore
            }
            await Promise.race([exit, sleep(500)]);
        }
        rpc?.dispose();
        channel?.dispose();
    }
}

/**
 * Нормализует `activationEvents`: пусто/отсутствует ⇒ `["*"]` (eager). Так
 * расширение без описанных событий сохраняет прежнее поведение — активируется
 * на общем стартовом `activateByEvent("*")`.
 */
function normalizeActivationEvents(events: readonly string[] | undefined): readonly string[] {
    return events !== undefined && events.length > 0 ? events : ["*"];
}

function sanitizeOptionsPatch(raw: unknown): IEditorOptionsPatch {
    if (typeof raw !== "object" || raw === null) return {};
    const obj = raw as { tabSize?: unknown; insertSpaces?: unknown; indentSize?: unknown };
    const patch: { tabSize?: number; insertSpaces?: boolean } = {};
    if (typeof obj.tabSize === "number" && Number.isFinite(obj.tabSize) && obj.tabSize > 0) {
        patch.tabSize = Math.floor(obj.tabSize);
    }
    // `indentSize` — алиас tabSize (Vexx пока не различает их): применяем только
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

function defaultSpawnArgs(): { command: string; args: string[] } {
    if (detectIsSea()) {
        // В SEA-режиме сам бинарь = `process.execPath`; main script отсутствует.
        return { command: process.execPath, args: [] };
    }
    const mainScript = process.argv[1];
    if (typeof mainScript !== "string" || mainScript === "") {
        throw new Error("ExtensionHost: cannot determine main script for dev subprocess");
    }
    return { command: process.execPath, args: [...process.execArgv, mainScript] };
}

/**
 * `node:sea` доступен только через `require()` внутри SEA-сборки — статический
 * ESM-импорт падает с `ERR_UNKNOWN_BUILTIN_MODULE` даже в работающем SEA exe.
 * См. `Common/Assets/createDefaultAssetAccess.ts` за тот же паттерн.
 */
function detectIsSea(): boolean {
    try {
        const req = createRequire("file:///");
        const sea = req("node:sea") as { isSea(): boolean };
        return sea.isSea();
    } catch {
        return false;
    }
}

function waitForReady(rpc: RpcEndpoint, child: ChildProcess, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const handle = rpc.handleNotification("host.ready", () => {
            handle.dispose();
            cleanup();
            resolve();
        });
        const onExit = (code: number | null): void => {
            handle.dispose();
            cleanup();
            reject(new Error(`extension host subprocess exited before ready (code ${String(code)})`));
        };
        const timer = setTimeout(() => {
            handle.dispose();
            cleanup();
            reject(new Error(`extension host subprocess did not become ready in ${String(timeoutMs)}ms`));
        }, timeoutMs);
        const cleanup = (): void => {
            child.off("exit", onExit);
            clearTimeout(timer);
        };
        child.once("exit", onExit);
    });
}

function waitForExit(child: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
        if (child.exitCode !== null || child.killed) {
            resolve();
            return;
        }
        child.once("exit", () => {
            resolve();
        });
    });
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Линейно-буферизованная подписка на `Readable` (stdout/stderr subprocess'а).
 * Каждую полную строку (`\n`-delimited) пишем как одну запись лога. Хвост без
 * `\n` сбрасываем при `end`.
 */
function pipeStreamToLogger(stream: NodeJS.ReadableStream, logger: ILogger, level: "info" | "warn"): void {
    stream.setEncoding("utf8");
    let buffer = "";
    stream.on("data", (chunk: string) => {
        buffer += chunk;
        let nl = buffer.indexOf("\n");
        while (nl !== -1) {
            const line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            if (line.length > 0) {
                if (level === "warn") logger.warn(line);
                else logger.info(line);
            }
            nl = buffer.indexOf("\n");
        }
    });
    stream.on("end", () => {
        if (buffer.length > 0) {
            if (level === "warn") logger.warn(buffer);
            else logger.info(buffer);
            buffer = "";
        }
    });
}
