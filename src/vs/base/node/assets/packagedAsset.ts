import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

import { DIODE_VERSION } from "../../common/version.ts";
import { userCacheDir } from "../cachePaths.ts";
import { isSeaBinary, readSeaAsset, readSeaRawAsset } from "../isSea.ts";

import { entryDir } from "./packagedRuntime.ts";

export interface IPackagedAssetEnvironment {
    isSea(): boolean;
    readSeaAsset(name: string): ArrayBuffer;
    readSeaRawAsset(name: string): ArrayBuffer | null;
    entryDir(): string | null;
}

const processEnvironment: IPackagedAssetEnvironment = { isSea: isSeaBinary, readSeaAsset, readSeaRawAsset, entryDir };

/** `null` в dev — вызывающий берёт node_modules. */
export function readPackagedAsset(
    name: string,
    environment: IPackagedAssetEnvironment = processEnvironment,
): Uint8Array | null {
    if (environment.isSea()) return new Uint8Array(environment.readSeaAsset(name));
    return readEntryDirFile(name, environment);
}

/** В SEA — вид на память бинаря без копии: **только чтение**, запись роняет процесс. */
export function readPackagedAssetView(
    name: string,
    environment: IPackagedAssetEnvironment = processEnvironment,
): Uint8Array | null {
    if (!environment.isSea()) return readEntryDirFile(name, environment);
    const raw = environment.readSeaRawAsset(name);
    return raw === null ? null : new Uint8Array(raw);
}

function readEntryDirFile(name: string, environment: IPackagedAssetEnvironment): Uint8Array | null {
    const dir = environment.entryDir();
    if (dir === null) return null;
    const file = path.join(dir, name);
    return existsSync(file) ? readFileSync(file) : null;
}

/** Ключ по содержимому, а не по размеру: новая сборка того же размера не получит чужой бинарь. */
export function packagedAssetCacheDir(kind: string, bytes: Uint8Array, cacheRoot: string = userCacheDir()): string {
    return cacheDirForDigest(kind, sha256Hex(bytes), cacheRoot);
}

/** Сайдкар пишет `build-dist.mjs`. */
export const PACKAGED_ASSET_DIGEST_SUFFIX = ".sha256";

/**
 * Хэш берётся из сайдкара, посчитанного при сборке: хэш 13-мегабайтного
 * `ts-server.bundle` на пути к первому кадру стоил ~12 мс. Нет сайдкара — хэш по байтам.
 */
export function packagedAssetCacheDirByName(
    kind: string,
    name: string,
    environment: IPackagedAssetEnvironment = processEnvironment,
    cacheRoot: string = userCacheDir(),
): string | null {
    const sidecar = readPackagedAssetView(`${name}${PACKAGED_ASSET_DIGEST_SUFFIX}`, environment);
    if (sidecar !== null) {
        const digest = Buffer.from(sidecar).toString("latin1").trim();
        if (/^[0-9a-f]{64}$/.test(digest)) return cacheDirForDigest(kind, digest, cacheRoot);
    }
    const bytes = readPackagedAssetView(name, environment);
    return bytes === null ? null : packagedAssetCacheDir(kind, bytes, cacheRoot);
}

function sha256Hex(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

function cacheDirForDigest(kind: string, digest: string, cacheRoot: string): string {
    return path.join(cacheRoot, kind, `${DIODE_VERSION}-${digest.slice(0, 12)}`);
}
