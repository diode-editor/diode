import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { BundleAssetAccess } from "../../common/assets/bundleAssetAccess.ts";
import type { IAssetAccess } from "../../common/assets/iAssetAccess.ts";
import { seaRequire } from "../isSea.ts";

import { BUNDLE_FILE_NAME, tryReadBundleFile } from "./bundleFile.ts";
import { FsAssetAccess } from "./fsAssetAccess.ts";
import { entryDir } from "./packagedRuntime.ts";

const SEA_BUNDLE_KEY = BUNDLE_FILE_NAME;

/**
 * In SEA the bundle comes from `getRawAsset()`, a view without a copy (8 MB on every startup),
 * read-only: writing to the view would crash the process.
 */
export function createDefaultAssetAccess(): IAssetAccess {
    const seaBundle = tryLoadSeaBundle();
    if (seaBundle !== null) return new BundleAssetAccess(seaBundle);

    const dir = entryDir();
    const fileBundle = dir === null ? null : tryReadBundleFile(dir);
    if (fileBundle !== null) return new BundleAssetAccess(fileBundle);

    return createDevAssetAccess();
}

function tryLoadSeaBundle(): Uint8Array | null {
    try {
        const req = seaRequire();
        const sea = req("node:sea") as { isSea(): boolean; getRawAsset(key: string): ArrayBuffer };
        if (!sea.isSea()) return null;
        return new Uint8Array(sea.getRawAsset(SEA_BUNDLE_KEY));
    } catch {
        return null;
    }
}

export function createDevAssetAccess(): FsAssetAccess {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const repoRootDir = path.resolve(here, "..", "..", "..", "..", "..");
    const builtinDir = path.resolve(repoRootDir, "extensions");

    const require = createRequire(import.meta.url);
    const onigWasmPath = require.resolve("vscode-oniguruma/release/onig.wasm");

    return new FsAssetAccess({
        "Extensions/builtin/": builtinDir,
        "onig.wasm": onigWasmPath,
    });
}
