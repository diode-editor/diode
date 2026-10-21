import type { IExtensionManifest } from "./iExtensionManifest.ts";

/**
 * `location` is the directory's virtual prefix (POSIX, trailing `/`) for `joinVirtualPath`,
 * resolved via {@link IAssetAccess}. `id` is `${publisher}.${name}`.
 */
export interface IExtension {
    readonly id: string;
    readonly manifest: IExtensionManifest;
    readonly location: string;
    readonly isBuiltin: boolean;
}
