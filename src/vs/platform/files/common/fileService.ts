import { Emitter } from "../../../base/common/event.ts";
import { Disposable, type IDisposable, toDisposable } from "../../../base/common/lifecycle.ts";
import { Uri } from "../../../base/common/uri.ts";

import {
    etag,
    FileOperation,
    FileOperationError,
    FileOperationResult,
    FileSystemProviderCapabilities,
    FileType,
    type IDeleteOptions,
    type IFileContent,
    type IFileOperationEvent,
    type IFileService,
    type IFileStat,
    type IFileStatWithChildren,
    type IFileSystemProvider,
    type IFileSystemProviderRegistrationEvent,
    type IReadFileOptions,
    isFileOperationError,
    type IStat,
    type IWriteFileOptions,
} from "./files.ts";

/**
 * On top of the provider: an etag guard against dirty writes, a per-resource write queue (two
 * saves in a row don't interleave), and "we did this" / "changed externally" events.
 */
export class FileService extends Disposable implements IFileService {
    public static dependencies = [] as const;

    private readonly providers = new Map<string, IFileSystemProvider>();
    /** Keyed by `uri.toString()`. */
    private readonly writeQueues = new Map<string, Promise<unknown>>();

    private readonly onDidChangeFileSystemProviderRegistrationsEmitter = this.register(
        new Emitter<IFileSystemProviderRegistrationEvent>(),
    );
    public readonly onDidChangeFileSystemProviderRegistrations =
        this.onDidChangeFileSystemProviderRegistrationsEmitter.event;

    private readonly onDidRunOperationEmitter = this.register(new Emitter<IFileOperationEvent>());
    public readonly onDidRunOperation = this.onDidRunOperationEmitter.event;

    private readonly onDidFilesChangeEmitter = this.register(new Emitter<readonly Uri[]>());
    public readonly onDidFilesChange = this.onDidFilesChangeEmitter.event;

    public registerProvider(scheme: string, provider: IFileSystemProvider): IDisposable {
        if (this.providers.has(scheme)) {
            throw new Error(`file system provider for scheme "${scheme}" is already registered`);
        }
        this.providers.set(scheme, provider);
        // The change subscription lives exactly as long as the registration, otherwise
        // a dead extension host would keep waking consumers.
        const subscription = provider.onDidChangeFile((uris) => {
            if (uris.length > 0) this.onDidFilesChangeEmitter.fire(uris);
        });
        this.onDidChangeFileSystemProviderRegistrationsEmitter.fire({ scheme, added: true });
        // toDisposable unregisters exactly once, and the scheme can be taken again only
        // after that, so it can't hit someone else's registration.
        return toDisposable(() => {
            subscription.dispose();
            this.providers.delete(scheme);
            this.onDidChangeFileSystemProviderRegistrationsEmitter.fire({ scheme, added: false });
        });
    }

    public hasProvider(resource: Uri): boolean {
        return this.providers.has(resource.scheme);
    }

    public hasCapability(resource: Uri, capability: FileSystemProviderCapabilities): boolean {
        const provider = this.providers.get(resource.scheme);
        return provider !== undefined && (provider.capabilities & capability) !== 0;
    }

    public async stat(resource: Uri): Promise<IFileStat> {
        const provider = this.provider(resource);
        if (provider.stat === undefined) throw unavailable("stat", resource);
        return toFileStat(resource, await provider.stat(resource));
    }

    public async exists(resource: Uri): Promise<boolean> {
        try {
            await this.stat(resource);
            return true;
        } catch {
            return false;
        }
    }

    public async resolve(resource: Uri): Promise<IFileStatWithChildren> {
        const stat = await this.stat(resource);
        if (!stat.isDirectory) return { ...stat, children: [] };
        const provider = this.provider(resource);
        if (provider.readdir === undefined) throw unavailable("readdir", resource);
        const entries = await provider.readdir(resource);
        return {
            ...stat,
            children: entries.map(([name, type]) => ({ resource: Uri.joinPath(resource, name), name, type })),
        };
    }

    public async readFile(resource: Uri, options: IReadFileOptions = {}): Promise<IFileContent> {
        const provider = this.provider(resource);
        if (provider.stat === undefined) {
            // A provider without stat (extension): metadata comes from the content itself.
            const value = await provider.readFile(resource);
            checkLimit(resource, value.byteLength, options.limit);
            return { ...toFileStat(resource, { type: FileType.File, mtime: 0, size: value.byteLength }), value };
        }
        // Stat before reading: a directory or a too-large file is rejected without being read.
        const stat = await provider.stat(resource);
        if ((stat.type & FileType.Directory) !== 0) {
            throw new FileOperationError(`'${resource.toString()}' is a directory`, FileOperationResult.IsDirectory);
        }
        checkLimit(resource, stat.size, options.limit);
        return { ...toFileStat(resource, stat), value: await provider.readFile(resource) };
    }

