import * as fs from "node:fs/promises";
import * as path from "node:path";

import type * as vscode from "vscode";

import { FileSystemError, FileType } from "./vscodeTypes.ts";

/**
 * `vscode.workspace.fs` на стороне subprocess.
 *
 * Работает **локально через `node:fs`** — целевой файл живёт на той же машине и
 * не является открытым буфером ядра, поэтому RPC не нужен (в отличие от
 * will-save, который ходит за текстом активного документа на хост).
 *
 * Обслуживаем **только схему `file`**: в VS Code это роутер по `uri.scheme`
 * (`vscode-remote:`, `vscode-vfs:`, кастомные провайдеры), у нас же есть лишь
 * локальный диск. Прочие схемы получают `FileSystemError.Unavailable` — честный
 * отказ вместо чтения/записи мусора мимо схемы.
 *
 * Ошибки `node` маппятся в {@link FileSystemError} с тем же `code`, что и в
 * VS Code, чтобы расширения ловили их по `err.code === "FileNotFound"`.
 */
export type IFileSystemNamespace = Pick<
    vscode.FileSystem,
    | "stat"
    | "readFile"
    | "writeFile"
    | "createDirectory"
    | "readDirectory"
    | "delete"
    | "rename"
    | "copy"
    | "isWritableFileSystem"
>;

/** Преобразует ошибку `node:fs` в {@link FileSystemError}; прочее пробрасывает. */
export function toFileSystemError(err: unknown, uri: vscode.Uri): unknown {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    switch (code) {
        case "ENOENT":
            return FileSystemError.FileNotFound(uri);
        case "EEXIST":
            return FileSystemError.FileExists(uri);
        case "EACCES":
        case "EPERM":
            return FileSystemError.NoPermissions(uri);
        default:
            return err;
    }
}

/**
 * Гейт схемы для операций, которые умеет только локальный диск (`stat`, `writeFile`).
 *
 * Без этого гейта промах тихий и разрушительный: `fsPath` у не-file схемы не бросает,
 * а отдаёт путь как есть (`untitled:Untitled-1` → `"Untitled-1"`), поэтому `writeFile`
 * создавал бы `$CWD/Untitled-1` вместо ошибки.
 */
function assertFileScheme(uri: vscode.Uri): void {
    if (uri.scheme !== "file") throw FileSystemError.Unavailable(uri);
}

/**
 * Реестр `FileSystemProvider`'ов, зарегистрированных расширениями субпроцесса
 * (`workspace.registerFileSystemProvider`).
 *
 * Живёт здесь, а не в `workspaceNamespace`, чтобы роутинг `workspace.fs` по схеме
 * тестировался без RPC: сам реестр — чистая логика, а проводка событий на хост
 * остаётся у namespace'а, у которого есть `rpc`.
 */
export class SubprocessFileSystemProviders {
    private readonly providers = new Map<string, vscode.FileSystemProvider>();
    private readonly schemeListeners = new Set<() => void>();
    private readonly changeListeners = new Set<(uris: vscode.Uri[]) => void>();
    private readonly changeSubscriptions = new Map<string, vscode.Disposable>();

    /** Регистрирует провайдера схемы. Занятая схема — ошибка, как в VS Code. */
    public register(scheme: string, provider: vscode.FileSystemProvider): { dispose: () => void } {
        if (this.providers.has(scheme)) {
            throw new Error(`A filesystem provider for the scheme '${scheme}' is already registered.`);
        }
        this.providers.set(scheme, provider);
        // Провайдер сообщает об изменениях сам (для git: — сдвинулся HEAD/индекс);
        // пересылаем это наружу, чтобы ядро сбросило кэш оригиналов.
        this.changeSubscriptions.set(
            scheme,
            provider.onDidChangeFile((events) => {
                const uris = events.map((e) => e.uri);
                if (uris.length === 0) return;
                for (const cb of [...this.changeListeners]) cb(uris);
            }),
        );
        this.fireSchemesChanged();
        return {
            dispose: () => {
                if (this.providers.get(scheme) !== provider) return;
                this.providers.delete(scheme);
                this.changeSubscriptions.get(scheme)?.dispose();
                this.changeSubscriptions.delete(scheme);
                this.fireSchemesChanged();
            },
        };
    }

    public get(scheme: string): vscode.FileSystemProvider | undefined {
        return this.providers.get(scheme);
    }

    /** Схемы, которые субпроцесс готов обслуживать (снимок для хоста). */
    public schemes(): string[] {
        return [...this.providers.keys()];
    }

    public onDidChangeSchemes(cb: () => void): { dispose: () => void } {
        this.schemeListeners.add(cb);
        return { dispose: () => this.schemeListeners.delete(cb) };
    }

    public onDidChangeFile(cb: (uris: vscode.Uri[]) => void): { dispose: () => void } {
        this.changeListeners.add(cb);
        return { dispose: () => this.changeListeners.delete(cb) };
    }

    private fireSchemesChanged(): void {
        for (const cb of [...this.schemeListeners]) cb();
    }
}

/** Минимум `fs.Stats`, нужный для определения {@link FileType}. */
interface IStatKind {
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
}

/** Классифицирует запись ФС в {@link FileType}. */
export function fileTypeFromStats(s: IStatKind): FileType {
    if (s.isFile()) return FileType.File;
    if (s.isDirectory()) return FileType.Directory;
    if (s.isSymbolicLink()) return FileType.SymbolicLink;
    return FileType.Unknown;
}

