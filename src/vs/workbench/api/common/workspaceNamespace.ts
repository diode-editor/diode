import * as nodePath from "node:path";

import type * as vscode from "vscode";

import { detectEndOfLine, EndOfLine as CoreEndOfLine } from "../../../editor/common/core/endOfLine.ts";
import { decodeBuffer } from "../../../editor/common/model/encoding.ts";
import { workspaceFileLabel } from "../../../platform/workspace/common/workspaceFile.ts";
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
    type IWireFileStat,
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
import { simulateWorkspaceFoldersUpdate } from "./workspaceFoldersUpdate.ts";

/** На один waitUntil-thenable. */
const WILL_SAVE_LISTENER_TIMEOUT_MS = 1500;

/**
 * Строковый шаблон — во ВСЕХ папках воркспейса (у `createFileSystemWatcher` —
 * в первой): результат поиска складывается, терять папки нельзя.
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
 * `undefined` — только `files.exclude`, без `search.exclude` (так в контракте);
 * `null` — ничего, явная ветка не нужна: `resolveGlobPattern` отвечает на него `null`.
 * Шаблон `RelativePattern` матчим относительно базы ПОИСКА — второго корня у обхода нет.
 */
function findFilesExcludes(exclude: unknown, base: string, configStore: WorkspaceConfigStore): readonly string[] {
    if (exclude === undefined) return filesExcludeGlobs(configStore);
    const pattern = resolveGlobPattern(exclude, base)?.pattern;
    // Stryker disable next-line ArrayDeclaration: мутант эквивалентен — «ни одного шаблона» и «шаблон, не совпадающий ни с одним путём» для обхода неразличимы; сам контракт («мусорный exclude не исключает ничего») закрыт тестом
    return pattern === undefined ? [] : [pattern];
}

function listenerTimeout(): Promise<readonly TextEdit[]> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            resolve([]);
        }, WILL_SAVE_LISTENER_TIMEOUT_MS);
        timer.unref();
    });
}

function naiveEvent<T = never>(): vscode.Event<T> {
    return new EventEmitter<T>().event;
}

/** Не `naiveEvent<void>()`: `void` нельзя явным type-аргументом вызова (линт). */
function naiveVoidEvent(): vscode.Event<void> {
    return naiveEvent();
}

interface IWireWillSaveParams {
    readonly uri: string;
    readonly languageId?: string;
    readonly isDirty?: boolean;
    readonly version?: number;
    readonly reason?: number;
    /** `vscode.EndOfLine`: 1=LF, 2=CRLF. */
    readonly eol?: number;
    readonly encoding?: string;
}

interface IUntitledDocumentOptions {
    readonly content?: string;
    readonly language?: string;
    readonly encoding?: string;
}

interface IWorkspaceFolder {
    readonly uri: Uri;
    readonly name: string;
    readonly index: number;
}

/** Значение не проверяем: секции под непонятный язык нет, чтение вернёт значения без неё. */
function languageIdOfScope(scope: unknown): string | undefined {
    if (typeof scope !== "object" || scope === null || !("languageId" in scope)) return undefined;
    return String(scope.languageId);
}

/** Как `scopeToOverrides` эталона. */
function resourceOfScope(scope: unknown): string | undefined {
    if (scope instanceof Uri) return scope.toString();
    if (typeof scope !== "object" || scope === null || !("uri" in scope)) return undefined;
    return scope.uri instanceof Uri ? scope.uri.toString() : undefined;
}

/** `undefined` — цель не задана, её выводит хост. */
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

/**
 * `registerTaskProvider` приходит снаружи: `tasks` собирается позже `workspace`
 * и ждёт его папки.
 */
