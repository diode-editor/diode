/**
 * Ленивые куски бандла («распил»): зависимости, которые не нужны до первого
 * кадра, не лежат в `dist/main.cjs`, а собираются отдельными CJS-файлами
 * `lazy/<id>.cjs`. SEA вшивает их ассетами, self-extract и `node dist/main.cjs`
 * берут файлом рядом с `main.cjs`. Грузит их `loadLazyModule`
 * (`src/vs/base/node/lazyModule.ts`) при первом обращении к фиче.
 *
 * Как это держится:
 *  - `tsup.config.ts` объявляет каждый `id` из {@link LAZY_CHUNKS} внешним:
 *    в `main.cjs` остаётся голый `import("<id>")` — запасной путь dev-сборки,
 *    в упакованной сборке до него не доходит (загрузчик находит кусок раньше);
 *  - {@link buildLazyChunks} собирает куски esbuild'ом (CJS, platform node);
 *  - {@link verifyLazyChunks} — храповик на граф первого кадра: ни один модуль
 *    куска не попал в `main.cjs`, `main.cjs` не импортирует кусок статически,
 *    кусок не тянет ничего, кроме встроенных модулей node. Его зовёт сборка
 *    (`build-dist.mjs`) и CI (`scripts/check-lazy-chunks.mjs`, job `static`).
 *
 *  - {@link buildLazyChunkCodeCaches} снимает кэш кода V8 для каждого куска
 *    (только для SEA: тот же node и вшивается, процесс — из снапшота, иначе кэш отвергнут).
 *
 * Два вида кусков:
 *  - пакет (`id` — имя пакета из node_modules): листовая библиотека без нашего
 *    кода, ни один её модуль не лежит в `main.cjs`;
 *  - наш код (`entry` — путь к модулю-входу): роль процесса (extension host,
 *    file watcher). Её граф делит с ядром общие модули (`base/common`, протокол
 *    RPC, `vscodeTypes`): кусок несёт их копией, ядро — своей. Гейт держит
 *    вход вне `main.cjs` и цену копии — `sharedBudgetKb`, см. {@link verifyLazyChunks}.
 *
 * Новая часть распила — запись в {@link LAZY_CHUNKS} плюс `loadLazyModule` (node) или `importLazyModule` (common) на
 * её шве; остальное (external, сборка, ассеты SEA, payload self-extract,
 * гейт) подхватывается из списка. Рецепт — docs/arch/Common.md («Ленивые куски»).
 */

