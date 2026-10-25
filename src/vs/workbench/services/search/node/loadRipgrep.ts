// Two paths, like loadNodePty: dev uses @vscode/ripgrep from node_modules; the build uses
// the `rg.bundle` asset extracted into the cache (an executable cannot run from a JS blob).

import { createRequire } from "node:module";
import { join } from "node:path";

import { extractBundleToCacheSync } from "../../../../base/node/assets/extractBundleToCache.ts";
import { packagedAssetCacheDir, readPackagedAsset } from "../../../../base/node/assets/packagedAsset.ts";

const ASSET_NAME = "rg.bundle";

let cached: string | null = null;

/**
 * Test seam for e2e and `drive`: a fake rg stands in for a search hung on a slow file system.
 * Read on every call, not at module level (the binary starts from a V8 snapshot).
 */
export const RIPGREP_PATH_ENV = "DIODE_RIPGREP_PATH";

export function loadRipgrepPath(env: NodeJS.ProcessEnv = process.env): string {
    const override = env[RIPGREP_PATH_ENV];
    if (override !== undefined && override !== "") return override;
    // Stryker disable next-line AssignmentOperator: without the cache the path is the same — only the saved asset re-read is lost
    cached ??= resolveRipgrepPath();
    return cached;
}

/** `bundle === null` means dev (@vscode/ripgrep). The binary name inside the bundle matches pack-ripgrep.mjs. */
export function resolveRipgrepPath(
    bundle: Uint8Array | null = readPackagedAsset(ASSET_NAME),
    cacheRoot?: string,
    platform: NodeJS.Platform = process.platform,
): string {
    if (bundle === null) {
        const require = createRequire(import.meta.url);
        return (require("@vscode/ripgrep") as { rgPath: string }).rgPath;
    }
    const dir = packagedAssetCacheDir("rg", bundle, cacheRoot);
    extractBundleToCacheSync(bundle, dir, { executable: () => true });
    return join(dir, platform === "win32" ? "rg.exe" : "rg");
}
