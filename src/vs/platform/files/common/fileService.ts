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
 * {@link IFileService}: роутер по схеме ресурса поверх провайдеров. Сам на диск
 * не ходит — схему `file` обслуживает `DiskFileSystemProvider` (node-слой),
 * схемы расширений — адаптер extension host'а.
 *
 * Что добавляет сервис поверх провайдера: stat вместе с содержимым, гард
 * грязной записи по etag, очередь записи на ресурс (два save подряд не
 * переплетаются), отказ по возможностям провайдера и события — «это сделали
 * мы» ({@link onDidRunOperation}) и «изменилось снаружи» ({@link onDidFilesChange}).
 */
export class FileService extends Disposable implements IFileService {
    public static dependencies = [] as const;

    private readonly providers = new Map<string, IFileSystemProvider>();
    /** Хвост очереди записи по ресурсу (ключ — `uri.toString()`). */
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
        // Подписка на изменения живёт ровно столько, сколько регистрация: иначе
        // умерший extension host продолжал бы будить потребителей.
        const subscription = provider.onDidChangeFile((uris) => {
            if (uris.length > 0) this.onDidFilesChangeEmitter.fire(uris);
        });
        this.onDidChangeFileSystemProviderRegistrationsEmitter.fire({ scheme, added: true });
        // toDisposable снимает регистрацию ровно раз, а занять схему заново можно
        // только после этого снятия — чужую регистрацию оно задеть не может.
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

    // ─── Чтение ──────────────────────────────────────────────────────────────

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
            // Провайдер без stat (расширение): метаданные — из самого содержимого.
            const value = await provider.readFile(resource);
            checkLimit(resource, value.byteLength, options.limit);
            return { ...toFileStat(resource, { type: FileType.File, mtime: 0, size: value.byteLength }), value };
        }
        // Stat до чтения: каталог и слишком большой файл отказываются, не читаясь.
        const stat = await provider.stat(resource);
        if ((stat.type & FileType.Directory) !== 0) {
            throw new FileOperationError(`'${resource.toString()}' is a directory`, FileOperationResult.IsDirectory);
        }
        checkLimit(resource, stat.size, options.limit);
        return { ...toFileStat(resource, stat), value: await provider.readFile(resource) };
    }

    // ─── Запись ──────────────────────────────────────────────────────────────

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

    // ─── Внутреннее ──────────────────────────────────────────────────────────

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

    /** Провайдер ресурса, если он не только для чтения. */
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

    /** Перенос и копирование — внутри одного провайдера: межсхемных потребителей нет. */
    private sameProvider(source: Uri, target: Uri, operation: string): IFileSystemProvider {
        if (source.scheme !== target.scheme) throw unavailable(operation, target);
        return this.writable(source, operation);
    }

    /** Запись в ресурс идёт строго после предыдущей (успешной или нет). */
    private queue<T>(resource: Uri, task: () => Promise<T>): Promise<T> {
        const key = resource.toString();
        const previous = this.writeQueues.get(key) ?? Promise.resolve();
        const next = previous.then(task, task);
        const tail = next.catch(() => undefined);
        this.writeQueues.set(key, tail);
        // Уборка отработавшего хвоста — только память: порядок записей держит
        // цепочка промисов, а не наличие ключа в карте.
        // Stryker disable next-line all: ненаблюдаемо снаружи — см. выше
        void tail.then(() => {
            // Stryker disable next-line all: ненаблюдаемо снаружи — см. выше
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
