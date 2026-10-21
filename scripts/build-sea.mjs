#!/usr/bin/env node

import { execFileSync, execSync } from "node:child_process";
import { writeFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

import { buildDistArtifacts } from "./build-dist.mjs";
import { buildLazyChunkCodeCaches, SNAPSHOT_BUILD_FLAGS, SNAPSHOT_ENTRY, snapshotEntryEnv } from "./build-lazy-chunks.mjs";
import { smokeTestBinary, smokeTestNodeMode } from "./smoke-binary.mjs";

const root = resolve(import.meta.dirname, "..");
// `--dist-dir=<path>` — собрать не в рабочий `dist/` (e2e кладёт сборку в кэш по хешу исходников).
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

// Два прохода: V8 принимает кэш кода кусков, только если процесс восстановлен из
// снапшота того же `main.cjs` с теми же флагами, — кэш снимает бинарь первого прохода.
// Не в `<dist>/lazy/`: там его нашёл бы `node dist/main.cjs` под чужим node.
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
        // Верхний уровень модулей исполняется при сборке — правила в docs/arch/Common.md,
        // гейт — `npm run snapshot-check`.
        useSnapshot: true,
        disableExperimentalSEAWarning: true,
        assets: {
            "diode.bundle": bundlePath,
            "node-pty.bundle": nodePtyBundlePath,
            "rg.bundle": ripgrepBundlePath,
            "ts-server.bundle": tsServerBundlePath,
            // Ключ каталога распаковки без хэширования бандла на каждом старте.
            "ts-server.bundle.sha256": `${tsServerBundlePath}.sha256`,
            ...Object.fromEntries([...lazyChunks, ...lazyChunkCaches].map(({ asset, path }) => [asset, path])),
        },
    };

    const configPath = join(dist, "sea-config.json");
    writeFileSync(configPath, JSON.stringify(seaConfig, null, 2));
    console.log(`SEA config written to ${configPath}`);

    // Тот же node, что в ключе кэша e2e-сборок; флаги одинаковы в обоих проходах,
    // иначе бинарь отвергнет кэш кусков.
    console.log(`> node ${SNAPSHOT_BUILD_FLAGS.join(" ")} --build-sea ${configPath}`);
    execFileSync(process.execPath, [...SNAPSHOT_BUILD_FLAGS, "--build-sea", configPath], {
        stdio: "inherit",
        cwd: root,
        env: { ...process.env, ...snapshotEntryEnv(mainJsPath) },
    });

    const binStats = statSync(outputPath);
    console.error(`[build-sea] Binary: ${outputPath} (${(binStats.size / 1024 / 1024).toFixed(1)} MB)`);

    // Подпись macOS: без неё SEA не запустится, в том числе бинарь первого прохода.
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

        // Quarantine bit ставит macOS на части CI-окружений.
        try {
            execSync(`xattr -d com.apple.quarantine "${outputPath}"`, { stdio: "pipe" });
        } catch {
            // No quarantine attribute — that is fine.
        }

        // postject оставляет битую подпись.
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

// Намеренно ВНЕ `if (isMac)`: проверка только под macOS пропустила segfault в релиз (#143).
const version = smokeTestBinary(outputPath, { cwd: root });
smokeTestNodeMode(outputPath);
console.log("Smoke: node mode (DIODE_RUN_AS_NODE) OK");
console.error(`[build-sea] Smoke: ${outputPath} --version → ${version}`);

console.log(`\nDone! Binary: ${outputPath}`);
