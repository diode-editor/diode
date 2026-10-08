import * as nodePath from "node:path";

import type * as vscode from "vscode";

import { detectEndOfLine, EndOfLine as CoreEndOfLine } from "../../../editor/common/core/endOfLine.ts";
import { decodeBuffer } from "../../../editor/common/model/encoding.ts";
import { filesExcludeGlobs } from "../../common/configuration/excludeSettings.ts";

import { implementsApi } from "./apiSurface.ts";
import { ExtHostTextDocument } from "./extHostDocuments.ts";
import { serializeWillSaveTextEdit, serializeWorkspaceEdit } from "./extHostTypeConverters.ts";
import { createFileSystemNamespace, SubprocessFileSystemProviders } from "./fileSystemNamespace.ts";
import { resolveGlobPattern, SubprocessFileSystemWatchers } from "./fileWatcherNamespace.ts";
import { findFiles as walkForFiles } from "./findFiles.ts";
import { SubprocessTextDocumentContentProviders } from "./subprocessTextDocumentContentProviders.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import {
    ConfigurationTarget,
    DisposableImpl,
    EndOfLine,
    EventEmitter,
    FileSystemError,
    TextDocumentSaveReason,
    TextEdit,
    Uri,
    WorkspaceEdit,
} from "./vscodeTypes.ts";
import {
    type IWireApplyWorkspaceEditParams,
    type IWireReadFileResult,
    type IWireTextContentResult,
    type IWireWorkspaceFolder,
    parseWireDocumentChangedEvent,
    parseWireDocumentSyncSnapshot,
    parseWireWatcherEvents,
    type WireConfigurationTarget,
    type WireTextEdit,
} from "./wireTypes.ts";
import type { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

/** Тайм-аут на один waitUntil-thenable участника will-save, мс. */
const WILL_SAVE_LISTENER_TIMEOUT_MS = 1500;

/**
 * Базы, по которым идёт `findFiles`, и шаблон относительно каждой.
 *
 * Строковый шаблон в контракте означает «во ВСЕХ папках воркспейса» (в отличие
 * от `createFileSystemWatcher`, где у нас берётся первая): у поиска результат
 * складывается, и терять папки нельзя. `RelativePattern` сам несёт свою базу —
 * именно им расширение сужает поиск до одной папки.
 */
function findFilesBases(
    include: unknown,
    workspaceFolders: readonly IWorkspaceFolder[],
): { base: string; pattern: string }[] {
    if (typeof include === "string") {
        return workspaceFolders.map((folder) => ({ base: folder.uri.fsPath, pattern: include }));
    }
    const resolved = resolveGlobPattern(include, undefined);
    return resolved === null ? [] : [{ base: resolved.base, pattern: resolved.pattern }];
}

/**
 * Шаблоны исключения по трём значениям аргумента, как в контракте: `undefined` —
 * дефолты `files.exclude`, `null` — не исключать ничего, шаблон — только он
 * (настройка при этом НЕ добавляется).
 *
 * Дефолт — буквально настройка `files.exclude` и только она: «default
 * file-excludes (e.g. the `files.exclude`-setting but not `search.exclude`)»
 * в контракте. `search.exclude` сюда не входит сознательно — расширение ищет
 * файл, чтобы с ним работать, а не чтобы показать человеку результат поиска.
 * Настройка приезжает в субпроцесс снапшотом (см. {@link WorkspaceConfigStore}),
 * поэтому читается синхронно и на каждый вызов — правка применяется к
 * следующему же `findFiles`.
 *
 * Явной ветки под `null` нет: `resolveGlobPattern` отвечает на него тем же
 * `null`, что и на любое неразбираемое значение, — а «разобрать нечем» и
 * «исключений нет» для обхода одно и то же.
 *
 * `RelativePattern` в исключении разбирается ради его `pattern`: матчим мы
 * относительно базы ПОИСКА, а не базы исключения — своя база у исключения
 * значила бы второй корень, которого у обхода нет.
 */
function findFilesExcludes(exclude: unknown, base: string, configStore: WorkspaceConfigStore): readonly string[] {
    if (exclude === undefined) return filesExcludeGlobs(configStore);
    const pattern = resolveGlobPattern(exclude, base)?.pattern;
    // Stryker disable next-line ArrayDeclaration: мутант эквивалентен — «ни одного шаблона» и «шаблон, не совпадающий ни с одним путём» для обхода неразличимы; сам контракт («мусорный exclude не исключает ничего») закрыт тестом
    return pattern === undefined ? [] : [pattern];
}

/** Промис, резолвящийся пустым набором правок по истечении per-listener тайм-аута. */
function listenerTimeout(): Promise<readonly TextEdit[]> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            resolve([]);
        }, WILL_SAVE_LISTENER_TIMEOUT_MS);
        // Не держим event loop живым из-за таймера, который проиграл гонку.
        timer.unref();
    });
}

