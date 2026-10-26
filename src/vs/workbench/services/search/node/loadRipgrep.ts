// rg lives in an "app root" with the VS Code layout (`node_modules/@vscode/ripgrep/bin/rg`): extensions
// (Todo Tree) look for it under `vscode.env.appRoot`. Diode has no install directory (SEA binary), so the
// app root is a directory in the user cache, keyed by the binary's content. The build unpacks the
// `rg.bundle` asset there (an executable cannot run from a JS blob); dev links the binary of @vscode/ripgrep.

import { copyFileSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { extractBundleToCacheSync, populateCacheDirSync } from "../../../../base/node/assets/extractBundleToCache.ts";
import { packagedAssetCacheDir, readPackagedAsset } from "../../../../base/node/assets/packagedAsset.ts";

const ASSET_NAME = "rg.bundle";

/** Where VS Code keeps rg inside its app root; `scripts/pack-ripgrep.mjs` packs the binary at this path. */
export const RIPGREP_APP_ROOT_DIR = "node_modules/@vscode/ripgrep/bin";

export interface IRipgrepLayout {
    /** `""` when the layout could not be created (unwritable cache): upstream's value without an app root. */
    readonly appRoot: string;
    readonly rgPath: string;
}

let cached: IRipgrepLayout | null = null;

/**
 * Test seam for e2e and `drive`: a fake rg stands in for a search hung on a slow file system.
 * Read on every call, not at module level (the binary starts from a V8 snapshot). Only the core's
 * rg is replaced: `appRoot` keeps the real layout.
 */
export const RIPGREP_PATH_ENV = "DIODE_RIPGREP_PATH";

export function loadRipgrepPath(env: NodeJS.ProcessEnv = process.env): string {
    const override = env[RIPGREP_PATH_ENV];
    if (override !== undefined && override !== "") return override;
    return loadRipgrepLayout().rgPath;
}

/** `vscode.env.appRoot`: the directory exists once this returns, extensions check it in `activate()`. */
export function loadRipgrepAppRoot(layout: () => IRipgrepLayout = loadRipgrepLayout): string {
    try {
        return layout().appRoot;
    } catch {
        return "";
    }
}

function loadRipgrepLayout(): IRipgrepLayout {
    // Stryker disable next-line AssignmentOperator: without the cache the layout is the same — only the saved asset re-read is lost
    cached ??= resolveRipgrepLayout();
    return cached;
}

/**
 * `bundle === null` means dev (@vscode/ripgrep). A build whose layout cannot be unpacked throws, as before:
 * there is no other rg. In dev the binary from node_modules still works, only `appRoot` is lost.
 */
export function resolveRipgrepLayout(
    bundle: Uint8Array | null = readPackagedAsset(ASSET_NAME),
    cacheRoot?: string,
    platform: NodeJS.Platform = process.platform,
    devRgPath: () => string = nodeModulesRgPath,
): IRipgrepLayout {
    const rgRelative = join(RIPGREP_APP_ROOT_DIR, platform === "win32" ? "rg.exe" : "rg");
    if (bundle !== null) {
        const appRoot = packagedAssetCacheDir("rg", bundle, cacheRoot);
        extractBundleToCacheSync(bundle, appRoot, { executable: () => true });
        return { appRoot, rgPath: join(appRoot, rgRelative) };
    }
    const source = devRgPath();
    try {
        // The source path is in the key too: a link into a removed checkout must not be reused by another.
        const key = Buffer.concat([readFileSync(source), Buffer.from(`\0${source}`)]);
        const appRoot = packagedAssetCacheDir("rg", key, cacheRoot);
        populateCacheDirSync(appRoot, (tmpDir) => {
            mkdirSync(join(tmpDir, RIPGREP_APP_ROOT_DIR), { recursive: true });
            // A symlink on Windows needs privileges.
            if (platform === "win32") copyFileSync(source, join(tmpDir, rgRelative));
            else symlinkSync(source, join(tmpDir, rgRelative));
        });
        return { appRoot, rgPath: join(appRoot, rgRelative) };
    } catch {
        return { appRoot: "", rgPath: source };
    }
}

/** @vscode/ripgrep resolves the binary of its platform package, not `node_modules/@vscode/ripgrep/bin/rg`. */
function nodeModulesRgPath(): string {
    const require = createRequire(import.meta.url);
    return (require("@vscode/ripgrep") as { rgPath: string }).rgPath;
}
