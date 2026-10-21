import * as fs from "node:fs";
import * as path from "node:path";

/** Совпадает с ключом SEA-ассета в `scripts/build-sea.mjs`. */
export const BUNDLE_FILE_NAME = "diode.bundle";

export function bundleFilePath(dir: string): string {
    return path.join(dir, BUNDLE_FILE_NAME);
}

export function bundleFileExists(dir: string): boolean {
    return fs.existsSync(bundleFilePath(dir));
}

/** Только ENOENT — `null`: молча свалиться в dev-режим из-за битых прав — худший диагноз. */
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
