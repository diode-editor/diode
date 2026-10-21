import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { isSeaBinary } from "../isSea.ts";

import { bundleFileExists } from "./bundleFile.ts";

/**
 * In the build `import.meta.url` is the main script's URL (the
 * `scripts/import-meta-url-shim.mjs` shim); under `tsx` it is this module's, with no bundle around:
 * that is what gives the dev fallback.
 */
export function entryDir(): string | null {
    try {
        return path.dirname(fileURLToPath(import.meta.url));
    } catch {
        return null;
    }
}

/**
 * Ask "like in production" here, not `isSeaBinary()`: self-extract is a plain
 * Node with `isSea() === false` and would get dev behavior (`diode.log` in cwd).
 */
export function isPackagedRuntime(): boolean {
    if (isSeaBinary()) return true;
    const dir = entryDir();
    return dir !== null && bundleFileExists(dir);
}
