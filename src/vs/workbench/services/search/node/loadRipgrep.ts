// Загрузчик бинаря ripgrep (`rg`) с двумя путями, ровно как loadNodePty:
//   - dev (tsx/npm): путь из пакета @vscode/ripgrep (он же кладёт per-platform
//     бинарь в node_modules);
//   - упакованная сборка: бинарь вшит ассетом `rg.bundle`; на первом запуске
//     распаковываем его в пользовательский кэш и запускаем оттуда (исполняемый
//     файл нельзя запустить из JS-blob — нужен файл на диске).
// Чтение ассета и безопасная распаковка — общие (base/node/assets): кэш по
// хэшу содержимого, лок против двух одновременно стартующих diode.

import { createRequire } from "node:module";
import { join } from "node:path";

import { extractBundleToCacheSync } from "../../../../base/node/assets/extractBundleToCache.ts";
import { packagedAssetCacheDir, readPackagedAsset } from "../../../../base/node/assets/packagedAsset.ts";

const ASSET_NAME = "rg.bundle";

let cached: string | null = null;

/** Абсолютный путь к исполняемому `rg`; кэшируется на процесс. */
export function loadRipgrepPath(): string {
    // Stryker disable next-line AssignmentOperator: без кэша путь тот же — теряется только экономия повторного чтения ассета
    cached ??= resolveRipgrepPath();
    return cached;
}

/**
 * Путь к `rg` без кэша на процесс: `bundle` — байты `rg.bundle` упакованной
 * сборки (`null` — dev, берём @vscode/ripgrep), `cacheRoot` — корень кэша
 * распаковки (по умолчанию пользовательский кэш diode). Имя бинаря в бандле
 * платформозависимо (совпадает с pack-ripgrep.mjs).
 */
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
