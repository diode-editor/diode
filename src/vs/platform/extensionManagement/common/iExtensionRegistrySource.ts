import type { IRegistryExtensionMeta, IRegistryIndex, IRegistryVersion } from "./registryFormat.ts";

export interface IExtensionRegistrySource {
    getIndex(): Promise<IRegistryIndex>;

    /** `undefined` — реестр не знает такого id. */
    getMeta(id: string): Promise<IRegistryExtensionMeta | undefined>;

    /**
     * Абсолютный путь к `.vsix`; файловый источник вправе вернуть существующий файл, не
     * копируя. `tempDir` и его очистка — на вызывающем, проверка sha256 — тоже.
     */
    fetchArtifact(version: IRegistryVersion, tempDir: string): Promise<string>;
}