/** Валидный Event, который никогда не стреляет (хост его не фаерит). */
function naiveEvent<T = never>(): vscode.Event<T> {
    return new EventEmitter<T>().event;
}

/**
 * То же, но с пустой полезной нагрузкой (`Event<void>` у upstream). Отдельная
 * обёртка, а не `naiveEvent<void>()`: `void` допустим в аннотации возврата, но
 * не явным type-аргументом вызова.
 */
function naiveVoidEvent(): vscode.Event<void> {
    return naiveEvent();
}

/** Wire-параметры запроса will-save (host → subprocess). */
interface IWireWillSaveParams {
    /** Ресурс как `uri.toString()`. */
    readonly uri: string;
    readonly languageId?: string;
    readonly isDirty?: boolean;
    readonly version?: number;
    readonly reason?: number;
    /** `vscode.EndOfLine`: 1=LF, 2=CRLF. */
    readonly eol?: number;
    /** Кодировка дискового представления (id вида "utf8"/"windows1251"). */
    readonly encoding?: string;
}

/** Папка воркспейса, полученная из `workspace.initialize`. */
interface IWorkspaceFolder {
    readonly uri: Uri;
    readonly name: string;
    readonly index: number;
}

/**
 * `vscode.workspace` на стороне subprocess.
 *
 * Конфигурация приходит push-моделью в {@link IVscodeHostContext.configStore}
 * через notif'ы `workspace.initialize` / `workspace.configurationChanged`
 * (см. host). `getConfiguration().get()` синхронный — читает из уже полученного
 * снапшота. Регистрация save-слушателей шлёт `workspace.updateSubscriptions`
 * на переходах 0↔1 (исполнение will-save — WP6).
 */
/**
 * `languageId` из scope `getConfiguration`: у `TextDocument` и у `{ uri, languageId }`
 * он полем. Значение не проверяем: секции под непонятный идентификатор нет, и
 * чтение просто вернёт значения без неё.
 */
function languageIdOfScope(scope: unknown): string | undefined {
    if (typeof scope !== "object" || scope === null || !("languageId" in scope)) return undefined;
    return String(scope.languageId);
}

/**
 * Ресурс из scope `getConfiguration` (`scopeToOverrides` эталона): сам `Uri`
 * либо `uri` у `TextDocument`, `WorkspaceFolder`, `{ uri, languageId }`.
 */
function resourceOfScope(scope: unknown): string | undefined {
    if (scope instanceof Uri) return scope.toString();
    if (typeof scope !== "object" || scope === null || !("uri" in scope)) return undefined;
    return scope.uri instanceof Uri ? scope.uri.toString() : undefined;
}

/**
 * Цель записи (`parseConfigurationTarget` эталона): `true`/Global — user,
 * `false`/Workspace — воркспейс, WorkspaceFolder — папка; прочее — цель не
 * задана, её выводит хост.
 */
function parseConfigurationTarget(arg: unknown): WireConfigurationTarget | undefined {
    if (typeof arg === "boolean") return arg ? "user" : "workspace";
    switch (arg) {
        case ConfigurationTarget.Global:
            return "user";
        case ConfigurationTarget.Workspace:
            return "workspace";
        case ConfigurationTarget.WorkspaceFolder:
            return "workspaceFolder";
    }
    return undefined;
}

