import { createRequire } from "node:module";
import * as path from "node:path";

import { extractBundleToCache } from "../../../../base/node/assets/extractBundleToCache.ts";
import { packagedAssetCacheDirByName, readPackagedAssetView } from "../../../../base/node/assets/packagedAsset.ts";

/** Лок-степ с scripts/pack-ts-server.mjs и build-*. */
const ASSET_NAME = "ts-server.bundle";

/** Лок-степ с scripts/pack-ts-server.mjs. */
const SERVER_ENTRY = "typescript-language-server/lib/run-cli.cjs";
const TSSERVER_ENTRY = "node_modules/typescript/lib/tsserver.js";

export interface ITsServerPaths {
    /** CJS-шим: работает и под node, и под diode-as-node. */
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
 * Без ожидания распаковки: каталог кэша детерминирован, а entry появляется только целиком
 * (rename каталога атомарен) — готовность проверяет `existsSync`. `null` — dev без devDeps.
 */
export function bundledTsServerTarget(): ITsServerPaths | null {
    if (cachedTarget !== undefined) return cachedTarget;
    cachedTarget = computeTarget();
    return cachedTarget;
}

/** Ошибок не бросает: распаковка идёт fire-and-forget, сбой виден тем, что bundled-кандидат не станет existsSync. */
export function ensureTsServer(onError?: (err: unknown) => void): Promise<void> {
    if (ensurePromise !== null) return ensurePromise;
    ensurePromise = (async () => {
        const source = bundleSource();
        if (source === null) return; // dev: node_modules, распаковывать нечего
        const bundle = readPackagedAssetView(ASSET_NAME);
        // Stryker disable next-line all: файл вне покрытия (источник бандла завязан на SEA/self-extract); логика источника — packagedAsset (юниты), путь целиком — e2e lspBundled
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
    // Dev: настоящему node шим не нужен — отдаём cli.mjs как есть.
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

/** Байтов бандла не читает — ключ дайджест со сборки: пути раздаются на пути к первому кадру. */
function bundleSource(): IBundleSource | null {
    if (cachedSource !== undefined) return cachedSource;
    // Stryker disable next-line all: файл вне покрытия (источник бандла завязан на SEA/self-extract); логика источника — packagedAsset (юниты), путь целиком — e2e lspBundled
    const cacheDir = packagedAssetCacheDirByName("ts-server", ASSET_NAME);
    // Stryker disable next-line all: файл вне покрытия (источник бандла завязан на SEA/self-extract); логика источника — packagedAsset (юниты), путь целиком — e2e lspBundled
    cachedSource = cacheDir === null ? null : { cacheDir };
    return cachedSource;
}
