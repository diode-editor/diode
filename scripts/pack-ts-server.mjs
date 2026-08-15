#!/usr/bin/env node
/**
 * Упаковка typescript-language-server + минимального TypeScript в ассет
 * `ts-server.bundle` — «батарейки вшиты»: LSP работает из коробки без
 * node_modules в проекте и без node в PATH (контекст — docs/TODO/LSP.md).
 *
 * Состав (фиксированные списки, никаких «взять всё»):
 *  - `typescript-language-server/lib/cli.mjs` — готовый однофайловый
 *    rollup-бандл самого сервера (ESM, рантайм-зависимостей нет) + package.json;
 *  - `node_modules/typescript/lib/*` — ровно то, что нужно tsserver'у в
 *    рантайме: шим tsserver.js + _tsserver.js + монолит typescript.js +
 *    typesMap.json + watchGuard.js (Windows-путь) + стандартные lib.*.d.ts.
 *    Выбрасываются: локали (~4.4 МБ), tsc (~6 МБ), tsserverlibrary, *.map,
 *    typingsInstaller (ATA выключен для bundled-пути — см. resolveServer.ts).
 *
 * Раскладка `node_modules/typescript/...` — намеренная: cli.mjs резолвит
 * bundled TypeScript через `require.resolve("typescript")` относительно себя,
 * так что распакованный кэш работает без initializationOptions.
 *
 * Виртуальные пути обязаны совпадать с константами в
 * `src/vs/workbench/services/extensions/node/loadTsServer.ts`.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

import { packBundle } from "./pack-assets.mjs";

/** Файлы typescript/lib, нужные tsserver'у в рантайме (кроме lib.*.d.ts — они по фильтру). */
const TYPESCRIPT_LIB_FILES = ["tsserver.js", "_tsserver.js", "typescript.js", "typesMap.json", "watchGuard.js"];

/**
 * CJS-шим запуска сервера под «diode как node» (SEA). Динамический `import()`
 * из вшитого SEA-main перехватывается embedder-хуком (умеет только builtin'ы),
 * а `require(esm)` не берёт cli.mjs из-за top-level await — но `import()` из
 * ВНЕШНЕГО CJS-файла идёт настоящим ESM-loader'ом (проверено на бинаре).
 * bundled serverPath указывает на этот шим.
 */
const RUN_CLI_CJS = `"use strict";
// diode: CJS-шим для SEA-режима — см. scripts/pack-ts-server.mjs.
const { pathToFileURL } = require("node:url");
const { join } = require("node:path");
import(pathToFileURL(join(__dirname, "cli.mjs")).href).catch((err) => {
    console.error(err);
    process.exit(1);
});
`;

/** Стандартные библиотеки компилятора: lib.d.ts / lib.<target>.d.ts. */
const TYPESCRIPT_STDLIB_RE = /^lib(\..+)?\.d\.ts$/;

/**
 * Собирает `ts-server.bundle` из node_modules сборки.
 *
 * @param {{ repoRoot: string }} params
 * @returns {{ bundle: Buffer, fileCount: number }}
 */
export function buildTsServerBundle({ repoRoot }) {
    const requireFromRoot = createRequire(join(repoRoot, "package.json"));

    const mustResolve = (spec) => {
        try {
            return requireFromRoot.resolve(spec);
        } catch {
            throw new Error(`[pack-ts-server] не найден "${spec}" — установите devDependencies (npm install)`);
        }
    };

    const cliPath = mustResolve("typescript-language-server/lib/cli.mjs");
    const tlsPackageJson = join(dirname(dirname(cliPath)), "package.json");
    const tsserverPath = mustResolve("typescript/lib/tsserver.js");
    const typescriptLibDir = dirname(tsserverPath);
    const typescriptPackageJson = join(dirname(typescriptLibDir), "package.json");

    /** @type {{ virtualPath: string, data: Buffer }[]} */
    const inputs = [
        { virtualPath: "typescript-language-server/lib/cli.mjs", data: readFileSync(cliPath) },
        { virtualPath: "typescript-language-server/lib/run-cli.cjs", data: Buffer.from(RUN_CLI_CJS, "utf8") },
        { virtualPath: "typescript-language-server/package.json", data: readFileSync(tlsPackageJson) },
        { virtualPath: "node_modules/typescript/package.json", data: readFileSync(typescriptPackageJson) },
    ];
    for (const file of TYPESCRIPT_LIB_FILES) {
        inputs.push({
            virtualPath: `node_modules/typescript/lib/${file}`,
            data: readFileSync(join(typescriptLibDir, file)),
        });
    }
    const stdlibs = readdirSync(typescriptLibDir).filter((name) => TYPESCRIPT_STDLIB_RE.test(name));
    if (stdlibs.length === 0) {
        throw new Error(`[pack-ts-server] в ${typescriptLibDir} не найдено ни одной lib.*.d.ts`);
    }
    for (const file of stdlibs.sort()) {
        inputs.push({
            virtualPath: `node_modules/typescript/lib/${file}`,
            data: readFileSync(join(typescriptLibDir, file)),
        });
    }

    return { bundle: packBundle(inputs), fileCount: inputs.length };
}

// Прямой запуск: `node scripts/pack-ts-server.mjs` → dist/ts-server.bundle.
if (import.meta.url === `file://${process.argv[1]}`) {
    const repoRoot = resolve(import.meta.dirname, "..");
    const { bundle, fileCount } = buildTsServerBundle({ repoRoot });
    const distDir = resolve(repoRoot, "dist");
    mkdirSync(distDir, { recursive: true });
    const outPath = join(distDir, "ts-server.bundle");
    writeFileSync(outPath, bundle);
    console.error(
        `[pack-ts-server] ${outPath} (${(bundle.length / 1024 / 1024).toFixed(1)} MB, ${String(fileCount)} files)`,
    );
}
