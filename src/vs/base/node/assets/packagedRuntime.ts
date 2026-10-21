import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { isSeaBinary } from "../isSea.ts";

import { bundleFileExists } from "./bundleFile.ts";

/**
 * В сборке `import.meta.url` — URL главного скрипта (шим
 * `scripts/import-meta-url-shim.mjs`), под `tsx` — этого модуля, где бандла нет:
 * это и даёт фолбэк в dev.
 */
export function entryDir(): string | null {
    try {
        return path.dirname(fileURLToPath(import.meta.url));
    } catch {
        return null;
    }
}

/**
 * «Как в проде» спрашивать здесь, а не `isSeaBinary()`: self-extract — обычный
 * Node с `isSea() === false`, и получил бы dev-поведение (`diode.log` в cwd).
 */
export function isPackagedRuntime(): boolean {
    if (isSeaBinary()) return true;
    const dir = entryDir();
    return dir !== null && bundleFileExists(dir);
}
