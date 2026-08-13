import { Disposable, type IDisposable } from "@tuidom/all/common/disposable";
import type { Uri } from "../../../base/common/uri.ts";
import type { IFileSystemProviderRegistry } from "../../../platform/files/common/iFileSystemProviderRegistry.ts";
import type { IExtensionFileSystemBridge } from "../common/iExtensionFileSystem.ts";

/**
 * Держит регистрации в {@link IFileSystemProviderRegistry} в соответствии с
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
    private readonly registry: IFileSystemProviderRegistry;
    private readonly registrations = new Map<string, IDisposable>();

    public constructor(bridge: IExtensionFileSystemBridge, registry: IFileSystemProviderRegistry) {
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

    /** Приводит набор регистраций к текущему списку схем субпроцесса. */
    private sync(): void {
        const wanted = new Set(this.bridge.getFileSystemSchemes());

        for (const [scheme, registration] of this.registrations) {
            if (wanted.has(scheme)) continue;
            registration.dispose();
            this.registrations.delete(scheme);
        }

        for (const scheme of wanted) {
            if (this.registrations.has(scheme)) continue;
            this.registrations.set(scheme, this.registerScheme(scheme));
        }
    }

    private registerScheme(scheme: string): IDisposable {
        return this.registry.registerProvider(scheme, {
            readFile: (uri) => this.bridge.readProvidedFile(uri),
            onDidChangeFile: (cb) =>
                this.bridge.onDidChangeProvidedFile((uris) => {
                    const mine = uris.filter((uri: Uri) => uri.scheme === scheme);
                    if (mine.length > 0) cb(mine);
                }),
        });
    }

    private clear(): void {
        for (const registration of this.registrations.values()) registration.dispose();
        this.registrations.clear();
    }
}
