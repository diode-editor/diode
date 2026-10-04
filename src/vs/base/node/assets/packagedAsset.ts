import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

import { DIODE_VERSION } from "../../common/version.ts";
import { userCacheDir } from "../cachePaths.ts";
import { isSeaBinary, readSeaAsset } from "../isSea.ts";

import { entryDir } from "./packagedRuntime.ts";

/** Откуда читаются упакованные ассеты — шов для тестов; по умолчанию настоящий процесс. */
export interface IPackagedAssetEnvironment {
    isSea(): boolean;
    readSeaAsset(name: string): ArrayBuffer;
    /** Каталог entry-скрипта (`dist/` упакованной сборки); `null` — URL не файловый. */
    entryDir(): string | null;
}

const processEnvironment: IPackagedAssetEnvironment = { isSea: isSeaBinary, readSeaAsset, entryDir };

/**
 * Байты упакованного ассета (`rg.bundle`, `node-pty.bundle`, `ts-server.bundle`):
 *  - SEA — вшитый ассет (`node:sea.getAsset`);
 *  - self-extract — файл с тем же именем рядом с `main.js` (`build-selfextract.mjs`);
 *  - dev (или ассет в эту сборку не кладётся) — `null`, вызывающий берёт node_modules.
 */
export function readPackagedAsset(
    name: string,
    environment: IPackagedAssetEnvironment = processEnvironment,
): Uint8Array | null {
    if (environment.isSea()) return new Uint8Array(environment.readSeaAsset(name));
    const dir = environment.entryDir();
    if (dir === null) return null;
    const file = path.join(dir, name);
    return existsSync(file) ? readFileSync(file) : null;
}

/**
 * Каталог кэша для распаковки ассета: `<userCacheDir>/<kind>/<версия>-<sha256(bytes)[0:12]>`.
 * Ключ по содержимому, а не по размеру: новая сборка того же размера получает
 * новый каталог, а не чужой бинарь. Распаковка — `extractBundleToCache(Sync)`.
 */
export function packagedAssetCacheDir(kind: string, bytes: Uint8Array, cacheRoot: string = userCacheDir()): string {
    const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
    return path.join(cacheRoot, kind, `${DIODE_VERSION}-${digest}`);
}