    public writeFile(resource: Uri, value: Uint8Array, options: IWriteFileOptions = {}): Promise<IFileStat> {
        return this.queue(resource, async () => {
            const provider = this.writable(resource, "writeFile");
            if (provider.writeFile === undefined || provider.stat === undefined) {
                throw unavailable("writeFile", resource);
            }
            let existing: IStat | undefined;
            try {
                existing = await provider.stat(resource);
            } catch (e) {
                if (!isFileOperationError(e, FileOperationResult.NotFound)) throw e;
            }
            if (options.etag !== undefined && existing !== undefined && etag(existing) !== options.etag) {
                throw new FileOperationError(
                    `'${resource.toString()}' was modified on disk since it was read`,
                    FileOperationResult.ModifiedSince,
                );
            }
            const atomic =
                options.atomic === true &&
                (provider.capabilities & FileSystemProviderCapabilities.FileAtomicWrite) !== 0;
            await provider.writeFile(resource, value, { atomic });
            const written = toFileStat(resource, await provider.stat(resource));
            this.onDidRunOperationEmitter.fire({
                operation: existing === undefined ? FileOperation.Create : FileOperation.Write,
                resource,
            });
            return written;
        });
    }

    public async createFolder(resource: Uri): Promise<void> {
        const provider = this.writable(resource, "mkdir");
        if (provider.mkdir === undefined) throw unavailable("mkdir", resource);
        await provider.mkdir(resource);
        this.onDidRunOperationEmitter.fire({ operation: FileOperation.Create, resource });
    }

    public async del(resource: Uri, options: IDeleteOptions = {}): Promise<void> {
        const provider = this.writable(resource, "delete");
        if (provider.delete === undefined) throw unavailable("delete", resource);
        const useTrash = options.useTrash === true;
        if (useTrash && (provider.capabilities & FileSystemProviderCapabilities.Trash) === 0) {
            throw unavailable("trash", resource);
        }
        await provider.delete(resource, { recursive: options.recursive === true, useTrash });
        this.onDidRunOperationEmitter.fire({ operation: FileOperation.Delete, resource });
    }

    public async move(source: Uri, target: Uri, overwrite = false): Promise<void> {
        const provider = this.sameProvider(source, target, "rename");
        if (provider.rename === undefined) throw unavailable("rename", source);
        await provider.rename(source, target, { overwrite });
        this.onDidRunOperationEmitter.fire({ operation: FileOperation.Move, resource: source, target });
    }

    public async copy(source: Uri, target: Uri, overwrite = false): Promise<void> {
        const provider = this.sameProvider(source, target, "copy");
        if (provider.copy === undefined) throw unavailable("copy", source);
        await provider.copy(source, target, { overwrite });
        this.onDidRunOperationEmitter.fire({ operation: FileOperation.Copy, resource: source, target });
    }

    private provider(resource: Uri): IFileSystemProvider {
        const provider = this.providers.get(resource.scheme);
        if (provider === undefined) {
            throw new FileOperationError(
                `no file system provider for scheme "${resource.scheme}"`,
                FileOperationResult.Unavailable,
            );
        }
        return provider;
    }

    private writable(resource: Uri, operation: string): IFileSystemProvider {
        const provider = this.provider(resource);
        if ((provider.capabilities & FileSystemProviderCapabilities.Readonly) !== 0) {
            throw new FileOperationError(
                `cannot ${operation} '${resource.toString()}': the file system is read-only`,
                FileOperationResult.PermissionDenied,
            );
        }
        return provider;
    }

    /** Move and copy stay within one provider: there are no cross-scheme consumers. */
    private sameProvider(source: Uri, target: Uri, operation: string): IFileSystemProvider {
        if (source.scheme !== target.scheme) throw unavailable(operation, target);
        return this.writable(source, operation);
    }

    /** A write to a resource runs strictly after the previous one (successful or not). */
    private queue<T>(resource: Uri, task: () => Promise<T>): Promise<T> {
        const key = resource.toString();
        const previous = this.writeQueues.get(key) ?? Promise.resolve();
        const next = previous.then(task, task);
        const tail = next.catch(() => undefined);
        this.writeQueues.set(key, tail);
        // Cleaning up a finished tail is only about memory: write order is kept by
        // the promise chain, not by the key being in the map.
        // Stryker disable next-line all: unobservable from outside, see above
        void tail.then(() => {
            // Stryker disable next-line all: unobservable from outside, see above
            if (this.writeQueues.get(key) === tail) this.writeQueues.delete(key);
        });
        return next;
    }
}

function toFileStat(resource: Uri, stat: IStat): IFileStat {
    return {
        resource,
        name: resource.path.slice(resource.path.lastIndexOf("/") + 1),
        type: stat.type,
        mtime: stat.mtime,
        size: stat.size,
        etag: etag(stat),
        isFile: (stat.type & FileType.File) !== 0,
        isDirectory: (stat.type & FileType.Directory) !== 0,
        isSymbolicLink: (stat.type & FileType.SymbolicLink) !== 0,
    };
}

function checkLimit(resource: Uri, size: number, limit: number | undefined): void {
    if (size > (limit ?? Infinity)) {
        throw new FileOperationError(
            `'${resource.toString()}' is too large (${String(size)} > ${String(limit)} bytes)`,
            FileOperationResult.TooLarge,
        );
    }
}

function unavailable(operation: string, resource: Uri): FileOperationError {
    return new FileOperationError(
        `'${operation}' is not supported for '${resource.toString()}'`,
        FileOperationResult.Unavailable,
    );
}
