import * as fs from "node:fs";
import * as path from "node:path";

import { Event } from "../../../base/common/event.ts";
import type { Uri } from "../../../base/common/uri.ts";
import {
    FileOperationError,
    FileOperationResult,
    FileSystemProviderCapabilities,
    FileType,
    type FileWriteContent,
    type IFileSystemProvider,
    type IProviderWriteOptions,
    type IStat,
} from "../common/files.ts";

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
            // Dangling link: the target is gone, but the link itself exists.
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

    /** A stream goes to the file piece by piece (`fs.promises.writeFile` takes an async iterable): no buffer of the whole file. */
    public async writeFile(resource: Uri, content: FileWriteContent, options: IProviderWriteOptions): Promise<void> {
        const fsPath = resource.fsPath;
        const replace = options.atomic ? await atomicReplacement(fsPath) : null;
        if (replace !== null) {
            const temp = path.join(path.dirname(fsPath), `.${path.basename(fsPath)}.diode-${String(process.pid)}.tmp`);
            await guard(resource, async () => {
                try {
                    await fs.promises.writeFile(temp, content);
                    // Carry the replaced file's mode over to the new one, otherwise rename
                    // would leave umask permissions (a script would lose +x).
                    if (replace.mode !== undefined) await fs.promises.chmod(temp, replace.mode);
                    await fs.promises.rename(temp, fsPath);
                } catch (e) {
                    // Only the temp file write fails before rename (and its error surfaces),
                    // while rename over a directory never gets here: a directory is written
                    // in place (atomicReplacement), so the cleanup outcome is unobservable.
                    // Stryker disable next-line ObjectLiteral,BooleanLiteral: see above
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
        await guard(source, async () => {
            try {
                await fs.promises.rename(source.fsPath, target.fsPath);
            } catch (e) {
                // rename can't cross file systems: copy and delete instead.
                if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
                await fs.promises.cp(source.fsPath, target.fsPath, { recursive: true });
                await fs.promises.rm(source.fsPath, { recursive: true });
            }
        });
    }

    public async copy(source: Uri, target: Uri, options: { readonly overwrite: boolean }): Promise<void> {
        if (!options.overwrite) await assertAbsent(target);
        await guard(source, () => fs.promises.cp(source.fsPath, target.fsPath, { recursive: true, force: true }));
    }
}

/**
 * `null` means write in place, as upstream does: a symlink (`rename` would replace the link
 * with a file), extra hard links (they would keep the old content), another owner (the new
 * file would become ours). Atomic so that a crash mid-write doesn't leave a truncated file.
 */
async function atomicReplacement(fsPath: string): Promise<{ readonly mode?: number } | null> {
    let stat: fs.Stats;
    try {
        stat = await fs.promises.lstat(fsPath);
    } catch {
        return {};
    }
    if (stat.isSymbolicLink() || stat.nlink > 1) return null;
    // Ownership exists only on POSIX; Windows has no `getuid`.
    if (process.getuid !== undefined && stat.uid !== process.getuid()) return null;
    return { mode: stat.mode & 0o7777 };
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

/** Maps OS errors to the shared {@link FileOperationResult} vocabulary; others pass through as is. */
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
    const result = RESULT_BY_CODE[String(code)];
    if (result === undefined) return error;
    return new FileOperationError(`'${resource.toString()}': ${(error as Error).message}`, result);
}