export function createWorkspaceNamespace(ctx: IVscodeHostContext): typeof vscode.workspace {
    const { rpc, registry, documentSync, configStore } = ctx;

    let workspaceFolders: IWorkspaceFolder[] = [];

    // ── Провайдеры ФС по схеме ──────────────────────────────────────────────
    // Расширение регистрирует провайдера (`git:` у встроенного git), субпроцесс
    // объявляет хосту список схем, а хост читает ресурс обратным запросом. Логика
    // реестра — в fileSystemNamespace (тестируется без RPC), здесь только проводка.
    const fsProviders = new SubprocessFileSystemProviders();

    fsProviders.onDidChangeSchemes(() => {
        rpc.notify("workspace.fileSystemProvidersChanged", { schemes: fsProviders.schemes() });
    });
    fsProviders.onDidChangeFile((uris) => {
        rpc.notify("workspace.fs.didChangeFile", { uris: uris.map((u) => u.toString()) });
    });

    rpc.handleRequest("workspace.fs.readFile", async (params): Promise<IWireReadFileResult> => {
        const p: { uri?: unknown } = params;
        if (typeof p.uri !== "string") throw new Error("workspace.fs.readFile: uri must be a string");
        const uri = Uri.parse(p.uri);
        const provider = fsProviders.get(uri.scheme);
        if (provider === undefined) throw new Error(`no file system provider for scheme "${uri.scheme}"`);
        const content = await provider.readFile(uri);
        return { content: Buffer.from(content).toString("base64") };
    });

    // ── Провайдеры содержимого по схеме ─────────────────────────────────────
    // Дверь для документов, которых нет на диске (`jdt:` у redhat.java: класс
    // из jar, исходник JDK, декомпиляция). Проводка та же, что у провайдеров
    // ФС: субпроцесс объявляет схемы, хост спрашивает содержимое обратным
    // запросом. Логика реестра — в subprocessTextDocumentContentProviders.
    const contentProviders = new SubprocessTextDocumentContentProviders();

    contentProviders.onDidChangeSchemes(() => {
        rpc.notify("workspace.textDocumentContentProvidersChanged", { schemes: contentProviders.schemes() });
    });
    contentProviders.onDidChange((uri) => {
        rpc.notify("workspace.textDocumentContentChanged", { uri: uri.toString() });
    });

    rpc.handleRequest(
        "workspace.provideTextDocumentContent",
        async (params, cancellation): Promise<IWireTextContentResult> => {
            const p: { uri?: unknown } = params;
            if (typeof p.uri !== "string") {
                throw new Error("workspace.provideTextDocumentContent: uri must be a string");
            }
            const uri = Uri.parse(p.uri);
            if (!contentProviders.has(uri.scheme)) {
                throw new Error(`no text document content provider for scheme "${uri.scheme}"`);
            }
            return { content: await contentProviders.provide(uri, cancellation) };
        },
    );

    // ── Файловые watcher'ы (`createFileSystemWatcher`) ──────────────────────
    // Слежение ведёт ядро: оно владеет excludes (`files.watcherExclude`) и
    // бюджетом inotify. Субпроцесс держит только эмиттеры и id.
    const fsWatchers = new SubprocessFileSystemWatchers({
        create: (request) => {
            rpc.notify("workspace.watcher.create", request);
        },
        dispose: (id) => {
            rpc.notify("workspace.watcher.dispose", { id });
        },
    });
    rpc.handleNotification("workspace.watcher.events", (params) => {
        const events = parseWireWatcherEvents(params);
        if (events !== null) fsWatchers.dispatch(events);
    });

    const onDidChangeConfigurationEmitter = new EventEmitter<vscode.ConfigurationChangeEvent>();
    // didOpen/didChange живут в DocumentSyncTracker (единая точка входа текста в
    // реестр — ей пользуются и document sync, и languages.provide*-обработчики).
    const onDidOpenTextDocumentEmitter = documentSync.onDidOpenEmitter;
    const onDidCloseTextDocumentEmitter = new EventEmitter<vscode.TextDocument>();
    const onDidChangeTextDocumentEmitter = documentSync.onDidChangeEmitter;
    const onWillSaveTextDocumentEmitter = new EventEmitter<vscode.TextDocumentWillSaveEvent>();
    const onDidSaveTextDocumentEmitter = new EventEmitter<vscode.TextDocument>();

    // Счётчики слушателей save-событий и document sync: subprocess сообщает хосту
    // (updateSubscriptions), нужно ли вообще запускать pipeline will/did-save и
    // гонять полнотекстовый didOpen/didChange на правки буфера.
    let willSaveCount = 0;
    let didSaveCount = 0;
    let documentSyncCount = 0;
    function pushSubscriptions(): void {
        rpc.notify("workspace.updateSubscriptions", {
            willSave: willSaveCount > 0,
            didSave: didSaveCount > 0,
            documentSync: documentSyncCount > 0,
        });
    }

    /**
     * Оборачивает событие в подписку со счётчиком: на переходах 0↔1 subprocess
     * шлёт `workspace.updateSubscriptions` (паттерн onWillSaveTextDocument).
     */
    function countedEvent<T>(
        emitter: EventEmitter<T>,
        onCountChanged: (delta: 1 | -1) => void,
    ): (listener: (e: T) => unknown, thisArgs?: unknown, disposables?: vscode.Disposable[]) => vscode.Disposable {
        return (listener, thisArgs, disposables) => {
            // Внутреннюю подписку регистрируем без `disposables` — в массив кладём
            // wrapper, чтобы dispose через него корректно уменьшал счётчик.
            const inner = emitter.event(listener as never, thisArgs);
            onCountChanged(1);
            const wrapper = new DisposableImpl(() => {
                inner.dispose();
                onCountChanged(-1);
            });
            if (disposables !== undefined) disposables.push(wrapper);
            return wrapper;
        };
    }

    function onDocumentSyncCountChanged(delta: 1 | -1): void {
        documentSyncCount += delta;
        if ((delta === 1 && documentSyncCount === 1) || (delta === -1 && documentSyncCount === 0)) {
            pushSubscriptions();
        }
    }

    // ── Document sync (host → subprocess) ───────────────────────────────────
    // Зеркало документа: снапшот на открытии (новый ресурс → didOpen, один раз,
    // как в VS Code), дальше — правки модели с её versionId. Замена содержимого
    // целиком (flush) приезжает снапшотом в didChange и расходится одной
    // full-range правкой. Никакой записи текста мимо трекера.
    rpc.handleNotification("editor.didOpen", (params) => {
        const snap = parseWireDocumentSyncSnapshot(params);
        if (snap !== null) documentSync.open(snap);
    });

    rpc.handleNotification("editor.didChange", (params) => {
        const event = parseWireDocumentChangedEvent(params);
        if (event !== null) {
            documentSync.change(event);
            return;
        }
        const snap = parseWireDocumentSyncSnapshot(params);
        if (snap !== null) documentSync.open(snap);
    });

    // Последняя вкладка ресурса закрыта: сброс didOpen-дедупа + isClosed +
    // onDidCloseTextDocument (сервер получает LSP didClose и снова didOpen при
    // повторном открытии — люфт из docs/TODO/LSP.md закрыт).
    rpc.handleNotification("editor.didClose", (params) => {
        const p: { uri?: unknown } = params;
        if (typeof p.uri !== "string" || p.uri === "") return;
        const doc = documentSync.close(Uri.parse(p.uri));
        if (doc !== null) onDidCloseTextDocumentEmitter.fire(doc);
    });

    rpc.handleNotification("workspace.initialize", (params) => {
        const p: { configuration?: unknown; workspaceFolders?: readonly IWireWorkspaceFolder[] } = params;
        configStore.setData(p.configuration);
        workspaceFolders = (p.workspaceFolders ?? []).map((f) => ({
            uri: Uri.parse(f.uri),
            name: f.name,
            index: f.index,
        }));
    });

    rpc.handleNotification("workspace.configurationChanged", (params) => {
        const p: { configuration?: unknown; affectedKeys?: readonly string[] } = params;
        configStore.setData(p.configuration);
        const affectedKeys = p.affectedKeys ?? [];
        onDidChangeConfigurationEmitter.fire({
            affectsConfiguration: (section: string): boolean =>
                affectedKeys.some((key) => key === section || key.startsWith(section + ".")),
        });
    });

    // Хост запрашивает pre-save правки: документ — из зеркала (текста запрос не
    // везёт; устаревший или не открытый — правок нет), мета сохранения — из
    // запроса; фаерим onWillSaveTextDocument, собираем waitUntil-thenable'ы (по
    // одному per-listener таймауту), сериализуем полученные TextEdit[].
    rpc.handleRequest("workspace.willSaveTextDocument", async (params): Promise<WireTextEdit[]> => {
        const p: IWireWillSaveParams = params;
        const doc = documentSync.resolve(p.uri, p.version, p.languageId);
        if (doc === null) return [];
        doc.applyMeta({
            uri: p.uri,
            isDirty: p.isDirty,
            ...(p.eol === 1 || p.eol === 2 ? { eol: p.eol } : {}),
            ...(typeof p.encoding === "string" ? { encoding: p.encoding } : {}),
        });
        const thenables: Thenable<readonly vscode.TextEdit[]>[] = [];
        let collecting = true;
        const event: vscode.TextDocumentWillSaveEvent = {
            document: doc,
            reason: p.reason ?? TextDocumentSaveReason.Manual,
            waitUntil: (thenable: Thenable<unknown>): void => {
                // waitUntil валиден только во время диспетча события (как в VS Code).
                if (collecting) thenables.push(Promise.resolve(thenable) as Thenable<readonly vscode.TextEdit[]>);
            },
        };
        onWillSaveTextDocumentEmitter.fire(event);
        collecting = false;

        const settled = await Promise.all(
            thenables.map((thenable) =>
                Promise.race([
                    Promise.resolve(thenable).catch(() => [] as readonly vscode.TextEdit[]),
                    listenerTimeout(),
                ]),
            ),
        );
        const edits: WireTextEdit[] = [];
        for (const result of settled) {
            if (!Array.isArray(result)) continue;
            for (const edit of result) {
                const wire = edit instanceof TextEdit ? serializeWillSaveTextEdit(edit) : null;
                if (wire !== null) edits.push(wire);
            }
        }
        return edits;
    });

    // Хост сообщил о состоявшемся сохранении — фаерим onDidSaveTextDocument.
    rpc.handleNotification("workspace.didSaveTextDocument", (params) => {
        const p: { uri?: unknown; languageId?: unknown } = params;
        if (typeof p.uri !== "string") return;
        const doc = registry.upsertMeta({
            uri: p.uri,
            ...(typeof p.languageId === "string" ? { languageId: p.languageId } : {}),
        });
        onDidSaveTextDocumentEmitter.fire(doc);
    });

    function getConfiguration(section?: string, scope?: unknown): vscode.WorkspaceConfiguration {
        const prefix = section !== undefined && section !== "" ? section + "." : "";
        // Язык из scope — `TextDocument` или `{ languageId }` (`scopeToOverrides` vscode):
        // поверх значений ложится секция `"[<язык>]"`.
        const languageId = languageIdOfScope(scope);
        // Значения настроек нетипизированы: `T` у get/inspect — утверждение
        // вызывающего о форме значения (как в эталоне), проверить его нечем.
        const config: vscode.WorkspaceConfiguration & Record<string, unknown> = {
            get: <T>(key: string, defaultValue?: T): T | undefined =>
                configStore.get(prefix + key, defaultValue, languageId) as T | undefined,
            has: (key: string): boolean => configStore.has(prefix + key, languageId),
            inspect: <T>(key: string) => {
                const r = configStore.inspect(prefix + key, languageId);
                return {
                    key: r.key,
                    defaultValue: r.defaultValue as T | undefined,
                    globalValue: r.globalValue as T | undefined,
                    workspaceValue: r.workspaceValue as T | undefined,
                    workspaceFolderValue: undefined,
                };
            },
            update: (key: string, value: unknown, target?: unknown, overrideInLanguage?: boolean) =>
                updateConfiguration(prefix + key, value, target, overrideInLanguage, scope, languageId),
        };
        // VS Code выставляет значения секции как поля объекта конфигурации.
        for (const key of configStore.sectionKeys(section, languageId)) {
            if (key in config) continue; // не затираем get/has/inspect/update
            config[key] = configStore.get(prefix + key, undefined, languageId);
        }
        return config;
    }

    /**
     * `WorkspaceConfiguration.update` (эталон: `extHostConfiguration` →
     * `mainThreadConfiguration.$updateConfigurationOption`). Пишет хост — тем же
     * сервисом настроек, что ядро; отказ приходит rejected promise без тоста.
     * К резолву новое значение уже приехало `configurationChanged`: хост шлёт его
     * по тому же каналу раньше ответа.
     */
    async function updateConfiguration(
        key: string,
        value: unknown,
        targetArg: unknown,
        overrideInLanguage: boolean | undefined,
        scope: unknown,
        languageId: string | undefined,
    ): Promise<void> {
        const target = parseConfigurationTarget(targetArg);
        // Секцию `"[lang]"` эталон выбирает, когда scope несёт язык и
        // `overrideInLanguage` — либо явно `true`, либо не задан, а в целевом
        // слое у языка уже есть своё значение. Такую запись мы пока не умеем —
        // честный отказ, а не запись мимо секции, которую `get()` для языка
        // всё равно перекроет.
        if (languageId !== undefined) {
            const layer = target === "user" ? "user" : "workspace";
            const toSection = overrideInLanguage ?? configStore.hasLanguageOverride(key, languageId, layer);
            if (toSection) {
                throw new Error(
                    `Unable to write ${key} to the "[${languageId}]" section: language-specific settings writes are not supported.`,
                );
            }
        }
        const resource = resourceOfScope(scope);
        await rpc.request("configuration.update", {
            key,
            ...(value !== undefined ? { value } : {}),
            ...(target !== undefined ? { target } : {}),
            ...(resource !== undefined ? { resource } : {}),
        });
    }

    function asRelativePath(pathOrUri: string | vscode.Uri, includeWorkspaceFolder?: boolean): string {
        const p = typeof pathOrUri === "string" ? pathOrUri : pathOrUri.fsPath;
        for (const folder of workspaceFolders) {
            const root = folder.uri.fsPath;
            if (p === root || p.startsWith(root + "/")) {
                const rel = p.slice(root.length).replace(/^\/+/, "");
                if (rel === "") return p;
                return includeWorkspaceFolder === true && workspaceFolders.length > 1 ? folder.name + "/" + rel : rel;
            }
        }
        return p;
    }

    async function openTextDocument(
        uriOrPath: vscode.Uri | string,
        options?: { encoding?: string },
    ): Promise<vscode.TextDocument> {
        // Строка здесь — путь на диске (перегрузка `openTextDocument(path)`), а не uri.
        const uri = typeof uriOrPath === "string" ? Uri.file(uriOrPath) : uriOrPath;
        // Открытый документ — отдаём стабильный объект из реестра.
        const open = registry.get(uri);
        if (open !== undefined) return open;

        // Схема с зарегистрированным провайдером содержимого — спрашиваем его,
        // как это делает эталон («For all other schemes contributed text document
        // content providers … are consulted»). RPC здесь не нужен: провайдер
        // живёт в этом же субпроцессе.
        if (contentProviders.has(uri.scheme)) {
            const content = await contentProviders.provide(uri);
            if (content === null) throw FileSystemError.FileNotFound(uri);
            return makeEphemeralDocument(uri, content, "utf8");
        }

        // Промах реестра: читаем файл с диска в ЭФЕМЕРНЫЙ документ (в реестр не
        // кладём — это не открытый буфер). Читать умеем только с диска, поэтому для
        // не-file схемы честно отказываем, а не скармливаем `fsPath` в node:fs
        // (у не-file схем это не путь).
        if (uri.scheme !== "file") throw FileSystemError.Unavailable(uri);

        // Читаем сырые байты и декодируем осью encoding ядра: explicit-кодировка
        // из options побеждает BOM-сниф; неизвестный id по контракту vscode.d.ts
        // молча откатывается к дефолтному пути (BOM-сниф → utf-8). EOL для
        // эфемерного документа детектим из текста — как делает ядро.
        const buffer = await ctx.disk.readFile(uri.fsPath);
        const { text, encoding } = decodeBuffer(buffer, options?.encoding);
        return makeEphemeralDocument(uri, text, encoding);
    }

    /** Документ вне реестра открытых буферов: EOL детектим из текста, как ядро. */
    function makeEphemeralDocument(uri: Uri, text: string, encoding: string): ExtHostTextDocument {
        const doc = new ExtHostTextDocument(uri);
        doc.applyFull({
            uri: uri.toString(),
            text,
            encoding,
            eol: detectEndOfLine(text) === CoreEndOfLine.CRLF ? EndOfLine.CRLF : EndOfLine.LF,
        });
        return doc;
    }

    const workspaceNs = {
        get workspaceFolders(): readonly vscode.WorkspaceFolder[] | undefined {
            return workspaceFolders.length === 0 ? undefined : workspaceFolders;
        },

        get name(): string | undefined {
            return workspaceFolders[0]?.name;
        },

        get textDocuments(): readonly vscode.TextDocument[] {
            return registry.all();
        },

        // workspace.fs — локальный доступ к диску субпроцесса (без RPC).
        fs: createFileSystemNamespace(ctx.disk.fs, fsProviders),

        registerFileSystemProvider: (scheme: string, provider: vscode.FileSystemProvider): vscode.Disposable => {
            const registration = fsProviders.register(scheme, provider);
            return new DisposableImpl(() => {
                registration.dispose();
            });
        },

        getConfiguration,
        asRelativePath,
        // Точечный каст: перегрузки `openTextDocument(options?: { language,
        // content })` — безымянного документа — у нас нет (новый функционал);
        // такой вызов падает в ветку «не-file схема» и отклоняется.
        openTextDocument: openTextDocument as unknown as typeof vscode.workspace.openTextDocument,

        onDidChangeConfiguration: onDidChangeConfigurationEmitter.event,
        // Подписки document sync — со счётчиком: пока их нет, host не гоняет
        // полнотекстовые didOpen/didChange RPC на каждую правку буфера.
        onDidOpenTextDocument: countedEvent(onDidOpenTextDocumentEmitter, onDocumentSyncCountChanged),
        onDidChangeTextDocument: countedEvent(onDidChangeTextDocumentEmitter, onDocumentSyncCountChanged),
        onDidCloseTextDocument: onDidCloseTextDocumentEmitter.event,

        // ── Наивная поверхность, которую трогает vscode-languageclient. События,
        // которых хост пока не фаерит, — валидные (никогда не стреляющие)
        // Event'ы; шаги закрытия — таблица стабов в docs/TODO/LSP.md. ──────────
        onDidChangeWorkspaceFolders: naiveEvent(),
        onDidCreateFiles: naiveEvent(),
        onDidDeleteFiles: naiveEvent(),
        onDidRenameFiles: naiveEvent(),
        onWillCreateFiles: naiveEvent(),
        onWillDeleteFiles: naiveEvent(),
        onWillRenameFiles: naiveEvent(),
        onDidOpenNotebookDocument: naiveEvent(),
        onDidCloseNotebookDocument: naiveEvent(),
        onDidChangeNotebookDocument: naiveEvent(),
        onDidSaveNotebookDocument: naiveEvent(),
        notebookDocuments: [] as readonly unknown[],
        // `workspace.applyEdit`: текстовые правки уезжают хосту одним запросом
        // и применяются per-документ undoable-батчами (см. `IEditorOptionsService`).
        // Файловые операции WorkspaceEdit не поддержаны — честный `false` без
        // запроса: VS Code применяет такой edit атомарно, «наполовину» нельзя.
        applyEdit: (edit: vscode.WorkspaceEdit): Thenable<boolean> => {
            if (!(edit instanceof WorkspaceEdit)) return Promise.resolve(false);
            const ops = serializeWorkspaceEdit(edit);
            // Операция из одних битых правок — отказ всего edit'а (all-or-nothing).
            if (ops === null) return Promise.resolve(false);
            // Пустой edit (или один шум вроде чистых EOL-правок) — вакуумный
            // успех, как у VS Code: применять нечего, но и отказа нет.
            if (ops.length === 0) return Promise.resolve(true);
            const params: IWireApplyWorkspaceEditParams = { ops };
            return rpc.request("workspace.applyEdit", params);
        },
        // Файл ВНЕ папок воркспейса — `undefined`, как в эталоне («Returns
        // `undefined` when the given uri doesn't match any workspace folder»).
        // Раньше здесь стоял fallback на `workspaceFolders[0]`: в однопапочном
        // мире почти безобидный, а в мульти-руте — источник неверной адресации,
        // на котором расширения успели бы устаканиться.
        getWorkspaceFolder: (uri: vscode.Uri): vscode.WorkspaceFolder | undefined => {
            const p = uri.fsPath;
            const found = workspaceFolders.find((f) => p === f.uri.fsPath || p.startsWith(f.uri.fsPath + "/"));
            return found;
        },
        createFileSystemWatcher: (
            globPattern: vscode.GlobPattern,
            ignoreCreateEvents = false,
            ignoreChangeEvents = false,
            ignoreDeleteEvents = false,
        ): vscode.FileSystemWatcher => {
            const resolved = resolveGlobPattern(globPattern, workspaceFolders[0]?.uri.fsPath);
            // Нечего резолвить (пустое окно или мусорный шаблон) — валидный,
            // но немой watcher: расширение не обязано это проверять.
            if (resolved === null) {
                return fsWatchers.createInert(ignoreCreateEvents, ignoreChangeEvents, ignoreDeleteEvents);
            }
            return fsWatchers.create(resolved, ignoreCreateEvents, ignoreChangeEvents, ignoreDeleteEvents);
        },
        /**
         * Поиск файлов по glob — свой обход дерева в субпроцессе (за эталонным
         * `findFiles` стоит ripgrep в ядре; см. `findFiles.ts` о том, почему
         * обход живёт здесь, а не на хосте).
         *
         * Строковый шаблон означает «во всех папках воркспейса», как в эталоне;
         * `RelativePattern` ограничивает поиск своей базой. Результат — пути
         * абсолютными `file:`-Uri, `maxResults` считается по всем папкам вместе.
         */
        findFiles: async (
            include: vscode.GlobPattern,
            exclude?: vscode.GlobPattern | null,
            maxResults?: number,
            token?: vscode.CancellationToken,
        ): Promise<vscode.Uri[]> => {
            const results: Uri[] = [];
            const isCancelled = (): boolean => token?.isCancellationRequested === true;
            // Ни отмену, ни исчерпанный `maxResults` здесь отдельно не ловим:
            // обход сам возвращает пустой список и на отменённом токене, и на
            // нулевом остатке, а вторая проверка того же условия — лишний шов.
            for (const resolved of findFilesBases(include, workspaceFolders)) {
                const relativePaths = await walkForFiles(
                    ctx.disk.findFilesScanner,
                    {
                        base: resolved.base,
                        include: resolved.pattern,
                        excludes: findFilesExcludes(exclude, resolved.base, configStore),
                        // Остаток на все папки вместе: `maxResults` в контракте
                        // ограничивает результат целиком, а не каждую папку.
                        maxResults: (maxResults ?? Number.POSITIVE_INFINITY) - results.length,
                    },
                    { isCancelled },
                );
                for (const relativePath of relativePaths)
                    results.push(Uri.file(nodePath.join(resolved.base, relativePath)));
            }
            return results;
        },

        registerTextDocumentContentProvider: (
            scheme: string,
            provider: vscode.TextDocumentContentProvider,
        ): vscode.Disposable => {
            const registration = contentProviders.register(scheme, provider);
            return new DisposableImpl(() => {
                registration.dispose();
            });
        },

        // Модели доверия воркспейса у Diode нет — открытое всегда доверено
        // (как VS Code с выключенным workspace trust). Ruff по этому флагу
        // выбирает между native server и legacy ruff-lsp; `false` уводил бы
        // его в принудительный bundled-путь с предупреждением в логе.
        isTrusted: true,
        onDidGrantWorkspaceTrust: naiveVoidEvent(),

        onWillSaveTextDocument: (
            listener: (e: vscode.TextDocumentWillSaveEvent) => unknown,
            thisArgs?: unknown,
            disposables?: vscode.Disposable[],
        ): vscode.Disposable => {
            // Внутреннюю подписку регистрируем без `disposables` — в массив кладём
            // wrapper, чтобы dispose через него корректно уменьшал счётчик.
            const inner = onWillSaveTextDocumentEmitter.event(listener as never, thisArgs);
            willSaveCount++;
            if (willSaveCount === 1) pushSubscriptions();
            const wrapper = new DisposableImpl(() => {
                inner.dispose();
                willSaveCount--;
                if (willSaveCount === 0) pushSubscriptions();
            });
            if (disposables !== undefined) disposables.push(wrapper);
            return wrapper;
        },

        onDidSaveTextDocument: (
            listener: (e: vscode.TextDocument) => unknown,
            thisArgs?: unknown,
            disposables?: vscode.Disposable[],
        ): vscode.Disposable => {
            const inner = onDidSaveTextDocumentEmitter.event(listener as never, thisArgs);
            didSaveCount++;
            if (didSaveCount === 1) pushSubscriptions();
            const wrapper = new DisposableImpl(() => {
                inner.dispose();
                didSaveCount--;
                if (didSaveCount === 0) pushSubscriptions();
            });
            if (disposables !== undefined) disposables.push(wrapper);
            return wrapper;
        },
    };

    return implementsApi<typeof vscode.workspace>()(workspaceNs);
}
