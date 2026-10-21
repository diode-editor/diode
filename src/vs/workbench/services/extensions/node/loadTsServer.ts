import { createRequire } from "node:module";
import * as path from "node:path";

import { extractBundleToCache } from "../../../../base/node/assets/extractBundleToCache.ts";
import { packagedAssetCacheDirByName, readPackagedAssetView } from "../../../../base/node/assets/packagedAsset.ts";

/** In lockstep with scripts/pack-ts-server.mjs and build-*. */
const ASSET_NAME = "ts-server.bundle";

/** In lockstep with scripts/pack-ts-server.mjs. */
const SERVER_ENTRY = "typescript-language-server/lib/run-cli.cjs";
const TSSERVER_ENTRY = "node_modules/typescript/lib/tsserver.js";

export interface ITsServerPaths {
    /** A CJS shim: works both under node and under diode-as-node. */
    readonly serverPath: string;
    readonly tsserverPath: string;
}

interface IBundleSource {
    readonly cacheDir: string;
}

let cachedTarget: ITsServerPaths | null | undefined;
let cachedSource: IBundleSource | null | undefined;
let ensurePromise: Promise<void> | null = null;

/**
 * Doesn't wait for extraction: the cache directory is deterministic, and the entry appears only whole
 * (directory rename is atomic), so `existsSync` checks readiness. `null` in dev without devDeps.
 */
export function bundledTsServerTarget(): ITsServerPaths | null {
    if (cachedTarget !== undefined) return cachedTarget;
    cachedTarget = computeTarget();
    return cachedTarget;
}

/** Never throws: extraction is fire-and-forget, a failure shows as the bundled candidate never passing existsSync. */
export function ensureTsServer(onError?: (err: unknown) => void): Promise<void> {
    if (ensurePromise !== null) return ensurePromise;
    ensurePromise = (async () => {
        const source = bundleSource();
        if (source === null) return; // dev: node_modules, nothing to extract
        const bundle = readPackagedAssetView(ASSET_NAME);
        // Stryker disable next-line all: file is outside coverage (the bundle source depends on SEA/self-extract); the source logic is covered by packagedAsset (units), the whole path by e2e lspBundled
        if (bundle === null) return;
        await extractBundleToCache(bundle, source.cacheDir);
    })().catch((err: unknown) => {
        onError?.(err);
    });
    return ensurePromise;
}

function computeTarget(): ITsServerPaths | null {
    const source = bundleSource();
    if (source !== null) {
        return {
            serverPath: path.join(source.cacheDir, ...SERVER_ENTRY.split("/")),
            tsserverPath: path.join(source.cacheDir, ...TSSERVER_ENTRY.split("/")),
        };
    }
    // Dev: real node needs no shim, hand out cli.mjs as is.
    try {
        const require_ = createRequire(import.meta.url);
        return {
            serverPath: require_.resolve("typescript-language-server/lib/cli.mjs"),
            tsserverPath: require_.resolve("typescript/lib/tsserver.js"),
        };
    } catch {
        return null;
    }
}

/**
 * Doesn't read the bundle bytes, the key is the build-time digest: paths are handed out on the way to the first
 * frame.
 */
function bundleSource(): IBundleSource | null {
    if (cachedSource !== undefined) return cachedSource;
    // Stryker disable all: file is outside coverage (the bundle source depends on SEA/self-extract); the source logic is covered by packagedAsset (units), the whole path by e2e lspBundled
    const cacheDir = packagedAssetCacheDirByName("ts-server", ASSET_NAME);
    cachedSource = cacheDir === null ? null : { cacheDir };
    // Stryker restore all
    return cachedSource;
}
