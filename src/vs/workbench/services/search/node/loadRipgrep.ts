// Два пути, как loadNodePty: dev — @vscode/ripgrep из node_modules; сборка — ассет
// `rg.bundle`, распакованный в кэш (исполняемый файл не запустить из JS-blob).

import { createRequire } from "node:module";
import { join } from "node:path";

import { extractBundleToCacheSync } from "../../../../base/node/assets/extractBundleToCache.ts";
import { packagedAssetCacheDir, readPackagedAsset } from "../../../../base/node/assets/packagedAsset.ts";

const ASSET_NAME = "rg.bundle";

let cached: string | null = null;

export function loadRipgrepPath(): string {
    // Stryker disable next-line AssignmentOperator: без кэша путь тот же — теряется только экономия повторного чтения ассета
    cached ??= resolveRipgrepPath();
    return cached;
}

/** `bundle === null` — dev (@vscode/ripgrep). Имя бинаря в бандле — как в pack-ripgrep.mjs. */
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
