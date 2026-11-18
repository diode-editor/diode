import type { IRegistryExtensionMeta, IRegistryIndex, IRegistryVersion } from "./registryFormat.ts";

/**
 * Bytes written so far and the full size, called per chunk and only when the size is known (the registry's `size`,
 * else `Content-Length`). `received` may exceed `total`: the size is a claim, not a limit.
 */
export type ArtifactProgressCallback = (received: number, total: number) => void;

export interface IExtensionRegistrySource {
    getIndex(): Promise<IRegistryIndex>;

    /** `undefined` means the registry does not know this id. */
    getMeta(id: string): Promise<IRegistryExtensionMeta | undefined>;

    /**
     * Absolute path to the `.vsix`; a file source may return an existing file without
     * copying it. The caller owns `tempDir` and its cleanup, and verifies sha256. A source that doesn't download
     * (a local file) never calls `onProgress`.
     */
    fetchArtifact(version: IRegistryVersion, tempDir: string, onProgress?: ArtifactProgressCallback): Promise<string>;
}
