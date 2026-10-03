import * as fs from "node:fs";
import * as path from "node:path";

import { Event } from "../../../base/common/event.ts";
import type { Uri } from "../../../base/common/uri.ts";
import {
    FileOperationError,
    FileOperationResult,
    FileSystemProviderCapabilities,
    FileType,
    type IFileSystemProvider,
    type IProviderWriteOptions,
    type IStat,
} from "../common/files.ts";

/**
 * Провайдер схемы `file:` — локальный диск для {@link IFileService}. Всё через
 * `fs.promises`: UI-поток не блокируется на медленной ФС.
 *
 * Атомарная запись — через временного соседа и `rename`: падение посреди записи
 * не оставляет обрезанный файл. Исключения, как у эталона: симлинк (`rename`
 * заменил бы ссылку файлом) и файл с жёсткими ссылками (остальные имена
 * остались бы на старом содержимом) — их пишем на месте.
 *
 * Слежения нет: изменения снаружи ловят `IFileWatcher`/`ITreeFileWatcher`.
 */
export class DiskFileSystemProvider implements IFileSystemProvider {
    public readonly capabilities = FileSystemProviderCapabilities.FileAtomicWrite;
    public readonly onDidChangeFile: Event<readonly Uri[]> = Event.None;

    public async stat(resource: Uri): Promise<IStat> {
        const fsPath = resource.fsPath;
        const link = await guard(resource, () => fs.promises.lstat(fsPath));
        if (!link.isSymbolicLink()) return toStat(link, typeOf(link));
        try {
            const target = await fs.promises.stat(fsPath);
            return toStat(target, FileType.SymbolicLink | typeOf(target));
        } catch {
            // Висячая ссылка: цели нет, но сама ссылка — есть.
            return toStat(link, FileType.SymbolicLink | FileType.Unknown);
        }
    }

    public readFile(resource: Uri): Promise<Uint8Array> {
        return guard(resource, () => fs.promises.readFile(resource.fsPath));
    }

    public async readdir(resource: Uri): Promise<[string, FileType][]> {
        const entries = await guard(resource, () => fs.promises.readdir(resource.fsPath, { withFileTypes: true }));
        return Promise.all(
            entries.map(async (entry): Promise<[string, FileType]> => {
                if (!entry.isSymbolicLink()) return [entry.name, typeOf(entry)];
                try {
                    const target = await fs.promises.stat(path.join(resource.fsPath, entry.name));
                    return [entry.name, FileType.SymbolicLink | typeOf(target)];
                } catch {
                    return [entry.name, FileType.SymbolicLink | FileType.Unknown];
                }
            }),
        );
    }

    public async writeFile(resource: Uri, content: Uint8Array, options: IProviderWriteOptions): Promise<void> {
        const fsPath = resource.fsPath;
        if (options.atomic && (await canReplaceAtomically(fsPath))) {
            const temp = path.join(path.dirname(fsPath), `.${path.basename(fsPath)}.diode-${String(process.pid)}.tmp`);
            await guard(resource, async () => {
                try {
                    await fs.promises.writeFile(temp, content);
                    await fs.promises.rename(temp, fsPath);
                } catch (e) {
                    // Падает до rename только запись соседа (её ошибка и всплывает),
                    // а сам rename поверх каталога сюда не доходит: каталог пишется
                    // на месте (canReplaceAtomically) — исход уборки не наблюдаем.
                    // Stryker disable next-line ObjectLiteral,BooleanLiteral: см. выше
                    await fs.promises.rm(temp, { force: true });
                    throw e;
                }
            });
            return;
        }
        await guard(resource, () => fs.promises.writeFile(fsPath, content));
    }

    public async mkdir(resource: Uri): Promise<void> {
        await guard(resource, () => fs.promises.mkdir(resource.fsPath, { recursive: true }));
    }

    public async delete(resource: Uri, options: { readonly recursive: boolean }): Promise<void> {
        await guard(resource, () => fs.promises.rm(resource.fsPath, { recursive: options.recursive }));
    }

    public async rename(source: Uri, target: Uri, options: { readonly overwrite: boolean }): Promise<void> {
        if (!options.overwrite) await assertAbsent(target);
        await guard(source, () => fs.promises.rename(source.fsPath, target.fsPath));
    }

    public async copy(source: Uri, target: Uri, options: { readonly overwrite: boolean }): Promise<void> {
        if (!options.overwrite) await assertAbsent(target);
        await guard(source, () => fs.promises.cp(source.fsPath, target.fsPath, { recursive: true, force: true }));
    }
}

/** Атомарно заменять можно обычный файл без лишних жёстких ссылок (или ещё не существующий). */
async function canReplaceAtomically(fsPath: string): Promise<boolean> {
    try {
        const stat = await fs.promises.lstat(fsPath);
        return !stat.isSymbolicLink() && stat.nlink <= 1;
    } catch {
        return true;
    }
}

async function assertAbsent(resource: Uri): Promise<void> {
    try {
        await fs.promises.lstat(resource.fsPath);
    } catch {
        return;
    }
    throw new FileOperationError(`'${resource.toString()}' already exists`, FileOperationResult.Exists);
}

function typeOf(stat: fs.Stats | fs.Dirent): FileType {
    if (stat.isFile()) return FileType.File;
    if (stat.isDirectory()) return FileType.Directory;
    return FileType.Unknown;
}

function toStat(stat: fs.Stats, type: FileType): IStat {
    return { type, mtime: stat.mtimeMs, size: stat.size };
}

/** Ошибки ОС → общий словарь {@link FileOperationResult}; прочие — как есть. */
async function guard<T>(resource: Uri, run: () => Promise<T>): Promise<T> {
    try {
        return await run();
    } catch (e) {
        throw toFileOperationError(e, resource);
    }
}

const RESULT_BY_CODE: Partial<Record<string, FileOperationResult>> = {
    ENOENT: FileOperationResult.NotFound,
    ENOTDIR: FileOperationResult.NotFound,
    EISDIR: FileOperationResult.IsDirectory,
    EEXIST: FileOperationResult.Exists,
    EACCES: FileOperationResult.PermissionDenied,
    EPERM: FileOperationResult.PermissionDenied,
};

export function toFileOperationError(error: unknown, resource: Uri): unknown {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    const result = RESULT_BY_CODE[code ?? ""];
    if (result === undefined) return error;
    return new FileOperationError(`'${resource.toString()}': ${(error as Error).message}`, result);
}
