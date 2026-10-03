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
} from "./files.ts";

interface IEntry {
    readonly type: FileType.File | FileType.Directory;
    readonly content: Uint8Array;
    readonly mtime: number;
}

const ROOT = "/";

/**
 * Провайдер в памяти: дерево по пути ресурса (схема не учитывается). Для тестов,
 * которым диск не нужен по смыслу, и будущих буферов без файла (`untitled:`).
 * Время изменения — монотонный счётчик, чтобы etag менялся на каждой записи
 * даже в пределах одной миллисекунды.
 */
export class InMemoryFileSystemProvider implements IFileSystemProvider {
    public readonly capabilities = FileSystemProviderCapabilities.None;
    public readonly onDidChangeFile: Event<readonly Uri[]> = Event.None;

    private readonly entries = new Map<string, IEntry>([[ROOT, directory(0)]]);
    private clock = 0;

    public stat(resource: Uri): Promise<IStat> {
        const entry = this.get(resource.path);
        return Promise.resolve({ type: entry.type, mtime: entry.mtime, size: entry.content.byteLength });
    }

    public readFile(resource: Uri): Promise<Uint8Array> {
        const entry = this.get(resource.path);
        if (entry.type === FileType.Directory) {
            return Promise.reject(error(resource.path, "is a directory", FileOperationResult.IsDirectory));
        }
        return Promise.resolve(entry.content);
    }

    public readdir(resource: Uri): Promise<[string, FileType][]> {
        const path = resource.path;
        this.get(path);
        const result: [string, FileType][] = [];
        for (const [childPath, entry] of this.entries) {
            if (childPath !== ROOT && parentOf(childPath) === path) result.push([nameOf(childPath), entry.type]);
        }
        return Promise.resolve(result);
    }

    /** Атомарность в памяти бесплатна: запись и так не прерывается посередине. */
    public writeFile(resource: Uri, content: Uint8Array, options?: IProviderWriteOptions): Promise<void> {
        const path = resource.path;
        const parent = this.entries.get(parentOf(path));
        if (parent?.type !== FileType.Directory) {
            return Promise.reject(error(parentOf(path), "no such directory", FileOperationResult.NotFound));
        }
        if (this.entries.get(path)?.type === FileType.Directory) {
            return Promise.reject(error(path, "is a directory", FileOperationResult.IsDirectory));
        }
        this.entries.set(path, { type: FileType.File, content, mtime: ++this.clock });
        return Promise.resolve();
    }

    public mkdir(resource: Uri): Promise<void> {
        const missing: string[] = [];
        for (let path = resource.path; !this.entries.has(path); path = parentOf(path)) missing.push(path);
        const existing = this.entries.get(resource.path);
        if (existing?.type === FileType.File) {
            return Promise.reject(error(resource.path, "a file exists", FileOperationResult.Exists));
        }
        for (const path of missing) this.entries.set(path, directory(++this.clock));
        return Promise.resolve();
    }

    public delete(resource: Uri, options: { readonly recursive: boolean }): Promise<void> {
        const path = resource.path;
        this.get(path);
        const subtree = this.subtree(path);
        if (subtree.length > 1 && !options.recursive) {
            return Promise.reject(new Error(`'${path}' is not empty`));
        }
        for (const entryPath of subtree) this.entries.delete(entryPath);
        return Promise.resolve();
    }

    public rename(source: Uri, target: Uri, options: { readonly overwrite: boolean }): Promise<void> {
        return this.transfer(source.path, target.path, options.overwrite, true);
    }

    public copy(source: Uri, target: Uri, options: { readonly overwrite: boolean }): Promise<void> {
        return this.transfer(source.path, target.path, options.overwrite, false);
    }

    private transfer(from: string, to: string, overwrite: boolean, removeSource: boolean): Promise<void> {
        this.get(from);
        if (this.entries.has(to) && !overwrite) {
            return Promise.reject(error(to, "already exists", FileOperationResult.Exists));
        }
        const moved = this.subtree(from).map((path) => [path, this.get(path)] as const);
        if (removeSource) for (const [path] of moved) this.entries.delete(path);
        for (const [path, entry] of moved) this.entries.set(to + path.slice(from.length), entry);
        return Promise.resolve();
    }

    /** Ресурс и всё, что под ним. */
    private subtree(path: string): string[] {
        return [...this.entries.keys()].filter((p) => p === path || p.startsWith(`${path}/`));
    }

    private get(path: string): IEntry {
        const entry = this.entries.get(path);
        if (entry === undefined) throw error(path, "no such file or directory", FileOperationResult.NotFound);
        return entry;
    }
}

function directory(mtime: number): IEntry {
    return { type: FileType.Directory, content: new Uint8Array(), mtime };
}

function parentOf(path: string): string {
    const slash = path.lastIndexOf("/");
    return slash <= 0 ? ROOT : path.slice(0, slash);
}

function nameOf(path: string): string {
    return path.slice(path.lastIndexOf("/") + 1);
}

function error(path: string, what: string, result: FileOperationResult): FileOperationError {
    return new FileOperationError(`'${path}': ${what}`, result);
}
