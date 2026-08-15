import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Чтение `diode.bundle` с реальной ФС — источник ассетов для упакованных сборок,
 * которые не являются SEA (self-extract: рядом с `main.js` лежат `node`,
 * `main.js` и `diode.bundle`, см. `scripts/build-selfextract.mjs`).
 *
 * Формат разбирает {@link AssetBundleFormat}; здесь только I/O — байты уходят
 * в `BundleAssetAccess`, тот же, что и под SEA.
 */

/** Имя файла бандла. Совпадает с ключом SEA-ассета в `scripts/build-sea.mjs`. */
export const BUNDLE_FILE_NAME = "diode.bundle";

/** Путь к бандлу внутри каталога. */
export function bundleFilePath(dir: string): string {
    return path.join(dir, BUNDLE_FILE_NAME);
}

/** Лежит ли рядом бандл. Дешёвая проба — не читает содержимое. */
export function bundleFileExists(dir: string): boolean {
    return fs.existsSync(bundleFilePath(dir));
}

/**
 * Читает бандл из каталога. `null` — файла нет (нормальный dev-сценарий:
 * рядом с `src/main.ts` бандла и не должно быть).
 *
 * Прочие ошибки ФС (EACCES, EISDIR, …) пробрасываются: молча свалиться в dev-режим
 * из-за битых прав — худший из возможных диагнозов.
 */
export function tryReadBundleFile(dir: string): Uint8Array | null {
    try {
        return readBundleFile(dir);
    } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
    }
}

/** Читает бандл из каталога. Отсутствие файла — ошибка. */
export function readBundleFile(dir: string): Uint8Array {
    return fs.readFileSync(bundleFilePath(dir));
}

function isNotFound(err: unknown): boolean {
    return (err as NodeJS.ErrnoException | null)?.code === "ENOENT";
}
