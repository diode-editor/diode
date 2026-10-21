import { createRequire } from "node:module";

/**
 * The base is `process.execPath`, not `"file:///"`: the latter throws on win32
 * (`ERR_INVALID_FILE_URL_PATH`: a file URL without a drive letter), and `isSeaBinary()`
 * on a Windows SEA would silently answer `false`, so assets would be looked up as files next to the exe.
 */
export function seaRequire(): NodeJS.Require {
    return createRequire(process.execPath);
}

/**
 * `node:sea` is available only via `require()` inside a SEA build; a static
 * ESM import fails with `ERR_UNKNOWN_BUILTIN_MODULE` even in a working SEA exe.
 */
export function isSeaBinary(): boolean {
    try {
        const req = seaRequire();
        const sea = req("node:sea") as { isSea(): boolean };
        return sea.isSea();
    } catch {
        return false;
    }
}

// Stryker disable all: the body runs only inside the SEA binary, unreachable for unit tests (the file is excluded from coverage too); e2e on the built binary covers it
export function readSeaAsset(name: string): ArrayBuffer {
    const req = seaRequire();
    const sea = req("node:sea") as { getAsset(key: string): ArrayBuffer };
    return sea.getAsset(name);
}

/** A view onto the binary's memory: read-only, writing crashes the process. */
export function readSeaRawAsset(name: string): ArrayBuffer | null {
    const req = seaRequire();
    const sea = req("node:sea") as { getRawAsset(key: string): ArrayBuffer };
    try {
        return sea.getRawAsset(name);
    } catch {
        return null;
    }
}
// Stryker restore all
