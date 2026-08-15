import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { bundleFileExists } from "../../common/assets/bundleFile.ts";
import { isSeaBinary } from "../isSea.ts";

/**
 * Различение «упакованная сборка» vs «dev» — шире, чем `isSeaBinary()`.
 *
 * Упакованных форматов у нас два:
 *   - **SEA** (`node --build-sea`) — ассеты внутри бинаря, `node:sea.isSea() === true`;
 *   - **self-extract** (`scripts/build-selfextract.mjs`) — распакованные в кэш
 *     `node` + `main.js` + `diode.bundle`; это обычный Node, и `isSea()` там `false`.
 *
 * Всё, что должно вести себя «как в проде», обязано спрашивать
 * {@link isPackagedRuntime}, а не `isSeaBinary()` — иначе self-extract получит
 * dev-поведение (напр. `diode.log` в cwd пользователя).
 */

/**
 * Каталог entry-скрипта: `dist/` в упакованной сборке (tsup собирает всё в один
 * `dist/main.js`, `import.meta.url` он сохраняет дословно) и `src/Common/Assets/`
 * под `tsx` — там бандла нет, что и даёт естественный фолбэк в dev.
 *
 * `null`, если URL не файловый (под SEA реального файла нет).
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
