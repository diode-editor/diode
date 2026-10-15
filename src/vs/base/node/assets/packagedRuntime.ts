import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { isSeaBinary } from "../isSea.ts";

import { bundleFileExists } from "./bundleFile.ts";

/**
 * Различение «упакованная сборка» vs «dev» — шире, чем `isSeaBinary()`.
 *
 * Упакованных форматов у нас два:
 *   - **SEA** (`node --build-sea`) — ассеты внутри бинаря, `node:sea.isSea() === true`;
 *   - **self-extract** (`scripts/build-selfextract.mjs`) — распакованные в кэш
 *     `node` + `main.cjs` + `diode.bundle`; это обычный Node, и `isSea()` там `false`.
 *
 * Всё, что должно вести себя «как в проде», обязано спрашивать
 * {@link isPackagedRuntime}, а не `isSeaBinary()` — иначе self-extract получит
 * dev-поведение (напр. `diode.log` в cwd пользователя).
 */

/**
 * Каталог entry-скрипта: в сборке `import.meta.url` — URL главного скрипта
 * процесса (шим CJS-бандла `scripts/import-meta-url-shim.mjs`, общий у ядра и
 * кусков), то есть каталог `dist/main.cjs` или распаковки self-extract, а под SEA
 * — каталог бинаря, где бандла нет. Под `tsx` это каталог этого модуля — бандла
 * там тоже нет, что и даёт естественный фолбэк в dev.
 *
 * `null`, если URL не файловый.
 */
export function entryDir(): string | null {
    try {
        return path.dirname(fileURLToPath(import.meta.url));
    } catch {
        return null;
    }
}

/** Запущены ли мы из упакованной сборки (SEA или self-extract). */
export function isPackagedRuntime(): boolean {
    if (isSeaBinary()) return true;
    const dir = entryDir();
    return dir !== null && bundleFileExists(dir);
}
