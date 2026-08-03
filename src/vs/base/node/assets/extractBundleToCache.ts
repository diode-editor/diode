import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import { readBundleHeader, validateVirtualPath } from "../../common/assets/assetBundleFormat.ts";

/** Маркер завершённой распаковки (тот же, что у loadRipgrep/loadNodePty). */
export const READY_MARKER = ".vexx-ready";

/**
 * Распаковывает VEXXBND-бандл в каталог кэша идемпотентно и безопасно для
 * конкурентных процессов — схема self-extract-стаба
 * (`scripts/selfextract-stub.sh`), перенесённая в TS:
 *
 *  - готовый каталог (`<target>/.vexx-ready`) — мгновенный no-op;
 *  - `mkdir <target>.lock` — атомарный мьютекс: владелец распаковывает во
 *    временный каталог рядом, кладёт `.vexx-ready` ВНУТРЬ до публикации и
 *    публикует атомарным `rename` — полураспакованное состояние снаружи
 *    ненаблюдаемо;
 *  - проигравший гонку ждёт чужой `.vexx-ready` (poll) и падает по таймауту с
 *    подсказкой про stale lock.
 *
 * Инвалидация — ответственность вызывающего: `targetDir` должен включать
 * версионированный ключ (`<version>-<sha256(bundle)>`, см. loadTsServer.ts) —
 * новая сборка получает новый каталог, а не перезапись живого.
 */
export async function extractBundleToCache(
    bundle: Uint8Array,
    targetDir: string,
    options: { readonly waitTimeoutMs?: number; readonly pollIntervalMs?: number } = {},
): Promise<void> {
    const waitTimeoutMs = options.waitTimeoutMs ?? 30_000;
    const pollIntervalMs = options.pollIntervalMs ?? 100;
    const readyPath = path.join(targetDir, READY_MARKER);
    if (existsSync(readyPath)) return;

    const cacheRoot = path.dirname(targetDir);
    mkdirSync(cacheRoot, { recursive: true });

    const lockDir = `${targetDir}.lock`;
    let owner = false;
    try {
        mkdirSync(lockDir);
        owner = true;
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }

    if (!owner) {
        // Кто-то распаковывает прямо сейчас — ждём его `.vexx-ready`.
        const deadline = Date.now() + waitTimeoutMs;
        while (Date.now() < deadline) {
            if (existsSync(readyPath)) return;
            await sleep(pollIntervalMs);
        }
        throw new Error(
            `vexx: timed out waiting for cache unpack at ${targetDir}. ` +
                `If no other vexx is starting, remove the stale lock: rm -rf '${lockDir}'`,
        );
    }

    try {
        const tmpDir = mkdtempSync(path.join(cacheRoot, ".tmp-"));
        const { header, dataView } = readBundleHeader(bundle);
        for (const [virtualPath, entry] of Object.entries(header.files)) {
            validateVirtualPath(virtualPath); // защита от traversal в битом бандле
            const dest = path.join(tmpDir, ...virtualPath.split("/"));
            mkdirSync(path.dirname(dest), { recursive: true });
            writeFileSync(dest, dataView.subarray(entry.offset, entry.offset + entry.size));
        }
        writeFileSync(path.join(tmpDir, READY_MARKER), "");
        // Под локом: цель rename не должна существовать (незавершённый мусор
        // прошлых падений), rename на несуществующий путь атомарен.
        rmSync(targetDir, { recursive: true, force: true });
        renameSync(tmpDir, targetDir);
    } finally {
        rmSync(lockDir, { recursive: true, force: true });
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