export function createWorkspaceNamespace(
    ctx: IVscodeHostContext,
    registerTaskProvider: (type: string, provider: vscode.TaskProvider) => vscode.Disposable = () =>
        new DisposableImpl(() => undefined),
): typeof vscode.workspace {
    const { rpc, registry, documentSync, configStore } = ctx;
    registry.saver = async (uri) => (await rpc.request("workspace.save", { uri: uri.toString() })) !== null;

    let workspaceFolders: IWorkspaceFolder[] = [];
    let workspaceFile: vscode.Uri | undefined;

    const fsProviders = new SubprocessFileSystemProviders();

    fsProviders.onDidChangeSchemes(() => {
        rpc.notify("workspace.fileSystemProvidersChanged", {
            schemes: fsProviders.schemes(),
            readonly: fsProviders.readonly(),
        });
    });
    fsProviders.onDidChangeFile((uris) => {
        rpc.notify("workspace.fs.didChangeFile", { uris: uris.map((u) => u.toString()) });
    });

    function providedResource(method: string, raw: unknown): { uri: Uri; provider: vscode.FileSystemProvider } {
        if (typeof raw !== "string") throw new Error(`${method}: uri must be a string`);
        const uri = Uri.parse(raw);
        const provider = fsProviders.get(uri.scheme);
        if (provider === undefined) throw new Error(`no file system provider for scheme "${uri.scheme}"`);
        return { uri, provider };
    }

    rpc.handleRequest("workspace.fs.readFile", async (params): Promise<IWireReadFileResult> => {
        const p: { uri?: unknown } = params;
        const { uri, provider } = providedResource("workspace.fs.readFile", p.uri);
        const content = await provider.readFile(uri);
        return { content: Buffer.from(content).toString("base64") };
    });

    // Ресурса нет — `null`, а не отказ: по проводу едет только текст ошибки, а
    // ядру (запись нового файла) нужен именно код `FileNotFound`.
    rpc.handleRequest("workspace.fs.stat", async (params): Promise<IWireFileStat | null> => {
        const p: { uri?: unknown } = params;
        const { uri, provider } = providedResource("workspace.fs.stat", p.uri);
        try {
            const { type, ctime, mtime, size } = await provider.stat(uri);
            return { type, ctime, mtime, size };
        } catch (error) {
            if (error instanceof Error && (error as { code?: unknown }).code === "FileNotFound") return null;
            throw error;
        }
    });

    rpc.handleRequest("workspace.fs.writeFile", async (params): Promise<null> => {
        const p: { uri?: unknown; content?: unknown } = params;
        const { uri, provider } = providedResource("workspace.fs.writeFile", p.uri);
        if (typeof p.content !== "string") throw new Error("workspace.fs.writeFile: content must be a string");
        if (fsProviders.isWritable(uri.scheme) !== true) throw FileSystemError.NoPermissions(uri);
        await provider.writeFile(uri, new Uint8Array(Buffer.from(p.content, "base64")), {
            create: true,
            overwrite: true,
        });
        return null;
    });

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

    // Слежение ведёт ядро: оно владеет `files.watcherExclude` и бюджетом inotify.
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
    const onDidOpenTextDocumentEmitter = documentSync.onDidOpenEmitter;
    const onDidCloseTextDocumentEmitter = new EventEmitter<vscode.TextDocument>();
    const onDidChangeTextDocumentEmitter = documentSync.onDidChangeEmitter;
    const onWillSaveTextDocumentEmitter = new EventEmitter<vscode.TextDocumentWillSaveEvent>();
    const onDidSaveTextDocumentEmitter = new EventEmitter<vscode.TextDocument>();

    // Без слушателей хост не гоняет will/did-save и полнотекстовый document sync.
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

    function countedEvent<T>(
        emitter: EventEmitter<T>,
        onCountChanged: (delta: 1 | -1) => void,
    ): (listener: (e: T) => unknown, thisArgs?: unknown, disposables?: vscode.Disposable[]) => vscode.Disposable {
        return (listener, thisArgs, disposables) => {
            // `disposables` — не внутренней подписке, а wrapper'у: иначе dispose не уменьшит счётчик.
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

    // Flush (замена содержимого целиком) приезжает в didChange снапшотом.
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

    rpc.handleNotification("editor.didClose", (params) => {
        const p: { uri?: unknown } = params;
        if (typeof p.uri !== "string" || p.uri === "") return;
        const doc = documentSync.close(Uri.parse(p.uri));
        if (doc !== null) onDidCloseTextDocumentEmitter.fire(doc);
    });

    rpc.handleNotification("workspace.initialize", (params) => {
        const p: {
            configuration?: unknown;
            workspaceFolders?: readonly IWireWorkspaceFolder[];
            workspaceFile?: unknown;
        } = params;
        configStore.setData(p.configuration);
        workspaceFile = typeof p.workspaceFile === "string" ? Uri.parse(p.workspaceFile) : undefined;
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

    // Текста запрос не везёт: документ — из зеркала, устаревший или не открытый — правок нет.
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
        const languageId = languageIdOfScope(scope);
        // `T` у get/inspect — утверждение вызывающего (как в эталоне), проверить его нечем.
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
                    workspaceFolderValue: r.workspaceFolderValue as T | undefined,
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
     * К резолву новое значение уже приехало `configurationChanged`: хост шлёт его
     * по тому же каналу раньше ответа. Отказ — rejected promise без тоста.
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
        // Запись в секцию `"[lang]"` (условие — как у эталона) не умеем: отказ, а не
        // запись мимо секции, которую `get()` для языка всё равно перекроет.
        if (languageId !== undefined) {
            const layer = target ?? "workspace";
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
        uriOrPathOrOptions?: vscode.Uri | string | IUntitledDocumentOptions,
        options?: { encoding?: string },
    ): Promise<vscode.TextDocument> {
        // Каст: `vscode.Uri` у расширения — всегда наш `Uri`, его отсекла проверка.
        if (typeof uriOrPathOrOptions !== "string" && !(uriOrPathOrOptions instanceof Uri)) {
            return createUntitledDocument((uriOrPathOrOptions ?? {}) as IUntitledDocumentOptions);
        }
        const uriOrPath = uriOrPathOrOptions;
        // Строка — путь на диске (перегрузка `openTextDocument(path)`), а не uri.
        const uri = typeof uriOrPath === "string" ? Uri.file(uriOrPath) : uriOrPath;
        const open = registry.get(uri);
        if (open !== undefined) return open;

        if (contentProviders.has(uri.scheme)) {
            const content = await contentProviders.provide(uri);
            if (content === null) throw FileSystemError.FileNotFound(uri);
            return makeEphemeralDocument(uri, content, "utf8");
        }

        const fsProvider = fsProviders.get(uri.scheme);
        if (fsProvider !== undefined) {
            const { text, encoding } = await decodeBuffer(
                Buffer.from(await fsProvider.readFile(uri)),
                options?.encoding,
            );
            return makeEphemeralDocument(uri, text, encoding);
        }

        // У не-file схем `fsPath` — не путь, в node:fs его не отдаём.
        if (uri.scheme !== "file") throw FileSystemError.Unavailable(uri);

        const buffer = await ctx.disk.readFile(uri.fsPath);
        const { text, encoding } = await decodeBuffer(buffer, options?.encoding);
        return makeEphemeralDocument(uri, text, encoding);
    }

    /**
     * `editor.didOpen` приезжает раньше ответа, так что документ уже в реестре.
     * Нет его там только сверх порога синхронизации — такой отдаём эфемерным.
     */
    async function createUntitledDocument({
        content,
        language,
        encoding,
    }: IUntitledDocumentOptions): Promise<vscode.TextDocument> {
        // Опции — из JS расширения, тип им не гарантия.
        const text = typeof content === "string" ? content : undefined;
        const { uri: created } = await rpc.request("workspace.createUntitledDocument", {
            ...(text !== undefined ? { content: text } : {}),
            ...(typeof language === "string" ? { language } : {}),
            ...(typeof encoding === "string" ? { encoding } : {}),
        });
        const uri = Uri.parse(created);
        return registry.get(uri) ?? makeEphemeralDocument(uri, text ?? "", "utf8");
    }

    /** Вне реестра: это не открытый буфер. */
    function makeEphemeralDocument(uri: Uri, text: string, encoding: string): ExtHostTextDocument {
        const doc = new ExtHostTextDocument(uri, registry.wordDefinitionFor, registry.saveDocument);
        doc.applyFull({
            uri: uri.toString(),
            text,
            encoding,
            eol: detectEndOfLine(text) === CoreEndOfLine.CRLF ? EndOfLine.CRLF : EndOfLine.LF,
        });
        return doc;
    }

    const workspaceNs = {
        registerTaskProvider,
        get workspaceFolders(): readonly vscode.WorkspaceFolder[] | undefined {
            return workspaceFolders.length === 0 ? undefined : workspaceFolders;
        },

        get name(): string | undefined {
            // `getWorkspaceLabel` эталона: `web.code-workspace` → `web (Workspace)`.
            if (workspaceFile !== undefined) return `${workspaceFileLabel(workspaceFile.fsPath)} (Workspace)`;
            return workspaceFolders[0]?.name;
        },

        get workspaceFile(): vscode.Uri | undefined {
            return workspaceFile;
        },

        get textDocuments(): readonly vscode.TextDocument[] {
            return registry.all();
        },

        fs: createFileSystemNamespace(ctx.disk.fs, fsProviders),

        registerFileSystemProvider: (
            scheme: string,
            provider: vscode.FileSystemProvider,
            options?: { readonly isCaseSensitive?: boolean; readonly isReadonly?: boolean | vscode.MarkdownString },
        ): vscode.Disposable => {
            const registration = fsProviders.register(scheme, provider, options);
            return new DisposableImpl(() => {
                registration.dispose();
            });
        },

        getConfiguration,
        asRelativePath,
        // Каст к трём перегрузкам d.ts: форму реализация различает в рантайме.
        openTextDocument: openTextDocument as unknown as typeof vscode.workspace.openTextDocument,

        onDidChangeConfiguration: onDidChangeConfigurationEmitter.event,
        onDidOpenTextDocument: countedEvent(onDidOpenTextDocumentEmitter, onDocumentSyncCountChanged),
        onDidChangeTextDocument: countedEvent(onDidChangeTextDocumentEmitter, onDocumentSyncCountChanged),
        onDidCloseTextDocument: onDidCloseTextDocumentEmitter.event,

        // Немые события — поверхность, которую трогает vscode-languageclient.
        onDidChangeWorkspaceFolders: naiveEvent(),
        // Multi-root нет (docs/TODO/MultiRoot.md): выполнима только смена, оставляющая
        // одну папку, — хост открывает её как Open Folder; прочее — `false` и тост (решение человека).
        updateWorkspaceFolders: (
            start: number,
            deleteCount: number | undefined | null,
            ...workspaceFoldersToAdd: { readonly uri: vscode.Uri; readonly name?: string }[]
        ): boolean => {
            const next = simulateWorkspaceFoldersUpdate(
                workspaceFolders,
                start,
                deleteCount ?? 0,
                workspaceFoldersToAdd,
            );
            if (next === null) return false;
            rpc.notify("workspace.updateWorkspaceFolders", {
                extensionId: ctx.owner.current ?? null,
                folders: next.map((uri) => uri.fsPath),
            });
            return next.length === 1;
        },
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
        applyEdit: (edit: vscode.WorkspaceEdit, metadata?: vscode.WorkspaceEditMetadata): Thenable<boolean> => {
            if (!(edit instanceof WorkspaceEdit)) return Promise.resolve(false);
            const ops = serializeWorkspaceEdit(edit);
            // All-or-nothing, как у VS Code: «наполовину» применять нельзя.
            if (ops === null) return Promise.resolve(false);
            // Пустой edit — вакуумный успех, как у VS Code.
            if (ops.length === 0) return Promise.resolve(true);
            const params: IWireApplyWorkspaceEditParams = {
                ops,
                ...(metadata?.isRefactoring === true ? { isRefactoring: true } : {}),
            };
            return rpc.request("workspace.applyEdit", params);
        },
        // `saveAs` не поднят: ему нужен диалог Save As на чужой буфер.
        save: async (uri: vscode.Uri): Promise<vscode.Uri | undefined> => {
            const saved = await rpc.request("workspace.save", { uri: uri.toString() });
            return saved === null ? undefined : Uri.parse(saved.uri);
        },
        saveAll: (includeUntitled?: boolean): Thenable<boolean> =>
            rpc.request("workspace.saveAll", includeUntitled === true ? { includeUntitled: true } : {}),
        // Без fallback на `workspaceFolders[0]`: файл вне папок — `undefined`, как в эталоне.
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
            // Пустое окно или мусорный шаблон — немой watcher: расширение не обязано это проверять.
            if (resolved === null) {
                return fsWatchers.createInert(ignoreCreateEvents, ignoreChangeEvents, ignoreDeleteEvents);
            }
            return fsWatchers.create(resolved, ignoreCreateEvents, ignoreChangeEvents, ignoreDeleteEvents);
        },
        /** Свой обход в субпроцессе, а не ripgrep ядра, как у эталона, — почему, см. `findFiles.ts`. */
        findFiles: async (
            include: vscode.GlobPattern,
            exclude?: vscode.GlobPattern | null,
            maxResults?: number,
            token?: vscode.CancellationToken,
        ): Promise<vscode.Uri[]> => {
            const results: Uri[] = [];
            const isCancelled = (): boolean => token?.isCancellationRequested === true;
            // Отмену и нулевой остаток отдельно не ловим: обход сам вернёт на них пустой список.
            for (const resolved of findFilesBases(include, workspaceFolders)) {
                const relativePaths = await walkForFiles(
                    ctx.disk.findFilesScanner,
                    {
                        base: resolved.base,
                        include: resolved.pattern,
                        excludes: findFilesExcludes(exclude, resolved.base, configStore),
                        // `maxResults` — на результат целиком, а не на папку.
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

        // Модели доверия нет — как VS Code с выключенным workspace trust. `false`
        // уводил бы Ruff в принудительный bundled-путь с предупреждением в логе.
        isTrusted: true,
        onDidGrantWorkspaceTrust: naiveVoidEvent(),

        onWillSaveTextDocument: (
            listener: (e: vscode.TextDocumentWillSaveEvent) => unknown,
            thisArgs?: unknown,
            disposables?: vscode.Disposable[],
        ): vscode.Disposable => {
            // `disposables` — не внутренней подписке, а wrapper'у: иначе dispose не уменьшит счётчик.
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
