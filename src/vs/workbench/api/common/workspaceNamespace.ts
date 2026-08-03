import * as nodeFs from "node:fs/promises";

import type * as vscode from "vscode";

import { detectEndOfLine, EndOfLine as CoreEndOfLine } from "../../../editor/common/core/endOfLine.ts";
import { decodeBuffer } from "../../../editor/common/model/encoding.ts";

import { ExtHostTextDocument } from "./extHostDocuments.ts";
import { createFileSystemNamespace, SubprocessFileSystemProviders } from "./fileSystemNamespace.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import {
    DisposableImpl,
    EndOfLine,
    EventEmitter,
    FileSystemError,
    Position,
    Range,
    TextDocumentSaveReason,
    TextEdit,
    Uri,
} from "./vscodeTypes.ts";
import { type IWireReadFileResult, parseWireDocumentSyncSnapshot, type WireTextEdit } from "./wireTypes.ts";

/** Тайм-аут на один waitUntil-thenable участника will-save, мс. */
const WILL_SAVE_LISTENER_TIMEOUT_MS = 1500;

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

/** Сериализует `vscode.TextEdit` в wire-форму (subprocess → host). */
function serializeTextEdit(edit: TextEdit): WireTextEdit {
    if (edit.newEol !== undefined) {
        return { setEndOfLine: edit.newEol === EndOfLine.CRLF ? 2 : 1 };
    }
    return {
        range: {
            startLine: edit.range.start.line,
            startCharacter: edit.range.start.character,
            endLine: edit.range.end.line,
            endCharacter: edit.range.end.character,
        },
        text: edit.newText,
    };
}

/** Валидный Event, который никогда не стреляет (хост его не фаерит). */
function naiveEvent<T = never>(): vscode.Event<T> {
    return new EventEmitter<T>().event;
}

