#!/usr/bin/env node

import { execSync } from "node:child_process";
import { writeFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

import { buildDistArtifacts } from "./build-dist.mjs";
import { smokeTestBinary } from "./smoke-binary.mjs";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "dist");
const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const exeName = isWindows ? "vexx.exe" : "vexx";
const outputPath = join(dist, exeName);

function run(cmd) {
    console.log(`> ${cmd}`);
    execSync(cmd, { stdio: "inherit", cwd: root });
}

// 1. Собираем dist/main.js + dist/vexx.bundle + dist/node-pty.bundle + dist/rg.bundle (общее с build-selfextract.mjs).
const { mainJsPath, bundlePath, nodePtyBundlePath, ripgrepBundlePath } = await buildDistArtifacts({ repoRoot: root });

// 2. Generate SEA config
const seaConfig = {
    main: mainJsPath,
    output: outputPath,
    mainFormat: "module",
    disableExperimentalSEAWarning: true,
    assets: {
        "vexx.bundle": bundlePath,
        // Нативный node-pty: loadNodePty.ts распаковывает этот ассет в tmpdir и
        // грузит через createRequire (нативный .node нельзя вшить в JS-blob).
        "node-pty.bundle": nodePtyBundlePath,
        // Бинарь ripgrep: loadRipgrep.ts распаковывает этот ассет в tmpdir и
        // запускает оттуда (исполняемый файл нельзя запустить из JS-blob).
        "rg.bundle": ripgrepBundlePath,
    },
};

const configPath = join(dist, "sea-config.json");
writeFileSync(configPath, JSON.stringify(seaConfig, null, 2));
console.log(`SEA config written to ${configPath}`);

// 3. Build SEA binary
run(`node --build-sea ${configPath}`);

// 4. Verify the output is a proper binary (not just a blob)
const binStats = statSync(outputPath);
console.error(`[build-sea] Binary: ${outputPath} (${(binStats.size / 1024 / 1024).toFixed(1)} MB)`);

// 5. Sign on macOS (required for SEA to run)
if (isMac) {
    run(`chmod +x ${outputPath}`);

    // Show binary type for diagnostics
    try {
        const fileInfo = execSync(`file "${outputPath}"`, { encoding: "utf8", stdio: "pipe" }).trim();
        console.error(`[build-sea] file: ${fileInfo}`);
    } catch {}
    try {
        const lipoInfo = execSync(`lipo -info "${outputPath}" 2>&1`, { encoding: "utf8", stdio: "pipe" }).trim();
        console.error(`[build-sea] lipo: ${lipoInfo}`);
    } catch {}

    // Remove quarantine bit (set by macOS on some CI environments)
    try {
        execSync(`xattr -d com.apple.quarantine "${outputPath}"`, { stdio: "pipe" });
    } catch {
        // No quarantine attribute — that is fine.
    }

    // Remove any existing (potentially broken) signature left by postject before re-signing.
    try {
        execSync(`codesign --remove-signature "${outputPath}"`, { stdio: "pipe", cwd: root });
        console.error("[build-sea] Removed existing signature");
    } catch {
        // Binary may not have a signature yet — that is fine.
    }
    run(`codesign --sign - --force "${outputPath}"`);

    // Verify the new signature
    try {
        execSync(`codesign --verify --verbose "${outputPath}"`, { stdio: "inherit", cwd: root });
        console.error("[build-sea] Signature verified OK");
    } catch (e) {
        throw new Error(`[build-sea] Signature verification FAILED: ${String(e)}`);
    }
}

// 6. Самотест: бинарь обязан реально стартовать. Намеренно ВНЕ `if (isMac)` —
// раньше проверка была только под macOS, смотрела лишь на `error` и запускала
// бинарь без аргументов, из-за чего segfault уехал в релиз (#143).
const version = smokeTestBinary(outputPath, { cwd: root });
console.error(`[build-sea] Smoke: ${outputPath} --version → ${version}`);

console.log(`\nDone! Binary: ${outputPath}`);
