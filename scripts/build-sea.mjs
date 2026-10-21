#!/usr/bin/env node

import { execFileSync, execSync } from "node:child_process";
import { writeFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

import { buildDistArtifacts } from "./build-dist.mjs";
import { buildLazyChunkCodeCaches, SNAPSHOT_BUILD_FLAGS, SNAPSHOT_ENTRY, snapshotEntryEnv } from "./build-lazy-chunks.mjs";
import { smokeTestBinary, smokeTestNodeMode } from "./smoke-binary.mjs";

const root = resolve(import.meta.dirname, "..");
// `--dist-dir=<path>` builds outside the working `dist/` (e2e puts the build into a cache keyed by source hash).
const dist = resolve(root, parseDistDir(process.argv.slice(2)) ?? "dist");
const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const exeName = isWindows ? "diode.exe" : "diode";
const outputPath = join(dist, exeName);

/** @param {string[]} argv */
function parseDistDir(argv) {
    let distDir;
    for (const arg of argv) {
        const match = /^--dist-dir=(.+)$/.exec(arg);
        if (!match) throw new Error(`[build-sea] Unknown argument: ${arg}`);
        distDir = match[1];
    }
    return distDir;
}

function run(cmd) {
    console.log(`> ${cmd}`);
    execSync(cmd, { stdio: "inherit", cwd: root });
}

const { mainJsPath, bundlePath, nodePtyBundlePath, ripgrepBundlePath, tsServerBundlePath, lazyChunks } = await buildDistArtifacts({
    repoRoot: root,
    distDir: dist,
});

// Two passes: V8 accepts the chunk code cache only if the process is restored from a
// snapshot of the same `main.cjs` with the same flags, so the first-pass binary takes the cache.
// Not in `<dist>/lazy/`: `node dist/main.cjs` would find it there under a different node.
buildBinary([]);
const lazyChunkCaches = buildLazyChunkCodeCaches({
    chunks: lazyChunks,
    outDir: join(dist, "sea-cache"),
    command: [outputPath],
});
buildBinary(lazyChunkCaches);

/** @param {ReadonlyArray<{ asset: string, path: string }>} lazyChunkCaches */
function buildBinary(lazyChunkCaches) {
    const seaConfig = {
        main: SNAPSHOT_ENTRY,
        output: outputPath,
        mainFormat: "commonjs",
        // The module top level runs at build time: rules in docs/arch/Common.md,
        // the gate is `npm run snapshot-check`.
        useSnapshot: true,
        disableExperimentalSEAWarning: true,
        assets: {
            "diode.bundle": bundlePath,
            "node-pty.bundle": nodePtyBundlePath,
            "rg.bundle": ripgrepBundlePath,
            "ts-server.bundle": tsServerBundlePath,
            // Unpack directory key without hashing the bundle on every start.
            "ts-server.bundle.sha256": `${tsServerBundlePath}.sha256`,
            ...Object.fromEntries([...lazyChunks, ...lazyChunkCaches].map(({ asset, path }) => [asset, path])),
        },
    };

    const configPath = join(dist, "sea-config.json");
    writeFileSync(configPath, JSON.stringify(seaConfig, null, 2));
    console.log(`SEA config written to ${configPath}`);

    // The same node as in the e2e build cache key; flags are identical in both passes,
    // otherwise the binary rejects the chunk cache.
    console.log(`> node ${SNAPSHOT_BUILD_FLAGS.join(" ")} --build-sea ${configPath}`);
    execFileSync(process.execPath, [...SNAPSHOT_BUILD_FLAGS, "--build-sea", configPath], {
        stdio: "inherit",
        cwd: root,
        env: { ...process.env, ...snapshotEntryEnv(mainJsPath) },
    });

    const binStats = statSync(outputPath);
    console.error(`[build-sea] Binary: ${outputPath} (${(binStats.size / 1024 / 1024).toFixed(1)} MB)`);

    // macOS signing: without it SEA does not start, the first-pass binary included.
    if (isMac) {
        run(`chmod +x ${outputPath}`);

        try {
            const fileInfo = execSync(`file "${outputPath}"`, { encoding: "utf8", stdio: "pipe" }).trim();
            console.error(`[build-sea] file: ${fileInfo}`);
        } catch {}
        try {
            const lipoInfo = execSync(`lipo -info "${outputPath}" 2>&1`, { encoding: "utf8", stdio: "pipe" }).trim();
            console.error(`[build-sea] lipo: ${lipoInfo}`);
        } catch {}

        // macOS sets the quarantine bit on some CI environments.
        try {
            execSync(`xattr -d com.apple.quarantine "${outputPath}"`, { stdio: "pipe" });
        } catch {
            // No quarantine attribute — that is fine.
        }

        // postject leaves a broken signature.
        try {
            execSync(`codesign --remove-signature "${outputPath}"`, { stdio: "pipe", cwd: root });
            console.error("[build-sea] Removed existing signature");
        } catch {
            // Binary may not have a signature yet — that is fine.
        }
        run(`codesign --sign - --force "${outputPath}"`);

        try {
            execSync(`codesign --verify --verbose "${outputPath}"`, { stdio: "inherit", cwd: root });
            console.error("[build-sea] Signature verified OK");
        } catch (e) {
            throw new Error(`[build-sea] Signature verification FAILED: ${String(e)}`);
        }
    }
}

// Deliberately OUTSIDE `if (isMac)`: a macOS-only check let a segfault into a release (#143).
const version = smokeTestBinary(outputPath, { cwd: root });
smokeTestNodeMode(outputPath);
console.log("Smoke: node mode (DIODE_RUN_AS_NODE) OK");
console.error(`[build-sea] Smoke: ${outputPath} --version → ${version}`);

console.log(`\nDone! Binary: ${outputPath}`);
