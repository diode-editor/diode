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

/** `null` in dev: the caller uses node_modules. */
export function readPackagedAsset(
    name: string,
    environment: IPackagedAssetEnvironment = processEnvironment,
): Uint8Array | null {
    if (environment.isSea()) return new Uint8Array(environment.readSeaAsset(name));
    return readEntryDirFile(name, environment);
}

/** In SEA, a view onto the binary's memory without a copy: **read-only**, writing crashes the process. */
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

/** Keyed by content, not size: a new build of the same size doesn't get someone else's binary. */
export function packagedAssetCacheDir(kind: string, bytes: Uint8Array, cacheRoot: string = userCacheDir()): string {
    return cacheDirForDigest(kind, sha256Hex(bytes), cacheRoot);
}

/** The sidecar is written by `build-dist.mjs`. */
export const PACKAGED_ASSET_DIGEST_SUFFIX = ".sha256";

/**
 * The hash comes from a sidecar computed at build time: hashing the 13 MB
 * `ts-server.bundle` on the way to the first frame cost ~12 ms. No sidecar means hashing the bytes.
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
