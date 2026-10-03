import { Emitter } from "../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../base/common/lifecycle.ts";
import type { Uri } from "../../../base/common/uri.ts";

import type { IFileSystemProviderRegistry, IReadOnlyFileSystemProvider } from "./iFileSystemProviderRegistry.ts";

/**
 * Реализация {@link IFileSystemProviderRegistry}: схема → поставщик, плюс
 * агрегированное событие изменений.
 *
 * Подписка на `onDidChangeFile` поставщика живёт ровно столько же, сколько его
 * регистрация: снятие регистрации отписывает и её, иначе умерший extension host
 * продолжал бы будить потребителей.
 */
export class FileSystemProviderRegistry extends Disposable implements IFileSystemProviderRegistry {
    private readonly providers = new Map<string, IReadOnlyFileSystemProvider>();
    private readonly onDidChangeFileEmitter = new Emitter<readonly Uri[]>();
    public readonly onDidChangeFile = this.onDidChangeFileEmitter.event;
    private readonly onDidChangeProvidersEmitter = new Emitter<void>();
    public readonly onDidChangeProviders = this.onDidChangeProvidersEmitter.event;

    public registerProvider(scheme: string, provider: IReadOnlyFileSystemProvider): IDisposable {
        if (this.providers.has(scheme)) {
            throw new Error(`file system provider for scheme "${scheme}" is already registered`);
        }
        this.providers.set(scheme, provider);
        const subscription = provider.onDidChangeFile((uris) => {
            this.fireDidChangeFile(uris);
        });
        this.fireDidChangeProviders();
        return {
            dispose: () => {
                subscription.dispose();
                // Гейт по идентичности: если схему успели перерегистрировать,
                // снятие старой регистрации не должно убивать нового поставщика.
                if (this.providers.get(scheme) !== provider) return;
                this.providers.delete(scheme);
                this.fireDidChangeProviders();
            },
        };
    }

    public hasProvider(scheme: string): boolean {
        return this.providers.has(scheme);
    }

    public readFile(uri: Uri): Promise<Uint8Array> {
        const provider = this.providers.get(uri.scheme);
        if (provider === undefined) {
            return Promise.reject(new Error(`no file system provider for scheme "${uri.scheme}"`));
        }
        return provider.readFile(uri);
    }

    private fireDidChangeProviders(): void {
        this.onDidChangeProvidersEmitter.fire();
    }

    private fireDidChangeFile(uris: readonly Uri[]): void {
        if (uris.length === 0) return;
        this.onDidChangeFileEmitter.fire(uris);
    }
}
