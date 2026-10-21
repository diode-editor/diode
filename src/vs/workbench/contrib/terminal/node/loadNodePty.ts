// Нативный `.node` нельзя вшить в JS-blob — `process.dlopen` требует файл на диске: упакованная
// сборка распаковывает ассет `node-pty.bundle` в пользовательский кэш, dev — обычный require.

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
    // Stryker disable next-line AssignmentOperator: без кэша модуль тот же (require кэширует его сам) — теряется только экономия
    cached ??= resolveNodePty();
    return cached;
}

/** Без кэша на процесс; `bundle` `null` — dev, обычный require. */
export function resolveNodePty(
    bundle: Uint8Array | null = readPackagedAsset(ASSET_NAME),
    cacheRoot?: string,
): NodePtyModule {
    if (bundle === null) {
        const require = createRequire(import.meta.url);
        return require("node-pty") as NodePtyModule;
    }
    const dir = packagedAssetCacheDir("node-pty", bundle, cacheRoot);
    // Нативный аддон и spawn-helper (macOS) должны быть исполняемыми/загружаемыми.
    extractBundleToCacheSync(bundle, dir, {
        executable: (virtualPath) => virtualPath.endsWith(".node") || virtualPath.endsWith("spawn-helper"),
    });
    const nodePtyDir = join(dir, "node-pty");
    const require = createRequire(join(nodePtyDir, "package.json"));
    return require(nodePtyDir) as NodePtyModule;
}
