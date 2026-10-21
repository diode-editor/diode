import type { IExtensionManifest } from "./iExtensionManifest.ts";

/**
 * `location` — виртуальный prefix каталога (POSIX, с `/` на конце) для
 * `joinVirtualPath`, резолвится через {@link IAssetAccess}. `id` —
 * `${publisher}.${name}`.
 */
export interface IExtension {
    readonly id: string;
    readonly manifest: IExtensionManifest;
    readonly location: string;
    readonly isBuiltin: boolean;
}
