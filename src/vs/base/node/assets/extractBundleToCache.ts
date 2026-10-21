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
 * Безопасно для конкурентных процессов — схема `scripts/selfextract-stub.sh`:
 * `mkdir <target>.lock` — атомарный мьютекс, `.diode-ready` кладётся внутрь до
 * публикации атомарным `rename`, так что полураспакованное снаружи не видно.
 * Инвалидации нет: `targetDir` обязан нести версионированный ключ
 * (`packagedAssetCacheDir`) — новая сборка получает новый каталог.
 */
export async function extractBundleToCache(
    bundle: Uint8Array,
    targetDir: string,
    options: IExtractBundleOptions = {},
): Promise<void> {
    if (isReady(targetDir)) return;
    if (tryLock(targetDir)) {
        unpackOwned(bundle, targetDir, options);
        return;
    }
    for (const delayMs of waitForPeer(targetDir, options)) await sleep(delayMs);
}

export function extractBundleToCacheSync(
    bundle: Uint8Array,
    targetDir: string,
    options: IExtractBundleOptions = {},
): void {
    if (isReady(targetDir)) return;
    if (tryLock(targetDir)) {
        unpackOwned(bundle, targetDir, options);
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

/** Общий для async- и sync-вариантов: отдаёт задержку, а ждёт её вызывающий. */
function* waitForPeer(targetDir: string, options: IExtractBundleOptions): Generator<number, void> {
    const readyPath = path.join(targetDir, READY_MARKER);
    const deadline = Date.now() + (options.waitTimeoutMs ?? 30_000);
    // Stryker disable next-line EqualityOperator: `<=` отличается одной лишней проверкой ровно в миллисекунду дедлайна
    while (Date.now() < deadline) {
        if (existsSync(readyPath)) return;
        yield options.pollIntervalMs ?? 100;
    }
    throw new Error(
        `diode: timed out waiting for cache unpack at ${targetDir}. ` +
            `If no other diode is starting, remove the stale lock: rm -rf '${targetDir}.lock'`,
    );
}

function unpackOwned(bundle: Uint8Array, targetDir: string, options: IExtractBundleOptions): void {
    try {
        // Stryker disable next-line StringLiteral: префикс временного каталога — только имя для глаз; публикуется он rename'ом
        const tmpDir = mkdtempSync(path.join(path.dirname(targetDir), ".tmp-"));
        const { header, dataView } = readBundleHeader(bundle);
        for (const [virtualPath, entry] of Object.entries(header.files)) {
            validateVirtualPath(virtualPath); // защита от traversal в битом бандле
            const dest = path.join(tmpDir, ...virtualPath.split("/"));
            mkdirSync(path.dirname(dest), { recursive: true });
            writeFileSync(dest, dataView.subarray(entry.offset, entry.offset + entry.size));
            if (options.executable?.(virtualPath) === true) chmodSync(dest, 0o755);
        }
        writeFileSync(path.join(tmpDir, READY_MARKER), "");
        // Мусор прошлых падений: rename атомарен только на несуществующий путь.
        rmSync(targetDir, { recursive: true, force: true });
        renameSync(tmpDir, targetDir);
    } finally {
        // Stryker disable next-line BooleanLiteral: лок создан нами же выше и на месте — `force` ничего не меняет
        rmSync(`${targetDir}.lock`, { recursive: true, force: true });
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function sleepSync(ms: number): void {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
