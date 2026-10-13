/**
 * Ленивые куски бандла («распил»): зависимости, которые не нужны до первого
 * кадра, не лежат в `dist/main.js`, а собираются отдельными CJS-файлами
 * `lazy/<id>.cjs`. SEA вшивает их ассетами, self-extract и `node dist/main.js`
 * берут файлом рядом с `main.js`. Грузит их `loadLazyModule`
 * (`src/vs/base/node/lazyModule.ts`) при первом обращении к фиче.
 *
 * Как это держится:
 *  - `tsup.config.ts` объявляет каждый `id` из {@link LAZY_CHUNKS} внешним:
 *    в `main.js` остаётся голый `import("<id>")` — запасной путь dev-сборки,
 *    в упакованной сборке до него не доходит (загрузчик находит кусок раньше);
 *  - {@link buildLazyChunks} собирает куски esbuild'ом (CJS, platform node);
 *  - {@link verifyLazyChunks} — храповик на граф первого кадра: ни один модуль
 *    куска не попал в `main.js`, `main.js` не импортирует кусок статически,
 *    кусок не тянет ничего, кроме встроенных модулей node. Его зовёт сборка
 *    (`build-dist.mjs`) и CI (`scripts/check-lazy-chunks.mjs`, job `static`).
 *
 * Новая часть распила — запись в {@link LAZY_CHUNKS} плюс `loadLazyModule` на
 * её шве; остальное (external, сборка, ассеты SEA, payload self-extract,
 * гейт) подхватывается из списка. Рецепт — docs/arch/Common.md («Ленивые куски»).
 */

import { builtinModules } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * Список ленивых кусков. Растёт с каждой частью этапа 1 (docs/TODO/OpenPerformance.md).
 *
 * @type {ReadonlyArray<{ id: string, reason: string }>}
 */
export const LAZY_CHUNKS = [
    // Пилот распила: листовая CJS-библиотека без нашего кода, нужна только
    // установке и чтению .vsix (extensionInstaller.ts).
    { id: "yauzl", reason: "установка .vsix" },
];

/**
 * Имя ассета куска: ключ SEA-ассета и путь файла относительно `main.js`.
 * Та же формула — в `lazyChunkAssetName` (`src/vs/base/node/lazyModule.ts`).
 *
 * @param {string} id
 */
export function lazyChunkAssetName(id) {
    return `lazy/${id}.cjs`;
}

/**
 * Собирает куски в `<distDir>/lazy/<id>.cjs`.
 *
 * @param {{ repoRoot: string, distDir: string, write?: boolean }} params
 *   `write: false` — только собрать (гейт без сборки бинаря).
 * @returns {Promise<Array<{ id: string, asset: string, path: string, metafile: import("esbuild").Metafile }>>}
 */
export async function buildLazyChunks({ repoRoot, distDir, write = true }) {
    const esbuild = await import("esbuild");
    const chunks = [];
    for (const { id } of LAZY_CHUNKS) {
        const asset = lazyChunkAssetName(id);
        const outfile = join(distDir, asset);
        const result = await esbuild.build({
            stdin: { contents: `module.exports = require(${JSON.stringify(id)});`, resolveDir: repoRoot, loader: "js" },
            bundle: true,
            platform: "node",
            format: "cjs",
            target: "es2024",
            outfile,
            metafile: true,
            write: false,
            absWorkingDir: repoRoot,
            logLevel: "warning",
        });
        if (write) {
            for (const file of result.outputFiles) {
                mkdirSync(dirname(file.path), { recursive: true });
                writeFileSync(file.path, file.contents);
            }
        }
        chunks.push({ id, asset, path: outfile, metafile: result.metafile });
    }
    return chunks;
}

const BUILTINS = new Set(builtinModules);

/** @param {string} path */
function isBuiltin(path) {
    return path.startsWith("node:") || BUILTINS.has(path);
}

/**
 * Храповик на граф первого кадра. Пустой массив — всё чисто.
 *
 * @param {{ mainMetafile: import("esbuild").Metafile, chunks: ReadonlyArray<{ id: string, metafile: import("esbuild").Metafile }> }} params
 * @returns {string[]} нарушения, по строке на каждое
 */
export function verifyLazyChunks({ mainMetafile, chunks }) {
    const errors = [];
    const mainOutputs = Object.entries(mainMetafile.outputs).filter(([file]) => file.endsWith(".js"));
    const mainInputs = new Set(mainOutputs.flatMap(([, output]) => Object.keys(output.inputs)));

    for (const { id, metafile } of chunks) {
        // 1. Модули куска не продублированы в ядре: пакет целиком уехал из main.js.
        // Ввод stdin-обёртки — не модуль пакета.
        for (const input of Object.keys(metafile.inputs)) {
            if (input !== "<stdin>" && mainInputs.has(input)) {
                errors.push(`${id}: модуль ${input} лежит и в куске, и в main.js — его тянет статический импорт ядра`);
            }
        }
        // 2. Ядро зовёт кусок только динамически (запасной путь loadLazyModule).
        for (const [file, output] of mainOutputs) {
            for (const imp of output.imports) {
                if (imp.path === id && imp.kind !== "dynamic-import") {
                    errors.push(`${id}: ${basename(file)} импортирует кусок статически (${imp.kind}) — только через loadLazyModule`);
                }
            }
        }
        // 3. Кусок самодостаточен: в рантайме у него есть только require встроенных модулей.
        for (const output of Object.values(metafile.outputs)) {
            for (const imp of output.imports) {
                if (imp.external && !isBuiltin(imp.path)) {
                    errors.push(`${id}: кусок тянет внешний модуль ${imp.path} — в SEA его не будет`);
                }
            }
        }
    }
    return errors;
}
