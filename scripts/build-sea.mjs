#!/usr/bin/env node

import { execFileSync, execSync } from "node:child_process";
import { writeFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

import { buildDistArtifacts } from "./build-dist.mjs";
import { buildLazyChunkCodeCaches, SNAPSHOT_BUILD_FLAGS } from "./build-lazy-chunks.mjs";
import { smokeTestBinary, smokeTestNodeMode } from "./smoke-binary.mjs";

const root = resolve(import.meta.dirname, "..");
// `--dist-dir=<path>` — собрать не в рабочий `dist/`, а в отдельный каталог (e2e
// кладёт сборку в кэш по хешу исходников, см. scripts/e2e-artifacts.mjs).
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

// 1. Собираем dist/main.cjs + dist/diode.bundle + dist/node-pty.bundle + dist/rg.bundle (общее с build-selfextract.mjs).
const { mainJsPath, bundlePath, nodePtyBundlePath, ripgrepBundlePath, tsServerBundlePath, lazyChunks } = await buildDistArtifacts({
    repoRoot: root,
    distDir: dist,
});

// 2–5. Бинарь собирается в два прохода. V8 принимает кэш кода ленивых кусков,
// только если процесс восстановлен из снапшота того же `main.cjs` с теми же
// флагами (node 26), поэтому кэш снимает сам бинарь первого прохода в режиме
// run-as-node, а второй проход вшивает его. Снапшот второго прохода собран из
// того же входа с `--predictable` — кэш он принимает (юнит в build-lazy-chunks.test.mjs).
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
        main: mainJsPath,
        output: outputPath,
        mainFormat: "commonjs",
        // V8-снапшот ядра: при сборке main.cjs исполняет только верхний уровень модулей
        // и регистрирует вход `setDeserializeMainFunction` (src/vs/diode/main.ts), а
        // бинарь на старте восстанавливает готовую кучу вместо парса и исполнения.
        // Правила верхнего уровня под снапшот — docs/arch/Common.md, гейт —
        // `npm run snapshot-check`.
        useSnapshot: true,
        disableExperimentalSEAWarning: true,
        assets: {
            "diode.bundle": bundlePath,
            // Нативный node-pty: loadNodePty.ts распаковывает этот ассет в tmpdir и
            // грузит через createRequire (нативный .node нельзя вшить в JS-blob).
            "node-pty.bundle": nodePtyBundlePath,
            // Бинарь ripgrep: loadRipgrep.ts распаковывает этот ассет в tmpdir и
            // запускает оттуда (исполняемый файл нельзя запустить из JS-blob).
            "rg.bundle": ripgrepBundlePath,
            // typescript-language-server + минимальный TypeScript: loadTsServer.ts
            // распаковывает в пользовательский кэш при первом использовании LSP.
            "ts-server.bundle": tsServerBundlePath,
            // Его SHA-256, посчитанный при сборке (build-dist.mjs): ключ каталога
            // распаковки без хэша бандла на каждом старте.
            "ts-server.bundle.sha256": `${tsServerBundlePath}.sha256`,
            // Ленивые куски бандла (`lazy/<id>.cjs`): lazyModule.ts компилирует ассет
            // при первом обращении к фиче (scripts/build-lazy-chunks.mjs).
            // Рядом — их кэш кода V8 (`lazy/<id>.v8cache`).
            ...Object.fromEntries([...lazyChunks, ...lazyChunkCaches].map(({ asset, path }) => [asset, path])),
        },
    };

    const configPath = join(dist, "sea-config.json");
    writeFileSync(configPath, JSON.stringify(seaConfig, null, 2));
    console.log(`SEA config written to ${configPath}`);

    // Тот же node, что собирает (он же — в ключе кэша e2e-сборок), и путь без шелла.
    // Флаги снапшота (`--predictable`) одинаковы в обоих проходах: иначе бинарь
    // отвергнет кэш кусков (buildLazyChunkCodeCaches).
    console.log(`> node ${SNAPSHOT_BUILD_FLAGS.join(" ")} --build-sea ${configPath}`);
    execFileSync(process.execPath, [...SNAPSHOT_BUILD_FLAGS, "--build-sea", configPath], {
        stdio: "inherit",
        cwd: root,
    });

    const binStats = statSync(outputPath);
    console.error(`[build-sea] Binary: ${outputPath} (${(binStats.size / 1024 / 1024).toFixed(1)} MB)`);

    // Подпись macOS: без неё SEA не запустится, в том числе бинарь первого прохода.
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
}

// 6. Самотест: бинарь обязан реально стартовать. Намеренно ВНЕ `if (isMac)` —
// раньше проверка была только под macOS, смотрела лишь на `error` и запускала
// бинарь без аргументов, из-за чего segfault уехал в релиз (#143).
const version = smokeTestBinary(outputPath, { cwd: root });
smokeTestNodeMode(outputPath);
console.log("Smoke: node mode (DIODE_RUN_AS_NODE) OK");
console.error(`[build-sea] Smoke: ${outputPath} --version → ${version}`);

console.log(`\nDone! Binary: ${outputPath}`);
