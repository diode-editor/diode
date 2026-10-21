#!/usr/bin/env node
/**
 * Runtime layout of `node-pty` -> the `node-pty.bundle` asset: `process.dlopen` needs a
 * file on disk, so `loadNodePty.ts` unpacks the asset into tmpdir on first launch and
 * does `require` from `<targetDir>/node-pty`, hence the `node-pty/` prefix on every entry.
 *
 * Verified end to end only on linux-x64/arm64; macOS/Windows are packed but not
 * verified (docs/TODO/IntegratedTerminal.md).
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, posix, relative, resolve, sep } from "node:path";

import { packBundle } from "./pack-assets.mjs";

function walkFiles(rootDir, filter) {
    /** @type {string[]} */
    const out = [];
    /** @param {string} dir */
    function walk(dir) {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile() && filter(full)) out.push(full);
        }
    }
    walk(rootDir);
    return out;
}

/**
 * @param {{ repoRoot: string }} params
 * @returns {{ bundle: Buffer, inputs: { virtualPath: string, data: Buffer }[], nodePtyRoot: string }}
 */
export function buildNodePtyBundle({ repoRoot }) {
    // From repoRoot, not the script: the bundle comes from the build's node_modules.
    const requireFromRoot = createRequire(join(repoRoot, "package.json"));
    const nodePtyRoot = requireFromRoot.resolve("node-pty/package.json").replace(/package\.json$/, "");

    /** @type {{ virtualPath: string, data: Buffer }[]} */
    const inputs = [];
    const addFile = (absPath) => {
        const rel = relative(nodePtyRoot, absPath).split(sep).join(posix.sep);
        inputs.push({ virtualPath: `node-pty/${rel}`, data: readFileSync(absPath) });
    };

    addFile(join(nodePtyRoot, "package.json"));

    const libFiles = walkFiles(
        join(nodePtyRoot, "lib"),
        (p) => p.endsWith(".js") && !p.endsWith(".test.js") && !p.endsWith(".js.map"),
    ).sort();
    for (const filePath of libFiles) addFile(filePath);

    // The same directories where node-pty itself looks for natives (lib/utils.js): Linux compiles
    // `build/Release` on install, macOS/Windows get `prebuilds/`. The layout is kept, so resolution
    // after unpacking is the same. .pdb files are Windows debug symbols (tens of MB).
    const nativeDirs = [
        join(nodePtyRoot, "build", "Release"),
        join(nodePtyRoot, "prebuilds", `${process.platform}-${process.arch}`),
    ];
    let nativeCount = 0;
    for (const dir of nativeDirs) {
        if (!existsSync(dir)) continue;
        for (const filePath of walkFiles(dir, (p) => !p.endsWith(".pdb")).sort()) {
            addFile(filePath);
            nativeCount++;
        }
    }
    if (nativeCount === 0) {
        throw new Error(
            `[pack-node-pty] node-pty natives not found (searched ${nativeDirs.join(", ")}); ` +
                `build node-pty for the current platform`,
        );
    }

    const bundle = packBundle(inputs);
    return { bundle, inputs, nodePtyRoot };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const repoRoot = resolve(import.meta.dirname, "..");
    const dist = resolve(repoRoot, "dist");
    const { bundle, inputs, nodePtyRoot } = buildNodePtyBundle({ repoRoot });
    const outPath = join(dist, "node-pty.bundle");
    writeFileSync(outPath, bundle);
    console.error(
        `[pack-node-pty] ${outPath} (${(bundle.length / 1024).toFixed(1)} KB, ${inputs.length} entries; from ${nodePtyRoot})`,
    );
}
