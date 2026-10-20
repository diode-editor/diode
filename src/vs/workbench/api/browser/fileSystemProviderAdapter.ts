import { Disposable, type IDisposable } from "../../../base/common/lifecycle.ts";
import type { Uri } from "../../../base/common/uri.ts";
import {
    FileOperationError,
    FileOperationResult,
    FileSystemProviderCapabilities,
    type IFileService,
    type IFileSystemProvider,
    type IStat,
} from "../../../platform/files/common/files.ts";
import type { IExtensionFileSystemBridge } from "../common/iExtensionFileSystem.ts";

/**
 * Держит регистрации в {@link IFileService} в соответствии с
 * набором схем, объявленным субпроцессом ({@link IExtensionFileSystemBridge}).
 * Живёт в слое Extensions — ядро про host не знает.
 *
 * Схемы приходят и уходят вместе с активацией расширений, поэтому регистрации
 * пересобираются по событию: появившиеся — регистрируются, исчезнувшие —
 * снимаются. Событие изменения содержимого одно на все схемы, поэтому каждый
 * зарегистрированный поставщик фильтрует его по своей схеме — иначе правка в
 * `git:` будила бы потребителей `output:`.
 */
export class FileSystemProviderAdapter extends Disposable {
    private readonly bridge: IExtensionFileSystemBridge;
    private readonly registry: IFileService;
    /** Регистрация схемы и с какой записываемостью она сделана. */
    private readonly registrations = new Map<
        string,
        { readonly readonly: boolean; readonly registration: IDisposable }
    >();

    public constructor(bridge: IExtensionFileSystemBridge, registry: IFileService) {
        super();
        this.bridge = bridge;
        this.registry = registry;
        this.register(
            this.bridge.onFileSystemProvidersChanged(() => {
                this.sync();
            }),
        );
        this.register({
            dispose: () => {
                this.clear();
            },
        });
        // Расширение могло объявить схемы до создания адаптера.
        this.sync();
    }

    /**
     * Приводит набор регистраций к текущему списку схем субпроцесса. Схема,
     * сменившая записываемость (расширение перерегистрировало провайдера), —
     * перерегистрируется: capabilities у провайдера ядра неизменяемы.
     */
    private sync(): void {
        const wanted = new Map(
            this.bridge.getFileSystemSchemes().map((scheme) => [scheme, this.bridge.isReadonlyFileSystem(scheme)]),
        );

        for (const [scheme, entry] of this.registrations) {
            if (wanted.get(scheme) === entry.readonly) continue;
            entry.registration.dispose();
            this.registrations.delete(scheme);
        }

        for (const [scheme, readonly] of wanted) {
            if (this.registrations.has(scheme)) continue;
            this.registrations.set(scheme, { readonly, registration: this.registerScheme(scheme, readonly) });
        }
    }

    /**
     * Чтение — всегда; запись и stat — только у пишущей схемы: `stat` нужен
     * сервису для записи (etag, Create/Write), а у read-only схемы был бы лишним
     * кругом RPC перед каждым чтением.
     */
    private registerScheme(scheme: string, readonly: boolean): IDisposable {
        const provider: IFileSystemProvider = {
            capabilities: readonly ? FileSystemProviderCapabilities.Readonly : FileSystemProviderCapabilities.None,
            readFile: (uri) => this.bridge.readProvidedFile(uri),
            onDidChangeFile: (cb) =>
                this.bridge.onDidChangeProvidedFile((uris) => {
                    const mine = uris.filter((uri: Uri) => uri.scheme === scheme);
                    if (mine.length > 0) cb(mine);
                }),
        };
        if (readonly) return this.registry.registerProvider(scheme, provider);
        return this.registry.registerProvider(scheme, {
            ...provider,
            stat: async (uri): Promise<IStat> => {
                const stat = await this.bridge.statProvidedFile(uri);
                if (stat === null) {
                    throw new FileOperationError(`'${uri.toString()}' does not exist`, FileOperationResult.NotFound);
                }
                return stat;
            },
            writeFile: (uri, content) => this.bridge.writeProvidedFile(uri, content),
        });
    }

    private clear(): void {
        for (const entry of this.registrations.values()) entry.registration.dispose();
        this.registrations.clear();
    }
}
