import type { IRegistryExtensionMeta, IRegistryIndex, IRegistryVersion } from "./registryFormat.ts";

export interface IExtensionRegistrySource {
    getIndex(): Promise<IRegistryIndex>;

    /** `undefined` means the registry does not know this id. */
    getMeta(id: string): Promise<IRegistryExtensionMeta | undefined>;

    /**
     * Absolute path to the `.vsix`; a file source may return an existing file without
     * copying it. The caller owns `tempDir` and its cleanup, and verifies sha256.
     */
    fetchArtifact(version: IRegistryVersion, tempDir: string): Promise<string>;
}
