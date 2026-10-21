import * as fs from "node:fs/promises";
import * as path from "node:path";

import type * as vscode from "vscode";

import type { IDiskFileSystem, IExtHostDisk } from "../common/extHostDisk.ts";
import type { IFindFilesEntry, IFindFilesScanner } from "../common/findFiles.ts";
import { FileSystemError, FileType } from "../common/vscodeTypes.ts";

/** Как у эталона (`extHostDiskFileSystemProvider.ts`), диск обслуживается прямо в субпроцессе, без RPC. */
export function createNodeExtHostDisk(): IExtHostDisk {
    return {
        fs: createNodeDiskFileSystem(),
        findFilesScanner: createNodeFindFilesScanner(),
        readFile: (fsPath) => fs.readFile(fsPath),
    };
}

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

interface IStatKind {
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
}

export function fileTypeFromStats(s: IStatKind): FileType {
    if (s.isFile()) return FileType.File;
    if (s.isDirectory()) return FileType.Directory;
    if (s.isSymbolicLink()) return FileType.SymbolicLink;
    return FileType.Unknown;
}

function createNodeDiskFileSystem(): IDiskFileSystem {
    async function stat(uri: vscode.Uri): Promise<vscode.FileStat> {
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

    async function readFile(uri: vscode.Uri): Promise<Uint8Array> {
        try {
            return await fs.readFile(uri.fsPath);
        } catch (err) {
            throw toFileSystemError(err, uri);
        }
    }

    async function writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
        try {
            // VS Code создаёт недостающие родительские папки при записи.
            await fs.mkdir(path.dirname(uri.fsPath), { recursive: true });
            await fs.writeFile(uri.fsPath, content);
        } catch (err) {
            throw toFileSystemError(err, uri);
        }
    }

    async function createDirectory(uri: vscode.Uri): Promise<void> {
        try {
            await fs.mkdir(uri.fsPath, { recursive: true });
        } catch (err) {
            throw toFileSystemError(err, uri);
        }
    }

    async function readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        try {
            const entries = await fs.readdir(uri.fsPath, { withFileTypes: true });
            return entries.map((entry) => [entry.name, fileTypeFromStats(entry) as vscode.FileType]);
        } catch (err) {
            throw toFileSystemError(err, uri);
        }
    }

    /**
     * `useTrash` молча игнорируется — корзины нет. `force` у `fs.rm` НЕ включаем:
     * по контракту отсутствующий ресурс — `FileNotFound`, а не вакуумный успех.
     */
    async function deleteEntry(uri: vscode.Uri, options?: { recursive?: boolean }): Promise<void> {
        try {
            await fs.rm(uri.fsPath, { recursive: options?.recursive === true });
        } catch (err) {
            throw toFileSystemError(err, uri);
        }
    }

    /**
     * `fs.rename` в posix затирает цель молча — `overwrite` проверяем сами, ДО `try`,
     * чтобы `FileExists` про цель не переписался маппингом ошибки источника.
     */
    async function rename(source: vscode.Uri, target: vscode.Uri, options?: { overwrite?: boolean }): Promise<void> {
        if (options?.overwrite !== true) await assertVacant(target);
        try {
            // Перенос в ещё не существующий каталог по контракту законен.
            await fs.mkdir(path.dirname(target.fsPath), { recursive: true });
            await fs.rename(source.fsPath, target.fsPath);
        } catch (err) {
            throw toFileSystemError(err, source);
        }
    }

    async function copy(source: vscode.Uri, target: vscode.Uri, options?: { overwrite?: boolean }): Promise<void> {
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
    };
}

async function assertVacant(target: vscode.Uri): Promise<void> {
    try {
        await fs.stat(target.fsPath);
    } catch {
        return;
    }
    throw FileSystemError.FileExists(target);
}

/** Симлинки на каталоги не раскрываются (`Dirent.isDirectory()` у них ложный) — обход не зацикливается. */
export function createNodeFindFilesScanner(): IFindFilesScanner {
    return {
        readDirectory: async (absolutePath: string): Promise<readonly IFindFilesEntry[]> => {
            try {
                const entries = await fs.readdir(absolutePath, { withFileTypes: true });
                return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
            } catch {
                return [];
            }
        },
    };
}
