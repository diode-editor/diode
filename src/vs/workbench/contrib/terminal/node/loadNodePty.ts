// A native `.node` can't be embedded in the JS blob — `process.dlopen` needs a file on disk: the packaged
// build extracts the `node-pty.bundle` asset into the user cache, dev uses a plain require.

import { createRequire } from "node:module";
import { join } from "node:path";

import type { IPty, IPtyForkOptions, IWindowsPtyForkOptions } from "node-pty";

import { extractBundleToCacheSync } from "../../../../base/node/assets/extractBundleToCache.ts";
import { packagedAssetCacheDir, readPackagedAsset } from "../../../../base/node/assets/packagedAsset.ts";

export type PtySpawn = (
    file: string,
    args: string[] | string,
    options: IPtyForkOptions | IWindowsPtyForkOptions,
) => IPty;

export interface NodePtyModule {
    spawn: PtySpawn;
}

const ASSET_NAME = "node-pty.bundle";

let cached: NodePtyModule | null = null;

export function loadNodePty(): NodePtyModule {
    // Stryker disable next-line AssignmentOperator: require caches the module anyway — only the saving is lost
    cached ??= resolveNodePty();
    return cached;
}

/** Bypasses the per-process cache; a `null` `bundle` means dev, plain require. */
export function resolveNodePty(
    bundle: Uint8Array | null = readPackagedAsset(ASSET_NAME),
    cacheRoot?: string,
): NodePtyModule {
    if (bundle === null) {
        const require = createRequire(import.meta.url);
        return require("node-pty") as NodePtyModule;
    }
    const dir = packagedAssetCacheDir("node-pty", bundle, cacheRoot);
    // The native addon and spawn-helper (macOS) must be executable/loadable.
    extractBundleToCacheSync(bundle, dir, {
        executable: (virtualPath) => virtualPath.endsWith(".node") || virtualPath.endsWith("spawn-helper"),
    });
    const nodePtyDir = join(dir, "node-pty");
    const require = createRequire(join(nodePtyDir, "package.json"));
    return require(nodePtyDir) as NodePtyModule;
}