import { execFileSync } from "node:child_process";
import { builtinModules, createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { resolveDiodeVersion } from "./resolve-version.mjs";

/**
 * Флаги node, с которыми собирается V8-снапшот бинаря (build-sea.mjs, оба прохода)
 * и гейта снапшота: `--predictable` делает снапшот воспроизводимым для проверки
 * кэша кода, иначе кэш кусков, снятый бинарём первого прохода, бинарь второго
 * отвергает ({@link buildLazyChunkCodeCaches}).
 */
export const SNAPSHOT_BUILD_FLAGS = ["--predictable"];

/**
 * Вход сборки V8-снапшота ядра (build-sea.mjs, гейт check-snapshot.mjs): исполняет
 * `main.cjs`, скомпилированный eagerly, — байткод всех функций бандла едет в блобе
 * (подробности — в самом файле). Путь к `main.cjs` — env {@link snapshotEntryEnv}.
 */
export const SNAPSHOT_ENTRY = join(import.meta.dirname, "snapshot-entry.cjs");

/**
 * Env процесса сборки снапшота: путь к `main.cjs` для {@link SNAPSHOT_ENTRY}.
 * @param {string} mainPath
 * @returns {Record<string, string>}
 */
export function snapshotEntryEnv(mainPath) {
    return { DIODE_SNAPSHOT_MAIN: mainPath };
}

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
    // 150 → 155: законный рост протокола — парсеры коллекций окружения
    // (`environmentVariableCollection`) и их enum нужны обеим сторонам (151.3 КБ).
    // 155 → 156 (решение человека): разбор `sideEditors` в снимке полосы — стороны
    // диффа видны расширению как `visibleTextEditors` (предложенный дифф Claude
    // Code); main шёл в 40 байтах от потолка, ветка дала 155.06 КБ.
    // Состав и цена — docs/TODO/OpenPerformance.md.
    {
        id: "roles/extension-host",
        reason: "роль extension host: реализация vscode API",
        entry: "src/vs/diode/roles/extensionHostRole.ts",
        sharedBudgetKb: 156,
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

/**
 * Поля `package.json` для резолва пакетов в CJS-сборках ядра и кусков из нашего
 * кода: `module` раньше `main`, как резолвила ESM-сборка ядра. Под CJS esbuild
 * по умолчанию берёт `main`, а у jsonc-parser там UMD с динамическим `require`
 * внутри фабрики: esbuild его не вклеит, и бандл падает в рантайме.
 */
export const MAIN_FIELDS = ["module", "main"];

/**
 * Шим `import.meta.url` для CJS-сборок — ядра (`tsup.config.ts`) и кусков из
 * нашего кода, один на всех: ленивый геттер URL главного скрипта процесса
 * (`scripts/import-meta-url-shim.mjs`, там же — почему не `__filename` и не
 * `process.argv[1]`). Путь — от `repoRoot`: tsup бандлит свой конфиг вместе с
 * этим модулем, и `import.meta.dirname` здесь указывал бы на корень.
 *
 * @param {string} repoRoot
 * @returns {{ define: Record<string, string>, inject: string[] }}
 */
export function importMetaUrlShim(repoRoot) {
    return {
        define: { "import.meta.url": "__diode_import_meta.url" },
        inject: [join(repoRoot, "scripts", "import-meta-url-shim.mjs")],
    };
}

/** Имена всех кусков: кусок вправе звать другой кусок `import()`'ом (ext host — iconv). */
const LAZY_CHUNK_IDS = new Set(LAZY_CHUNKS.map(({ id }) => id));

/**
 * Плагин esbuild для сборки ядра (`tsup.config.ts`): `import()` модуля-входа
 * куска из нашего кода становится внешним `import("<id>")`, как у кусков-пакетов.
 * Без него esbuild без code-splitting вклеил бы вход в `main.cjs` целиком.
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
 * Имя ассета куска: ключ SEA-ассета и путь файла относительно `main.cjs`.
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
 * Снимает кэш кода каждого куска в `<outDir>/<lazy/<id>.v8cache>` для SEA.
 *
 * Бинарь стартует из V8-снапшота ядра (`useSnapshot`, build-sea.mjs), а V8
 * принимает кэш кода, только если совпали версия, флаги и снапшот процесса: у
 * node 26 — снапшот того же входа, собранный с `--predictable`
 * ({@link SNAPSHOT_BUILD_FLAGS}; без флага кэш отвергает даже пересобранный
 * снапшот того же скрипта). Поэтому кэш снимает сам бинарь первого прохода
 * сборки в режиме run-as-node, а второй проход вшивает его в бинарь, собранный из
 * того же `main.cjs` с теми же флагами. Без `NODE_OPTIONS`: флаги V8 обязаны
 * совпасть с рантаймом бинаря. Кэш едет только в SEA: self-extract и
 * `node dist/main.cjs` стартуют без снапшота, и кэш им не подходит.
 *
 * @param {{ chunks: ReadonlyArray<{ id: string, asset: string, path: string }>, outDir: string, command: readonly string[] }} params
 *   `command` — чем исполнять `lazy-chunk-code-cache.cjs`: `[бинарь]` (с
 *   `DIODE_RUN_AS_NODE=1`) или любая команда с той же семантикой argv.
 * @returns {Array<{ asset: string, path: string }>}
 */
export function buildLazyChunkCodeCaches({ chunks, outDir, command }) {
    const warmups = new Map(LAZY_CHUNKS.map(({ id, warmup }) => [id, warmup]));
    const env = { ...process.env, DIODE_RUN_AS_NODE: "1" };
    delete env.NODE_OPTIONS;
    // Путь — здесь, а не константой модуля: tsup вклеивает этот файл в свой конфиг,
    // и `import.meta.dirname` верхнего уровня там указывал бы на корень репозитория.
    const script = join(import.meta.dirname, "lazy-chunk-code-cache.cjs");
    const [file, ...prefix] = command;
    return chunks.map(({ id, asset, path }) => {
        const cacheAsset = lazyChunkCacheAssetName(id);
        const out = join(outDir, cacheAsset);
        mkdirSync(dirname(out), { recursive: true });
        const warmup = warmups.get(id);
        const args = [...prefix, script, path, asset, out, ...(warmup ? [String(warmup)] : [])];
        execFileSync(file, args, { env, stdio: "inherit" });
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
                      // Пакеты — той же сборкой, что в main.cjs (MAIN_FIELDS). Иначе общий модуль в
                      // куске и в ядре — разные файлы, и гейт копию не видит; а UMD-сборка
                      // jsonc-parser в бандле ломается (require внутри фабрики).
                      mainFields: MAIN_FIELDS,
                      // Та же версия, что tsup зашивает в main.cjs (tsup.config.ts), и тот же шим
                      // import.meta.url: entryDir() (packagedRuntime.ts) куска — каталог main.cjs.
                      define: {
                          __DIODE_VERSION__: JSON.stringify(resolveDiodeVersion()),
                          ...importMetaUrlShim(repoRoot).define,
                      },
                      inject: importMetaUrlShim(repoRoot).inject,
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
 * Кусок-пакет: ни один его модуль не лежит в `main.cjs`. Кусок из нашего кода
 * (`entry`) делит с ядром общие модули, и запретить пересечение нельзя, поэтому
 * правило другое: вход куска не лежит в `main.cjs` (иначе ядро тянет роль
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
    const mainOutputs = codeOutputs(mainMetafile);
    const mainInputs = new Set(mainOutputs.flatMap(([, output]) => Object.keys(output.inputs)));

    for (const { id, metafile, entry, sharedBudgetKb } of chunks) {
        // 1. Модули куска не продублированы в ядре. Ввод stdin-обёртки — не модуль куска.
        if (entry === undefined) {
            // Пакет целиком уехал из main.cjs.
            for (const input of Object.keys(metafile.inputs)) {
                if (input !== "<stdin>" && mainInputs.has(input)) {
                    errors.push(`${id}: модуль ${input} лежит и в куске, и в main.cjs — его тянет статический импорт ядра`);
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
 * Выходы с кодом (`main.cjs`, без `.map`).
 *
 * @param {import("esbuild").Metafile} metafile
 */
function codeOutputs(metafile) {
    return Object.entries(metafile.outputs).filter(([file]) => /[.]c?js$/.test(file));
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
    const mainInputs = new Set(codeOutputs(mainMetafile).flatMap(([, output]) => Object.keys(output.inputs)));
    return chunks
        .filter((c) => c.entry !== undefined)
        .map(({ id, metafile, sharedBudgetKb }) => {
            const total = Object.values(metafile.outputs).reduce((sum, output) => sum + output.bytes, 0);
            const { sharedBytes } = sharedWithMain(metafile, mainInputs);
            const kb = (/** @type {number} */ n) => (n / 1024).toFixed(1);
            return `${id}: кусок ${kb(total)} КБ, из них общих с main.cjs ${kb(sharedBytes)} КБ (бюджет ${sharedBudgetKb} КБ)`;
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
        return [`${id}: вход ${entry} лежит в main.cjs — ядро импортирует роль статически, кусок бесполезен`];
    }
    const { shared, sharedBytes } = sharedWithMain(metafile, mainInputs);
    if (sharedBytes <= sharedBudgetKb * 1024) return [];
    const top = shared
        .slice(0, 5)
        .map(([input, { bytesInOutput }]) => `${input} ${(bytesInOutput / 1024).toFixed(1)} КБ`)
        .join(", ");
    return [
        `${id}: общих с main.cjs модулей ${(sharedBytes / 1024).toFixed(1)} КБ — больше бюджета ${sharedBudgetKb} КБ ` +
            `(крупнейшие: ${top}). Код роли протёк в ядро статическим импортом, или роль потянула лишнее из ядра`,
    ];
}
