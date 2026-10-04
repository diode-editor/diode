// Загрузчик нативного node-pty с двумя путями:
//   - dev (tsx/npm): обычный require из node_modules;
//   - упакованная сборка: нативные файлы node-pty вшиты ассетом
//     `node-pty.bundle`; на первом запуске распаковываем их в пользовательский
//     кэш и грузим оттуда через createRequire (нативный `.node` нельзя вшить в
//     JS-blob — `process.dlopen` требует файл на диске). См. docs/TODO/IntegratedTerminal.md.
// Чтение ассета и безопасная распаковка — общие (base/node/assets).

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

/** Загрузить node-pty (dev — из node_modules; упакованная сборка — из распакованного ассета). */
export function loadNodePty(): NodePtyModule {
    // Stryker disable next-line AssignmentOperator: без кэша модуль тот же (require кэширует его сам) — теряется только экономия
    cached ??= resolveNodePty();
    return cached;
}

/**
 * node-pty без кэша на процесс: `bundle` — байты `node-pty.bundle` (`null` — dev,
 * обычный require), `cacheRoot` — корень кэша распаковки.
 */
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