export function createFileSystemNamespace(providers?: SubprocessFileSystemProviders): IFileSystemNamespace {
    async function stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        assertFileScheme(uri);
        try {
            const s = await fs.stat(uri.fsPath);
            return {
                type: fileTypeFromStats(s) as vscode.FileType,
                ctime: s.ctimeMs,
                mtime: s.mtimeMs,
                size: s.size,
            };
        } catch (err) {
            throw toFileSystemError(err, uri);
        }
    }

    /**
     * Роутер по схеме — та же роль, что у `workspace.fs` в VS Code. `file` идёт
     * на локальный диск, прочие схемы — зарегистрированному провайдеру
     * расширения; схема без провайдера получает честный `Unavailable`.
     */
    async function readFile(uri: vscode.Uri): Promise<Uint8Array> {
        if (uri.scheme !== "file") {
            const provider = providers?.get(uri.scheme);
            if (provider === undefined) throw FileSystemError.Unavailable(uri);
            return await provider.readFile(uri);
        }
        try {
            return await fs.readFile(uri.fsPath);
        } catch (err) {
            throw toFileSystemError(err, uri);
        }
    }

    async function writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
        assertFileScheme(uri);
        try {
            // VS Code создаёт недостающие родительские папки при записи.
            await fs.mkdir(path.dirname(uri.fsPath), { recursive: true });
            await fs.writeFile(uri.fsPath, content);
        } catch (err) {
            throw toFileSystemError(err, uri);
        }
    }

    /** `mkdirp`-семантика по контракту: недостающие родители создаются молча. */
    async function createDirectory(uri: vscode.Uri): Promise<void> {
        assertFileScheme(uri);
        try {
            await fs.mkdir(uri.fsPath, { recursive: true });
        } catch (err) {
            throw toFileSystemError(err, uri);
        }
    }

    async function readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        assertFileScheme(uri);
        try {
            const entries = await fs.readdir(uri.fsPath, { withFileTypes: true });
            // `Dirent` отвечает на те же три предиката, что `Stats`, — классификация одна.
            return entries.map((entry) => [entry.name, fileTypeFromStats(entry) as vscode.FileType]);
        } catch (err) {
            throw toFileSystemError(err, uri);
        }
    }

    /**
     * Удаление. `useTrash` не поддержан и молча игнорируется — корзины у
     * терминального редактора нет; `recursive` по умолчанию `false`, как в
     * контракте, поэтому непустой каталог без флага получает отказ.
     *
     * `force` у `fs.rm` НЕ включаем: по контракту отсутствующий ресурс — это
     * `FileNotFound`, а не вакуумный успех.
     */
    async function deleteEntry(uri: vscode.Uri, options?: { recursive?: boolean }): Promise<void> {
        assertFileScheme(uri);
        try {
            await fs.rm(uri.fsPath, { recursive: options?.recursive === true });
        } catch (err) {
            throw toFileSystemError(err, uri);
        }
    }

    /**
     * Переименование/перенос. `overwrite` по умолчанию `false`, и проверять это
     * приходится САМИМ: `fs.rename` в posix затирает цель молча, поэтому без
     * явной проверки флаг не значил бы ничего. Проверка — ДО `try`, чтобы
     * `FileExists` про цель не переписался маппингом ошибки источника.
     */
    async function rename(source: vscode.Uri, target: vscode.Uri, options?: { overwrite?: boolean }): Promise<void> {
        assertFileScheme(source);
        assertFileScheme(target);
        if (options?.overwrite !== true) await assertVacant(target);
        try {
            // Родителя цели создаём сами — как в `writeFile`: перенос в ещё не
            // существующий каталог по контракту законен.
            await fs.mkdir(path.dirname(target.fsPath), { recursive: true });
            await fs.rename(source.fsPath, target.fsPath);
        } catch (err) {
            throw toFileSystemError(err, source);
        }
    }

    /** Копирование файла или дерева; `overwrite` — та же семантика, что у `rename`. */
    async function copy(source: vscode.Uri, target: vscode.Uri, options?: { overwrite?: boolean }): Promise<void> {
        assertFileScheme(source);
        assertFileScheme(target);
        if (options?.overwrite !== true) await assertVacant(target);
        try {
            await fs.mkdir(path.dirname(target.fsPath), { recursive: true });
            // `force` здесь безопасен: занятость цели уже разобрана выше.
            await fs.cp(source.fsPath, target.fsPath, { recursive: true, force: true });
        } catch (err) {
            throw toFileSystemError(err, source);
        }
    }

    return {
        stat,
        readFile,
        writeFile,
        createDirectory,
        readDirectory,
        delete: deleteEntry,
        rename,
        copy,
        // Единственная схема, которую мы обслуживаем сами, — `file`, и она
        // записываема. Про чужую схему честно `undefined` («редактор не знает
        // такой ФС»): провайдер расширения отдаёт нам только чтение, и врать
        // про его записываемость нельзя ни `true`, ни `false`.
        isWritableFileSystem: (scheme: string): boolean | undefined => (scheme === "file" ? true : undefined),
    };
}

/** Бросает `FileExists`, если цель занята: вызывается, когда перезапись запрещена. */
async function assertVacant(target: vscode.Uri): Promise<void> {
    try {
        await fs.stat(target.fsPath);
    } catch {
        return; // цели нет — писать можно
    }
    throw FileSystemError.FileExists(target);
}
