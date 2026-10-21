/**
 * Assets from the FS (dev, tests) or from the SEA binary's bundle. Paths are POSIX, with no
 * leading `/` and no `..` segments.
 */
export interface IAssetAccess {
    /** Rejects if the asset is missing. */
    read(virtualPath: string): Promise<Uint8Array>;

    /** UTF-8. Rejects if the asset is missing. */
    readText(virtualPath: string): Promise<string>;

    exists(virtualPath: string): Promise<boolean>;

    /** Direct children only; `virtualPrefix` is empty or ends with `/`. */
    listEntries(virtualPrefix: string): Promise<IAssetEntry[]>;
}

export interface IAssetEntry {
    readonly name: string;
    readonly isDirectory: boolean;
}