/** Wire-параметры запроса will-save (host → subprocess). */
interface IWireWillSaveParams {
    /** Ресурс как `uri.toString()`. */
    readonly uri: string;
    readonly languageId?: string;
    readonly isDirty?: boolean;
    readonly text?: string;
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

/** Wire-форма папки (host → subprocess). */
interface IWireWorkspaceFolder {
    readonly uri: string;
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
        const p = params as { uri?: unknown };
        if (typeof p.uri !== "string") throw new Error("workspace.fs.readFile: uri must be a string");
        const uri = Uri.parse(p.uri);
        const provider = fsProviders.get(uri.scheme);
        if (provider === undefined) throw new Error(`no file system provider for scheme "${uri.scheme}"`);
        const content = await provider.readFile(uri as unknown as vscode.Uri);
        return { content: Buffer.from(content).toString("base64") };
    });

    const onDidChangeConfigurationEmitter = new EventEmitter<vscode.ConfigurationChangeEvent>();
    // didOpen/didChange живут в DocumentSyncTracker (единая точка входа текста в
    // реестр — ей пользуются и document sync, и languages.provide*-обработчики).
    const onDidOpenTextDocumentEmitter = documentSync.onDidOpenEmitter as unknown as EventEmitter<vscode.TextDocument>;
    const onDidCloseTextDocumentEmitter = new EventEmitter<vscode.TextDocument>();
    const onDidChangeTextDocumentEmitter =
        documentSync.onDidChangeEmitter as unknown as EventEmitter<vscode.TextDocumentChangeEvent>;
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
            }) as unknown as vscode.Disposable;
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
    // Оба пути — один `documentSync.sync()`: новый ресурс → didOpen (один раз,
    // как в VS Code), изменившийся текст → didChange одной full-range правкой,
    // тот же текст → тихое обновление меты. Никакой записи текста мимо трекера.
    rpc.handleNotification("editor.didOpen", (params) => {
        const snap = parseWireDocumentSyncSnapshot(params);
        if (snap !== null) documentSync.sync(snap);
    });

    rpc.handleNotification("editor.didChange", (params) => {
        const snap = parseWireDocumentSyncSnapshot(params);
        if (snap !== null) documentSync.sync(snap);
    });

    rpc.handleNotification("workspace.initialize", (params) => {
        const p = params as { configuration?: unknown; workspaceFolders?: IWireWorkspaceFolder[] };
        configStore.setSnapshot(p.configuration);
        workspaceFolders = (p.workspaceFolders ?? []).map((f) => ({
            uri: Uri.parse(f.uri),
            name: f.name,
            index: f.index,
        }));
    });

    rpc.handleNotification("workspace.configurationChanged", (params) => {
        const p = params as { configuration?: unknown; affectedKeys?: string[] };
        configStore.setSnapshot(p.configuration);
        const affectedKeys = p.affectedKeys ?? [];
        onDidChangeConfigurationEmitter.fire({
            affectsConfiguration: (section: string): boolean =>
                affectedKeys.some((key) => key === section || key.startsWith(section + ".")),
        } as vscode.ConfigurationChangeEvent);
    });

    // Хост запрашивает pre-save правки: обновляем полный текст документа в
    // реестре, фаерим onWillSaveTextDocument, собираем waitUntil-thenable'ы (по
    // одному per-listener таймауту), сериализуем полученные TextEdit[].
    rpc.handleRequest("workspace.willSaveTextDocument", async (params): Promise<WireTextEdit[]> => {
        const p = params as IWireWillSaveParams;
        const doc = documentSync.sync({
            uri: p.uri,
            languageId: p.languageId,
            isDirty: p.isDirty,
            text: p.text ?? "",
            ...(p.eol === 1 || p.eol === 2 ? { eol: p.eol } : {}),
            ...(typeof p.encoding === "string" ? { encoding: p.encoding } : {}),
        });
        const thenables: Thenable<readonly vscode.TextEdit[]>[] = [];
        let collecting = true;
        const event: vscode.TextDocumentWillSaveEvent = {
            document: doc as unknown as vscode.TextDocument,
            reason: (p.reason ?? TextDocumentSaveReason.Manual) as vscode.TextDocumentSaveReason,
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
                if (edit instanceof TextEdit) edits.push(serializeTextEdit(edit));
            }
        }
        return edits;
    });

    // Хост сообщил о состоявшемся сохранении — фаерим onDidSaveTextDocument.
    rpc.handleNotification("workspace.didSaveTextDocument", (params) => {
        const p = params as { uri?: unknown; languageId?: unknown };
        if (typeof p.uri !== "string") return;
        const doc = registry.upsertMeta({
            uri: p.uri,
            ...(typeof p.languageId === "string" ? { languageId: p.languageId } : {}),
        });
        onDidSaveTextDocumentEmitter.fire(doc as unknown as vscode.TextDocument);
    });

    function getConfiguration(section?: string, _scope?: unknown): vscode.WorkspaceConfiguration {
        const prefix = section !== undefined && section !== "" ? section + "." : "";
        const config: Record<string, unknown> = {
            get: (key: string, defaultValue?: unknown): unknown => configStore.get(prefix + key, defaultValue),
            has: (key: string): boolean => configStore.has(prefix + key),
            inspect: (key: string) => {
                const r = configStore.inspect(prefix + key);
                return {
                    key: r.key,
                    defaultValue: r.defaultValue,
                    globalValue: r.globalValue,
                    workspaceValue: undefined,
                    workspaceFolderValue: undefined,
                };
            },
            update: (key: string): Thenable<void> => {
                rpc.notify("window.showMessage", {
                    severity: "warn",
                    message: `workspace.getConfiguration().update("${prefix + key}") is not supported`,
                });
                return Promise.resolve();
            },
        };
        // VS Code выставляет значения секции как поля объекта конфигурации.
        for (const key of configStore.sectionKeys(section)) {
            if (key in config) continue; // не затираем get/has/inspect/update
            config[key] = configStore.get(prefix + key);
        }
        return config as unknown as vscode.WorkspaceConfiguration;
    }

    function asRelativePath(pathOrUri: string | vscode.Uri, includeWorkspaceFolder?: boolean): string {
        const p = typeof pathOrUri === "string" ? pathOrUri : (pathOrUri as unknown as Uri).fsPath;
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
        const uri = typeof uriOrPath === "string" ? Uri.file(uriOrPath) : (uriOrPath as unknown as Uri);
        // Открытый документ — отдаём стабильный объект из реестра.
        const open = registry.get(uri);
        if (open !== undefined) return open as unknown as vscode.TextDocument;

        // Промах реестра: читаем файл с диска в ЭФЕМЕРНЫЙ документ (в реестр не
        // кладём — это не открытый буфер). Читать умеем только с диска, поэтому для
        // не-file схемы честно отказываем, а не скармливаем `fsPath` в node:fs
        // (у не-file схем это не путь).
        if (uri.scheme !== "file") throw FileSystemError.Unavailable(uri as unknown as vscode.Uri);

        // Читаем сырые байты и декодируем осью encoding ядра: explicit-кодировка
        // из options побеждает BOM-сниф; неизвестный id по контракту vscode.d.ts
        // молча откатывается к дефолтному пути (BOM-сниф → utf-8). EOL для
        // эфемерного документа детектим из текста — как делает ядро.
        const buffer = await nodeFs.readFile(uri.fsPath);
        const { text, encoding } = decodeBuffer(buffer, options?.encoding);
        const doc = new ExtHostTextDocument(uri);
        doc.applyFull({
            uri: uri.toString(),
            text,
            encoding,
            eol: detectEndOfLine(text) === CoreEndOfLine.CRLF ? EndOfLine.CRLF : EndOfLine.LF,
        });
        return doc as unknown as vscode.TextDocument;
    }

    const workspaceNs = {
        get workspaceFolders(): readonly vscode.WorkspaceFolder[] | undefined {
            return workspaceFolders.length === 0
                ? undefined
                : (workspaceFolders as unknown as readonly vscode.WorkspaceFolder[]);
        },

        get name(): string | undefined {
            return workspaceFolders[0]?.name;
        },

        get textDocuments(): readonly vscode.TextDocument[] {
            return registry.all() as unknown as readonly vscode.TextDocument[];
        },

        // workspace.fs — локальный доступ к диску через node:fs (без RPC).
        fs: createFileSystemNamespace(fsProviders),

        registerFileSystemProvider: (scheme: string, provider: vscode.FileSystemProvider): vscode.Disposable => {
            const registration = fsProviders.register(scheme, provider);
            return new DisposableImpl(() => {
                registration.dispose();
            }) as unknown as vscode.Disposable;
        },

        getConfiguration,
        asRelativePath,
        openTextDocument,

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
        applyEdit: (): Thenable<boolean> => Promise.resolve(true),
        getWorkspaceFolder: (uri: vscode.Uri): vscode.WorkspaceFolder | undefined => {
            const p = (uri as unknown as Uri).fsPath;
            const found = workspaceFolders.find((f) => p === f.uri.fsPath || p.startsWith(f.uri.fsPath + "/"));
            return (found ?? workspaceFolders[0]) as unknown as vscode.WorkspaceFolder | undefined;
        },
        createFileSystemWatcher: (): unknown => ({
            onDidCreate: naiveEvent(),
            onDidChange: naiveEvent(),
            onDidDelete: naiveEvent(),
            ignoreCreateEvents: false,
            ignoreChangeEvents: false,
            ignoreDeleteEvents: false,
            dispose: (): void => undefined,
        }),
        registerTextDocumentContentProvider: (): vscode.Disposable =>
            new DisposableImpl(() => undefined) as unknown as vscode.Disposable,

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
            }) as unknown as vscode.Disposable;
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
            }) as unknown as vscode.Disposable;
            if (disposables !== undefined) disposables.push(wrapper);
            return wrapper;
        },
    };

    return workspaceNs as unknown as typeof vscode.workspace;
}
