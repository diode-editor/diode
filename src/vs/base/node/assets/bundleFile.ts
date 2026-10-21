import * as fs from "node:fs";
import * as path from "node:path";

/** Matches the SEA asset key in `scripts/build-sea.mjs`. */
export const BUNDLE_FILE_NAME = "diode.bundle";

export function bundleFilePath(dir: string): string {
    return path.join(dir, BUNDLE_FILE_NAME);
}

export function bundleFileExists(dir: string): boolean {
    return fs.existsSync(bundleFilePath(dir));
}

/** Only ENOENT gives `null`: silently falling back to dev mode over broken permissions is the worst diagnosis. */
export function tryReadBundleFile(dir: string): Uint8Array | null {
    try {
        return readBundleFile(dir);
    } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
    }
}

export function readBundleFile(dir: string): Uint8Array {
    return fs.readFileSync(bundleFilePath(dir));
}

function isNotFound(err: unknown): boolean {
    return (err as NodeJS.ErrnoException | null)?.code === "ENOENT";
}
