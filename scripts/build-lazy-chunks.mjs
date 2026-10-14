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
 *  - {@link buildLazyChunkCodeCaches} снимает кэш кода V8 для каждого куска
 *    (только для SEA: тот же node и вшивается, иначе кэш отвергнут).
 *
 * Новая часть распила — запись в {@link LAZY_CHUNKS} плюс `loadLazyModule` (node) или `importLazyModule` (common) на
 * её шве; остальное (external, сборка, ассеты SEA, payload self-extract,
 * гейт) подхватывается из списка. Рецепт — docs/arch/Common.md («Ленивые куски»).
 */

import { execFileSync } from "node:child_process";
import { builtinModules, createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import * as vm from "node:vm";

/**
 * Список ленивых кусков. Растёт с каждой частью этапа 1 (docs/TODO/OpenPerformance.md).
 *
 * `warmup` — что сделать с модулем при снятии кэша кода ({@link buildLazyChunkCodeCaches}):
 * V8 кладёт в кэш только уже скомпилированные функции, а компилирует их лениво,
 * при первом вызове. Без прогрева в кэш попадает исполнение модуля, с прогревом —
 * и первый путь фичи. Функция уезжает в дочерний node исходником (`String(fn)`),
 * поэтому замыканий у неё быть не должно.
 *
 * @type {ReadonlyArray<{ id: string, reason: string, warmup?: (module: any) => unknown }>}
 */
export const LAZY_CHUNKS = [
    // Пилот распила: листовая CJS-библиотека без нашего кода, нужна только
    // установке и чтению .vsix (extensionInstaller.ts).
    { id: "yauzl", reason: "установка .vsix" },
    // Первый кусок, который зовёт common-код (разбор реестра, совместимость
    // engines): через importLazyModule из base/common/lazyModule.ts.
    { id: "semver", reason: "магазин расширений: версии реестра и engines" },
    // VT-эмулятор встроенного терминала: грузится при создании первой сессии
    // (XtermSurface), вывод до готовности копится в очереди поверхности.
    {
        id: "@xterm/headless",
        reason: "встроенный терминал: VT-эмулятор",
        // Первый терминал: эмулятор, вывод с цветом и переводом строки — как XtermSurface.
        warmup: async (xterm) => {
            const term = new xterm.Terminal({ cols: 80, rows: 24, allowProposedApi: true, scrollback: 1000 });
            await new Promise((resolve) => term.write("diode \u001b[32mwarmup\u001b[0m\r\n$ ", resolve));
            term.dispose();
        },
    },
    // Кодировки кроме utf-8 и UTF-16 (те — нативно, encoding.ts): грузится на
    // первом Reopen/Save with Encoding в такой кодировке, а не при открытии файла.
    {
        id: "iconv-lite",
        reason: "кодировки кроме utf-8 и UTF-16",
        // Однобайтная кодировка туда и обратно — как encoding.ts на reopen и save.
        warmup: (iconv) => {
            const bytes = iconv.encode("Привет, мир!\n", "windows1251", { addBOM: false });
            iconv.decode(bytes, "windows1251", { stripBOM: false });
        },
    },
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
 * Имя ассета кэша кода куска. Та же формула — в `lazyChunkCacheAssetName`
 * (`src/vs/base/node/lazyModule.ts`).
 *
 * @param {string} id
 */
export function lazyChunkCacheAssetName(id) {
    return `lazy/${id}.v8cache`;
}

/**
 * CJS-обёртка куска — байт в байт как `LAZY_CHUNK_WRAPPER` в
 * `src/vs/base/node/lazyModule.ts`: кэш V8 привязан к исходнику целиком.
 */
export const LAZY_CHUNK_WRAPPER = {
    prefix: "(function (exports, require, module, __filename, __dirname) {",
    suffix: "\n})",
};

/**
 * Кэш кода V8 для куска — в ЭТОМ процессе (его V8 и флагах). Кусок исполняется
 * и прогревается (`warmup`): V8 компилирует функции лениво, при первом вызове,
 * а в кэш кладёт только уже скомпилированные. Кэш одной компиляции на xterm почти
 * пуст (10 КБ, 36 → 31 мс), после исполнения — 183 КБ и 20 мс, после прогрева
 * первым терминалом — 294 КБ и 11 мс (замер — docs/TODO/OpenPerformance.md).
 *
 * Звать в чистом процессе: V8 делит скомпилированные функции между скриптами
 * одного исходника, и кэш вобрал бы чужой прогрев.
 *
 * @param {string} code исходник куска
 * @param {string} assetName `lazy/<id>.cjs` — имя файла скрипта, как у загрузчика
 * @param {((module: any) => unknown) | undefined} warmup
 * @returns {Promise<Buffer>}
 */
export async function createLazyChunkCodeCache(code, assetName, warmup) {
    const filename = `diode:${assetName}`;
    const script = new vm.Script(LAZY_CHUNK_WRAPPER.prefix + code + LAZY_CHUNK_WRAPPER.suffix, { filename });
    const module = { exports: {} };
    script.runInThisContext()(module.exports, createRequire(process.execPath), module, filename, dirname(filename));
    await warmup?.(module.exports);
    return script.createCachedData();
}

/**
 * Снимает кэш кода каждого куска в `<outDir>/<lazy/<id>.v8cache>` дочерним
 * процессом `nodeBinary` — без флагов и без `NODE_OPTIONS`: V8 принимает кэш,
 * только если версия и флаги совпали с теми, что будут в рантайме. Поэтому кэш
 * едет только в SEA (вшивается тот же `process.execPath`, что собирает), а не в
 * self-extract (свой node) и не файлом рядом с `main.js` (его запускает любой node).
 *
 * @param {{ chunks: ReadonlyArray<{ id: string, asset: string, path: string }>, outDir: string, nodeBinary: string }} params
 * @returns {Array<{ asset: string, path: string }>}
 */
export function buildLazyChunkCodeCaches({ chunks, outDir, nodeBinary }) {
    const warmups = new Map(LAZY_CHUNKS.map(({ id, warmup }) => [id, warmup]));
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    return chunks.map(({ id, asset, path }) => {
        const cacheAsset = lazyChunkCacheAssetName(id);
        const out = join(outDir, cacheAsset);
        mkdirSync(dirname(out), { recursive: true });
        const warmup = warmups.get(id);
        const args = [import.meta.filename, "--code-cache", path, asset, out, ...(warmup ? [String(warmup)] : [])];
        execFileSync(nodeBinary, args, { env, stdio: "inherit" });
        return { asset: cacheAsset, path: out };
    });
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
                    errors.push(`${id}: ${basename(file)} импортирует кусок статически (${imp.kind}) — только через loadLazyModule / importLazyModule`);
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

// `node build-lazy-chunks.mjs --code-cache <кусок> <имя ассета> <выход> [прогрев]` —
// дочерний процесс buildLazyChunkCodeCaches: кэш снимается V8 того node, что его
// запустил. Прогрев — исходник функции из LAZY_CHUNKS.
if (process.argv[1] === import.meta.filename && process.argv[2] === "--code-cache") {
    const [chunkPath, assetName, out, warmupSource] = process.argv.slice(3);
    // eslint-disable-next-line no-eval -- исходник прогрева из LAZY_CHUNKS этого же файла
    const warmup = warmupSource === undefined ? undefined : (0, eval)(`(${warmupSource})`);
    writeFileSync(out, await createLazyChunkCodeCache(readFileSync(chunkPath, "utf8"), assetName, warmup));
    // Прогрев мог оставить таймеры куска — процесс своё дело сделал.
    process.exit(0);
}
