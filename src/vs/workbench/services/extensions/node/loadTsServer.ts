import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";

import { VEXX_VERSION } from "../../../../base/common/version.ts";
import { extractBundleToCache } from "../../../../base/node/assets/extractBundleToCache.ts";
import { entryDir } from "../../../../base/node/assets/packagedRuntime.ts";
import { userCacheDir } from "../../../../base/node/cachePaths.ts";
import { isSeaBinary } from "../../../../base/node/isSea.ts";

/** Имя SEA-ассета / файла рядом с main.js (лок-степ с scripts/pack-ts-server.mjs и build-*). */
const ASSET_NAME = "ts-server.bundle";

/** Виртуальные пути внутри бандла (лок-степ с scripts/pack-ts-server.mjs). */
const SERVER_ENTRY = "typescript-language-server/lib/run-cli.cjs";
const TSSERVER_ENTRY = "node_modules/typescript/lib/tsserver.js";

/** Пути вшитого language-сервера, готовые к спавну node-рантаймом. */
export interface ITsServerPaths {
    /** Энтрипоинт сервера (CJS-шим run-cli.cjs — работает и под node, и под vexx-as-node). */
    readonly serverPath: string;
    /** tsserver.js для `initializationOptions.tsserver.path`. */
    readonly tsserverPath: string;
}

interface IBundleSource {
    readonly bundle: Uint8Array;
    readonly cacheDir: string;
}

let cachedTarget: ITsServerPaths | null | undefined;
let cachedSource: IBundleSource | null | undefined;
let ensurePromise: Promise<void> | null = null;

/**
 * Целевые пути вшитого сервера БЕЗ ожидания распаковки: каталог кэша
 * детерминирован (`<userCacheDir>/ts-server/<version>-<sha256(bundle)[0:12]>`),
 * поэтому пути можно раздать (configDefaults расширению) до того, как
 * {@link ensureTsServer} довёз файлы; готовность проверяется `existsSync`
 * самого entry (rename публикует каталог атомарно — файл появляется только
 * целиком). В dev распаковки нет вовсе — пути ведут в node_modules репозитория.
 * `null` — вшитого сервера нет (dev без devDeps).
 */
export function bundledTsServerTarget(): ITsServerPaths | null {
    if (cachedTarget !== undefined) return cachedTarget;
    cachedTarget = computeTarget();
    return cachedTarget;
}

/**
 * Довозит вшитый сервер до диска (распаковка бандла в кэш; идемпотентно,
 * конкурентно-безопасно — {@link extractBundleToCache}). В dev — no-op.
 * Ошибки не роняют вызывающего — распаковка стартует fire-and-forget при
 * регистрации builtin'ов (main.ts), сбой честно виден: bundled-кандидат
 * резолва не станет existsSync и клиент упадёт в следующий кандидат.
 */
export function ensureTsServer(onError?: (err: unknown) => void): Promise<void> {
    if (ensurePromise !== null) return ensurePromise;
    ensurePromise = (async () => {
        const source = bundleSource();
        if (source === null) return; // dev: node_modules, распаковывать нечего
        await extractBundleToCache(source.bundle, source.cacheDir);
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
    // Dev: сервер лежит в node_modules репозитория — отдаём как есть (cli.mjs,
    // не шим: настоящему node шим не нужен, но и не вреден — берём то, что есть).
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

/** Байты бандла + целевой каталог кэша; `null` — packaged-бандла нет (dev). */
function bundleSource(): IBundleSource | null {
    if (cachedSource !== undefined) return cachedSource;
    const bundle = readBundleBytes();
    if (bundle === null) {
        cachedSource = null;
        return cachedSource;
    }
    const digest = createHash("sha256").update(bundle).digest("hex").slice(0, 12);
    cachedSource = {
        bundle,
        cacheDir: path.join(userCacheDir(), "ts-server", `${VEXX_VERSION}-${digest}`),
    };
    return cachedSource;
}

function readBundleBytes(): Uint8Array | null {
    if (isSeaBinary()) {
        // `node:sea` доступен только через require внутри SEA-сборки (статический
        // ESM-импорт падает) — тот же паттерн, что isSea.ts/loadRipgrep.ts.
        const seaRequire = createRequire("file:///");
        const sea = seaRequire("node:sea") as { getAsset(key: string): ArrayBuffer };
        return new Uint8Array(sea.getAsset(ASSET_NAME));
    }
    // Self-extract: бандл лежит файлом рядом с main.js (build-selfextract.mjs).
    const dir = entryDir();
    if (dir !== null) {
        const bundlePath = path.join(dir, ASSET_NAME);
        if (existsSync(bundlePath)) return readFileSync(bundlePath);
    }
    return null;
}
