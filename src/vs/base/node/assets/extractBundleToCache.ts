import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import { readBundleHeader, validateVirtualPath } from "../../common/assets/assetBundleFormat.ts";

/** Маркер завершённой распаковки. */
export const READY_MARKER = ".diode-ready";

export interface IExtractBundleOptions {
    /** Сколько ждать чужую распаковку, мс (по умолчанию 30 с). */
    readonly waitTimeoutMs?: number;
    /** Шаг опроса чужого `.diode-ready`, мс (по умолчанию 100). */
    readonly pollIntervalMs?: number;
    /**
     * Какие файлы бандла сделать исполняемыми (`0o755`) до публикации: бинарь
     * rg, нативный аддон и `spawn-helper` node-pty. На Windows chmod безвреден.
     */
    readonly executable?: (virtualPath: string) => boolean;
}

/**
 * Распаковывает DIODEBND-бандл в каталог кэша идемпотентно и безопасно для
 * конкурентных процессов — схема self-extract-стаба
 * (`scripts/selfextract-stub.sh`), перенесённая в TS:
 *
 *  - готовый каталог (`<target>/.diode-ready`) — мгновенный no-op;
 *  - `mkdir <target>.lock` — атомарный мьютекс: владелец распаковывает во
 *    временный каталог рядом, кладёт `.diode-ready` ВНУТРЬ до публикации и
 *    публикует атомарным `rename` — полураспакованное состояние снаружи
 *    ненаблюдаемо;
 *  - проигравший гонку ждёт чужой `.diode-ready` (poll) и падает по таймауту с
 *    подсказкой про stale lock.
 *
 * Инвалидация — ответственность вызывающего: `targetDir` должен включать
 * версионированный ключ (`<version>-<sha256(bundle)>`, см. `packagedAssetCacheDir`) —
 * новая сборка получает новый каталог, а не перезапись живого.
 */
export async function extractBundleToCache(
    bundle: Uint8Array,
    targetDir: string,
    options: IExtractBundleOptions = {},
): Promise<void> {
    const lock = acquire(targetDir);
    if (lock === "ready") return;
    if (lock === "busy") {
        for (const delayMs of waitForPeer(targetDir, options)) await sleep(delayMs);
        return;
    }
    unpackOwned(bundle, targetDir, options);
}

/**
 * Синхронный вариант {@link extractBundleToCache} — для загрузчиков, которых
 * зовут из синхронного кода (спавн rg в `search()`, PTY в конструкторе сессии).
 * Ожидание чужой распаковки блокирует поток (`Atomics.wait`), как и сам
 * синхронный вызов.
 */
export function extractBundleToCacheSync(
    bundle: Uint8Array,
    targetDir: string,
    options: IExtractBundleOptions = {},
): void {
    const lock = acquire(targetDir);
    if (lock === "ready") return;
    if (lock === "busy") {
        for (const delayMs of waitForPeer(targetDir, options)) sleepSync(delayMs);
        return;
    }
    unpackOwned(bundle, targetDir, options);
}

/** `ready` — уже распаковано; `owner` — лок наш; `busy` — распаковывает другой. */
function acquire(targetDir: string): "ready" | "owner" | "busy" {
    if (existsSync(path.join(targetDir, READY_MARKER))) return "ready";
    mkdirSync(path.dirname(targetDir), { recursive: true });
    try {
        mkdirSync(`${targetDir}.lock`);
        return "owner";
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        return "busy";
    }
}

/**
 * Шаги ожидания чужого `.diode-ready`: отдаёт задержку до следующей проверки,
 * пока маркера нет; по таймауту бросает с подсказкой про stale lock. Общий для
 * async- и sync-вариантов — различается только способ подождать шаг.
 */
function* waitForPeer(targetDir: string, options: IExtractBundleOptions): Generator<number, void> {
    const readyPath = path.join(targetDir, READY_MARKER);
    const deadline = Date.now() + (options.waitTimeoutMs ?? 30_000);
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
        // Под локом: цель rename не должна существовать (незавершённый мусор
        // прошлых падений), rename на несуществующий путь атомарен.
        rmSync(targetDir, { recursive: true, force: true });
        renameSync(tmpDir, targetDir);
    } finally {
        rmSync(`${targetDir}.lock`, { recursive: true, force: true });
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function sleepSync(ms: number): void {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
