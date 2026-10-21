#!/usr/bin/env node
/**
 * Packs the ripgrep binary (`rg`) into the `rg.bundle` asset for the SEA build: an executable
 * cannot run from the SEA blob, so `loadRipgrep.ts` unpacks it to disk.
 *
 * The binary comes from `@vscode/ripgrep-<platform>-<arch>` of the current platform (SEA is
 * built on its own OS). The virtual name (`rg` / `rg.exe`) must match
 * `RG_BINARY_NAME` in `src/vs/workbench/services/search/node/loadRipgrep.ts`.
 *
 * Verified on linux-x64; macOS/Windows are not verified end to end.
 */

import { readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

import { packBundle } from "./pack-assets.mjs";

/**
 * @param {{ repoRoot: string }} params
 * @returns {{ bundle: Buffer, binaryName: string, rgBinaryPath: string }}
 */
export function buildRipgrepBundle({ repoRoot }) {
    const requireFromRoot = createRequire(join(repoRoot, "package.json"));
    const binaryName = process.platform === "win32" ? "rg.exe" : "rg";
    const platformPkg = `@vscode/ripgrep-${process.platform}-${process.arch}`;

    let rgBinaryPath;
    try {
        rgBinaryPath = requireFromRoot.resolve(`${platformPkg}/bin/${binaryName}`);
    } catch {
        throw new Error(
            `[pack-ripgrep] ripgrep binary not found (${platformPkg}/bin/${binaryName}); ` +
                `install optionalDependencies for the current platform (${process.platform}-${process.arch})`,
        );
    }

    const bundle = packBundle([{ virtualPath: binaryName, data: readFileSync(rgBinaryPath) }]);
    return { bundle, binaryName, rgBinaryPath };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const repoRoot = resolve(import.meta.dirname, "..");
    const dist = resolve(repoRoot, "dist");
    const { bundle, binaryName, rgBinaryPath } = buildRipgrepBundle({ repoRoot });
    const outPath = join(dist, "rg.bundle");
    writeFileSync(outPath, bundle);
    const rgStat = statSync(rgBinaryPath);
    console.error(
        `[pack-ripgrep] ${outPath} (${(bundle.length / 1024 / 1024).toFixed(1)} MB; ${binaryName}=${(
            rgStat.size /
            1024 /
            1024
        ).toFixed(1)} MB; from ${rgBinaryPath})`,
    );
}
