#!/usr/bin/env node
/**
 * Упаковка бинаря ripgrep (`rg`) в ассет `rg.bundle` для SEA-сборки.
 *
 * Исполняемый файл нельзя запустить из вшитого в SEA JS-blob — нужен файл на
 * диске. Поэтому пакуем один бинарь `rg` в тот же bundle-формат, что и
 * `vexx.bundle`/`node-pty.bundle` (см. pack-assets.mjs), а на первом запуске
 * `loadRipgrep.ts` распаковывает ассет в `os.tmpdir()` и запускает оттуда.
 *
 * Бинарь берём из @vscode/ripgrep: сам пакет — тонкий резолвер, реальный `rg`
 * лежит в пер-платформенном optional-dependency `@vscode/ripgrep-<platform>-<arch>`
 * (та же логика, что в его lib/index.js). SEA пер-платформенный по природе —
 * бандл собирается на своей ОС, поэтому берём бинарь под текущую платформу.
 *
 * Виртуальное имя внутри бандла (`rg` / `rg.exe`) обязано совпадать с
 * `RG_BINARY_NAME` в `src/vs/workbench/services/search/node/loadRipgrep.ts`.
 *
 * Верифицирован linux-x64; на macOS/Windows бинарь пакуется, но end-to-end не
 * проверен — доведёт отдельная задача, как и у node-pty.
 */

import { readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

import { packBundle } from "./pack-assets.mjs";

/**
 * Собирает `rg.bundle` из бинаря ripgrep под текущую платформу.
 *
 * @param {{ repoRoot: string }} params
 * @returns {{ bundle: Buffer, binaryName: string, rgBinaryPath: string }}
 */
export function buildRipgrepBundle({ repoRoot }) {
    // Резолвим относительно repoRoot, чтобы бинарь брался из node_modules сборки.
    const requireFromRoot = createRequire(join(repoRoot, "package.json"));
    const binaryName = process.platform === "win32" ? "rg.exe" : "rg";
    const platformPkg = `@vscode/ripgrep-${process.platform}-${process.arch}`;

    let rgBinaryPath;
    try {
        rgBinaryPath = requireFromRoot.resolve(`${platformPkg}/bin/${binaryName}`);
    } catch {
        throw new Error(
            `[pack-ripgrep] бинарь ripgrep не найден (${platformPkg}/bin/${binaryName}) — ` +
                `установите optionalDependencies для текущей платформы (${process.platform}-${process.arch})`,
        );
    }

    const bundle = packBundle([{ virtualPath: binaryName, data: readFileSync(rgBinaryPath) }]);
    return { bundle, binaryName, rgBinaryPath };
}

// Прямой запуск: `node scripts/pack-ripgrep.mjs` → dist/rg.bundle.
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
