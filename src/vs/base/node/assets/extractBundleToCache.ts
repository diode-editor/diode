import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import { readBundleHeader, validateVirtualPath } from "../../common/assets/assetBundleFormat.ts";

export const READY_MARKER = ".diode-ready";

export interface IExtractBundleOptions {
    readonly waitTimeoutMs?: number;
    readonly pollIntervalMs?: number;
    readonly executable?: (virtualPath: string) => boolean;
}

/**
 * Safe for concurrent processes, following `scripts/selfextract-stub.sh`:
 * `mkdir <target>.lock` is an atomic mutex, `.diode-ready` is placed inside before
 * publishing with an atomic `rename`, so a half-extracted directory is never visible.
 * There is no invalidation: `targetDir` must carry a versioned key
 * (`packagedAssetCacheDir`), so a new build gets a new directory.
 */
export async function extractBundleToCache(
    bundle: Uint8Array,
    targetDir: string,
    options: IExtractBundleOptions = {},
): Promise<void> {
    if (isReady(targetDir)) return;
    if (tryLock(targetDir)) {
        publishOwned(targetDir, (tmpDir) => {
            unpackInto(bundle, tmpDir, options);
        });
        return;
    }
    for (const delayMs of waitForPeer(targetDir, options)) await sleep(delayMs);
}

export function extractBundleToCacheSync(
    bundle: Uint8Array,
    targetDir: string,
    options: IExtractBundleOptions = {},
): void {
    populateCacheDirSync(
        targetDir,
        (tmpDir) => {
            unpackInto(bundle, tmpDir, options);
        },
        options,
    );
}

/**
 * The same protocol for content that is not a bundle (the dev ripgrep layout links a binary from
 * node_modules): `populate` fills a private temp directory that is then published by rename.
 */
export function populateCacheDirSync(
    targetDir: string,
    populate: (tmpDir: string) => void,
    options: Pick<IExtractBundleOptions, "waitTimeoutMs" | "pollIntervalMs"> = {},
): void {
    if (isReady(targetDir)) return;
    if (tryLock(targetDir)) {
        publishOwned(targetDir, populate);
        return;
    }
    for (const delayMs of waitForPeer(targetDir, options)) sleepSync(delayMs);
}

function isReady(targetDir: string): boolean {
    return existsSync(path.join(targetDir, READY_MARKER));
}

function tryLock(targetDir: string): boolean {
    mkdirSync(path.dirname(targetDir), { recursive: true });
    try {
        mkdirSync(`${targetDir}.lock`);
        return true;
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        return false;
    }
}

/** Shared by the async and sync variants: returns the delay, the caller does the waiting. */
function* waitForPeer(targetDir: string, options: IExtractBundleOptions): Generator<number, void> {
    const readyPath = path.join(targetDir, READY_MARKER);
    const deadline = Date.now() + (options.waitTimeoutMs ?? 30_000);
    // Stryker disable next-line EqualityOperator: `<=` differs by one extra check exactly at the deadline millisecond
    while (Date.now() < deadline) {
        if (existsSync(readyPath)) return;
        yield options.pollIntervalMs ?? 100;
    }
    throw new Error(
        `diode: timed out waiting for cache unpack at ${targetDir}. ` +
            `If no other diode is starting, remove the stale lock: rm -rf '${targetDir}.lock'`,
    );
}

function unpackInto(bundle: Uint8Array, tmpDir: string, options: IExtractBundleOptions): void {
    const { header, dataView } = readBundleHeader(bundle);
    for (const [virtualPath, entry] of Object.entries(header.files)) {
        validateVirtualPath(virtualPath); // guards against traversal in a broken bundle
        const dest = path.join(tmpDir, ...virtualPath.split("/"));
        mkdirSync(path.dirname(dest), { recursive: true });
        writeFileSync(dest, dataView.subarray(entry.offset, entry.offset + entry.size));
        if (options.executable?.(virtualPath) === true) chmodSync(dest, 0o755);
    }
}

function publishOwned(targetDir: string, populate: (tmpDir: string) => void): void {
    try {
        // Stryker disable next-line StringLiteral: the temp directory prefix is only a name for humans; it is published by rename
        const tmpDir = mkdtempSync(path.join(path.dirname(targetDir), ".tmp-"));
        populate(tmpDir);
        writeFileSync(path.join(tmpDir, READY_MARKER), "");
        // Leftovers of past crashes: rename is atomic only onto a nonexistent path.
        rmSync(targetDir, { recursive: true, force: true });
        renameSync(tmpDir, targetDir);
    } finally {
        // Stryker disable next-line BooleanLiteral: the lock was created by us above and is in place, `force` changes nothing
        rmSync(`${targetDir}.lock`, { recursive: true, force: true });
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function sleepSync(ms: number): void {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
