// The shell reads the upstream shell integration scripts from disk: the packaged build unpacks the
// `shell-integration.bundle` asset (`scripts/pack-shell-integration.mjs`) into the user cache, dev reads the sources.

import { fileURLToPath } from "node:url";

import { extractBundleToCacheSync } from "../../../../base/node/assets/extractBundleToCache.ts";
import { packagedAssetCacheDir, readPackagedAsset } from "../../../../base/node/assets/packagedAsset.ts";

const ASSET_NAME = "shell-integration.bundle";

let cached: string | null = null;

export function loadShellIntegrationScriptsDir(): string {
    // Stryker disable next-line AssignmentOperator: without the cache the directory is the same — only the asset re-read is lost
    cached ??= resolveShellIntegrationScriptsDir();
    return cached;
}

/** A `null` `bundle` means dev: the scripts next to the sources. */
export function resolveShellIntegrationScriptsDir(
    bundle: Uint8Array | null = readPackagedAsset(ASSET_NAME),
    cacheRoot?: string,
): string {
    if (bundle === null) return fileURLToPath(new URL("../common/scripts", import.meta.url));
    const dir = packagedAssetCacheDir("shell-integration", bundle, cacheRoot);
    extractBundleToCacheSync(bundle, dir);
    return dir;
}
