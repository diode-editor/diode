#!/usr/bin/env node
/**
 * Упаковка бинаря ripgrep (`rg`) в ассет `rg.bundle` для SEA-сборки: исполняемый
 * файл из SEA-blob не запустить, `loadRipgrep.ts` распаковывает его на диск.
 *
 * Бинарь — из `@vscode/ripgrep-<platform>-<arch>` текущей платформы (SEA собирается
 * на своей ОС). Виртуальное имя (`rg` / `rg.exe`) обязано совпадать с
 * `RG_BINARY_NAME` в `src/vs/workbench/services/search/node/loadRipgrep.ts`.
 *
 * Верифицирован linux-x64; macOS/Windows end-to-end не проверены.
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
            `[pack-ripgrep] бинарь ripgrep не найден (${platformPkg}/bin/${binaryName}) — ` +
                `установите optionalDependencies для текущей платформы (${process.platform}-${process.arch})`,
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
