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
 * Два вида кусков:
 *  - пакет (`id` — имя пакета из node_modules): листовая библиотека без нашего
 *    кода, ни один её модуль не лежит в `main.js`;
 *  - наш код (`entry` — путь к модулю-входу): роль процесса (extension host,
 *    file watcher). Её граф делит с ядром общие модули (`base/common`, протокол
 *    RPC, `vscodeTypes`): кусок несёт их копией, ядро — своей. Гейт держит
 *    вход вне `main.js` и цену копии — `sharedBudgetKb`, см. {@link verifyLazyChunks}.
 *
 * Новая часть распила — запись в {@link LAZY_CHUNKS} плюс `loadLazyModule` (node) или `importLazyModule` (common) на
 * её шве; остальное (external, сборка, ассеты SEA, payload self-extract,
 * гейт) подхватывается из списка. Рецепт — docs/arch/Common.md («Ленивые куски»).
 */

import { execFileSync } from "node:child_process";
import { builtinModules, createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import * as vm from "node:vm";

import { resolveDiodeVersion } from "./resolve-version.mjs";

/**
 * Список ленивых кусков. Растёт с каждой частью этапа 1 (docs/TODO/OpenPerformance.md).
 *
 * `warmup` — что сделать с модулем при снятии кэша кода ({@link buildLazyChunkCodeCaches}):
 * V8 кладёт в кэш только уже скомпилированные функции, а компилирует их лениво,
 * при первом вызове. Без прогрева в кэш попадает исполнение модуля, с прогревом —
 * и первый путь фичи. Функция уезжает в дочерний node исходником (`String(fn)`),
 * поэтому замыканий у неё быть не должно.
 *
 * `entry` — кусок из нашего кода: путь модуля-входа от корня репозитория. Его
 * `import()` в ядре `tsup.config.ts` превращает в внешний `import("<id>")`
 * ({@link lazyEntryChunksPlugin}). `sharedBudgetKb` — сколько КБ общих с ядром
 * модулей кусок вправе нести копией (обязателен при `entry`, см. {@link verifyLazyChunks}).
 *
 * @type {ReadonlyArray<{ id: string, reason: string, warmup?: (module: any) => unknown, entry?: string, sharedBudgetKb?: number }>}
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
    // Роли процесса — наш код. Реализация vscode API (workbench/api) нужна только
    // extension host'у: редактор её не парсит, ext host грузит кусок, войдя в
    // свою ветку main.ts. Бюджет — замер плюс ~5 %: общее с ядром (143 КБ из
    // 371) — vscodeTypes, протокол RPC, vscode-uri, jsonc-parser, base/common.
    // Состав и цена — docs/TODO/OpenPerformance.md.
    {
        id: "roles/extension-host",
        reason: "роль extension host: реализация vscode API",
        entry: "src/vs/diode/roles/extensionHostRole.ts",
        sharedBudgetKb: 150,
    },
    // Watcher-процесс: своего кода — ~12 КБ (обход дерева, сервер протокола),
    // общее с ядром (63 КБ из 75) — chokidar: редактор держит его для подписок
    // на файлы настроек (ChokidarFileWatcher).
    {
        id: "roles/file-watcher",
        reason: "роль file watcher: обход дерева",
        entry: "src/vs/diode/roles/fileWatcherRole.ts",
        sharedBudgetKb: 66,
    },
];

/** Имена всех кусков: кусок вправе звать другой кусок `import()`'ом (ext host — iconv). */
const LAZY_CHUNK_IDS = new Set(LAZY_CHUNKS.map(({ id }) => id));

/**
 * Плагин esbuild для сборки ядра (`tsup.config.ts`): `import()` модуля-входа
 * куска из нашего кода становится внешним `import("<id>")`, как у кусков-пакетов.
 * Без него esbuild без code-splitting вклеил бы вход в `main.js` целиком.
 * Статический импорт входа плагин превращает так же — его ловит гейт
 * ({@link verifyLazyChunks}, правило 2), а не молчаливая вклейка.
 *
 * @param {string} repoRoot
 * @returns {import("esbuild").Plugin}
 */
export function lazyEntryChunksPlugin(repoRoot) {
    const byPath = new Map(LAZY_CHUNKS.filter((c) => c.entry !== undefined).map((c) => [resolve(repoRoot, c.entry), c.id]));
    const names = [...byPath.keys()].map((p) => basename(p).replace(/[.]/g, "\\."));
    return {
        name: "diode-lazy-entry-chunks",
        setup(build) {
            if (names.length === 0) return;
            build.onResolve({ filter: new RegExp(`(^|/)(${names.join("|")})$`) }, (args) => {
                const id = byPath.get(resolve(args.resolveDir, args.path));
                return id === undefined ? undefined : { path: id, external: true };
            });
        },
    };
}

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
    for (const { id, entry, sharedBudgetKb } of LAZY_CHUNKS) {
        const asset = lazyChunkAssetName(id);
        const outfile = join(distDir, asset);
        // Пакет — require по имени; наш код — по пути входа. Другие куски кусок
        // зовёт import()'ом через загрузчик, поэтому они ему внешние.
        const target = entry === undefined ? id : `./${entry}`;
        const result = await esbuild.build({
            stdin: { contents: `module.exports = require(${JSON.stringify(target)});`, resolveDir: repoRoot, loader: "js" },
            bundle: true,
            platform: "node",
            format: "cjs",
            target: "es2024",
            outfile,
            metafile: true,
            write: false,
            absWorkingDir: repoRoot,
            logLevel: "warning",
            ...(entry === undefined
                ? {}
                : {
                      external: [...LAZY_CHUNK_IDS].filter((other) => other !== id),
                      // Пакеты — той же сборкой, что в main.js (tsup собирает ESM: module раньше main).
                      // Иначе общий модуль в куске и в ядре — разные файлы, и гейт копию не видит;
                      // а UMD-сборка jsonc-parser в бандле ломается (require внутри фабрики).
                      mainFields: ["module", "main"],
                      // Та же версия, что tsup зашивает в main.js (tsup.config.ts). import.meta в
                      // CJS пуст, а читает его entryDir() (packagedRuntime.ts) — каталог main.js, где
                      // вне SEA лежат ассеты и куски. Процесс роли запущен как `node <main.js>`
                      // (selfSpawnArgs), поэтому main.js — его главный скрипт, process.argv[1].
                      define: {
                          __DIODE_VERSION__: JSON.stringify(resolveDiodeVersion()),
                          "import.meta.url": "__diode_main_url",
                      },
                      banner: {
                          js: 'var __diode_main_url = require("node:url").pathToFileURL(process.argv[1] ?? "").href;',
                      },
                  }),
        });
        if (write) {
            for (const file of result.outputFiles) {
                mkdirSync(dirname(file.path), { recursive: true });
                writeFileSync(file.path, file.contents);
            }
        }
        chunks.push({ id, asset, path: outfile, metafile: result.metafile, entry, sharedBudgetKb });
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
 * Кусок-пакет: ни один его модуль не лежит в `main.js`. Кусок из нашего кода
 * (`entry`) делит с ядром общие модули, и запретить пересечение нельзя, поэтому
 * правило другое: вход куска не лежит в `main.js` (иначе ядро тянет роль
 * статически и кусок бесполезен), а общие модули кусок несёт копией не больше
 * `sharedBudgetKb`. Копия — цена в процессе роли (лишний парс) и состояние
 * уровня модуля в двух экземплярах; утечка кода роли в ядро делает её больше
 * бюджета, и гейт называет модули, через которые пересечение выросло.
 *
 * @param {{ mainMetafile: import("esbuild").Metafile, chunks: ReadonlyArray<{ id: string, metafile: import("esbuild").Metafile, entry?: string, sharedBudgetKb?: number }> }} params
 * @returns {string[]} нарушения, по строке на каждое
 */
export function verifyLazyChunks({ mainMetafile, chunks }) {
    const errors = [];
    const mainOutputs = Object.entries(mainMetafile.outputs).filter(([file]) => file.endsWith(".js"));
    const mainInputs = new Set(mainOutputs.flatMap(([, output]) => Object.keys(output.inputs)));

    for (const { id, metafile, entry, sharedBudgetKb } of chunks) {
        // 1. Модули куска не продублированы в ядре. Ввод stdin-обёртки — не модуль куска.
        if (entry === undefined) {
            // Пакет целиком уехал из main.js.
            for (const input of Object.keys(metafile.inputs)) {
                if (input !== "<stdin>" && mainInputs.has(input)) {
                    errors.push(`${id}: модуль ${input} лежит и в куске, и в main.js — его тянет статический импорт ядра`);
                }
            }
        } else {
            errors.push(...verifyEntryChunk({ id, metafile, entry, sharedBudgetKb, mainInputs }));
        }
        // 2. Ядро зовёт кусок только динамически (запасной путь loadLazyModule).
        for (const [file, output] of mainOutputs) {
            for (const imp of output.imports) {
                if (imp.path === id && imp.kind !== "dynamic-import") {
                    errors.push(`${id}: ${basename(file)} импортирует кусок статически (${imp.kind}) — только через loadLazyModule / importLazyModule`);
                }
            }
        }
        // 3. Кусок самодостаточен: в рантайме у него есть только require встроенных
        // модулей и другие куски через import() (их находит загрузчик).
        for (const output of Object.values(metafile.outputs)) {
            for (const imp of output.imports) {
                if (!imp.external || isBuiltin(imp.path)) continue;
                if (LAZY_CHUNK_IDS.has(imp.path) && imp.kind === "dynamic-import") continue;
                errors.push(`${id}: кусок тянет внешний модуль ${imp.path} — в SEA его не будет`);
            }
        }
    }
    return errors;
}

/**
 * Общие с ядром модули куска (крупные первыми) и их суммарный размер в куске —
 * столько процесс роли парсит второй раз.
 *
 * @param {import("esbuild").Metafile} metafile
 * @param {Set<string>} mainInputs
 */
function sharedWithMain(metafile, mainInputs) {
    const shared = Object.values(metafile.outputs)
        .flatMap((output) => Object.entries(output.inputs))
        .filter(([input]) => mainInputs.has(input))
        .sort(([, a], [, b]) => b.bytesInOutput - a.bytesInOutput);
    const sharedBytes = shared.reduce((sum, [, { bytesInOutput }]) => sum + bytesInOutput, 0);
    return { shared, sharedBytes };
}

/**
 * Сводка по кускам из нашего кода для гейта: размер куска и копия общих модулей
 * против бюджета — по ней бюджет выставляют и поднимают осознанно.
 *
 * @param {{ mainMetafile: import("esbuild").Metafile, chunks: ReadonlyArray<{ id: string, metafile: import("esbuild").Metafile, entry?: string, sharedBudgetKb?: number }> }} params
 * @returns {string[]}
 */
export function describeEntryChunks({ mainMetafile, chunks }) {
    const mainInputs = new Set(
        Object.entries(mainMetafile.outputs)
            .filter(([file]) => file.endsWith(".js"))
            .flatMap(([, output]) => Object.keys(output.inputs)),
    );
    return chunks
        .filter((c) => c.entry !== undefined)
        .map(({ id, metafile, sharedBudgetKb }) => {
            const total = Object.values(metafile.outputs).reduce((sum, output) => sum + output.bytes, 0);
            const { sharedBytes } = sharedWithMain(metafile, mainInputs);
            const kb = (/** @type {number} */ n) => (n / 1024).toFixed(1);
            return `${id}: кусок ${kb(total)} КБ, из них общих с main.js ${kb(sharedBytes)} КБ (бюджет ${sharedBudgetKb} КБ)`;
        });
}

/**
 * Правило 1 для куска из нашего кода: вход вне ядра, копия общих модулей в бюджете.
 *
 * @param {{ id: string, metafile: import("esbuild").Metafile, entry: string, sharedBudgetKb: number | undefined, mainInputs: Set<string> }} params
 * @returns {string[]}
 */
function verifyEntryChunk({ id, metafile, entry, sharedBudgetKb, mainInputs }) {
    if (sharedBudgetKb === undefined) {
        return [`${id}: у куска из нашего кода нет sharedBudgetKb — сколько общих с ядром модулей он вправе нести копией`];
    }
    if (mainInputs.has(entry)) {
        return [`${id}: вход ${entry} лежит в main.js — ядро импортирует роль статически, кусок бесполезен`];
    }
    const { shared, sharedBytes } = sharedWithMain(metafile, mainInputs);
    if (sharedBytes <= sharedBudgetKb * 1024) return [];
    const top = shared
        .slice(0, 5)
        .map(([input, { bytesInOutput }]) => `${input} ${(bytesInOutput / 1024).toFixed(1)} КБ`)
        .join(", ");
    return [
        `${id}: общих с main.js модулей ${(sharedBytes / 1024).toFixed(1)} КБ — больше бюджета ${sharedBudgetKb} КБ ` +
            `(крупнейшие: ${top}). Код роли протёк в ядро статическим импортом, или роль потянула лишнее из ядра`,
    ];
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
