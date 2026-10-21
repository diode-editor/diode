/**
 * Ленивые куски бандла: зависимости, не нужные до первого кадра, собираются не в
 * `dist/main.cjs`, а отдельными `lazy/<id>.cjs` (SEA — ассетами, иначе файлом
 * рядом с `main.cjs`); грузит их `loadLazyModule` при первом обращении к фиче.
 * В `main.cjs` от куска остаётся внешний `import("<id>")` (`tsup.config.ts`) —
 * запасной путь dev-сборки.
 *
 * Кусок — либо пакет (`id`), либо наш код (`entry`, роль процесса); роль делит с
 * ядром общие модули и несёт их копией в пределах `sharedBudgetKb`.
 *
 * Новый кусок — запись в {@link LAZY_CHUNKS} плюс `loadLazyModule`/`importLazyModule`
 * на шве; остальное подхватывается из списка. Рецепт — docs/arch/Common.md («Ленивые куски»).
 */

import { execFileSync } from "node:child_process";
import { builtinModules, createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { resolveDiodeVersion } from "./resolve-version.mjs";

/**
 * Флаги сборки V8-снапшота: без `--predictable` кэш кусков, снятый бинарём первого
 * прохода, бинарь второго отвергает ({@link buildLazyChunkCodeCaches}).
 */
export const SNAPSHOT_BUILD_FLAGS = ["--predictable"];

export const SNAPSHOT_ENTRY = join(import.meta.dirname, "snapshot-entry.cjs");

/**
 * @param {string} mainPath
 * @returns {Record<string, string>}
 */
export function snapshotEntryEnv(mainPath) {
    return { DIODE_SNAPSHOT_MAIN: mainPath };
}

/**
 * `warmup` — прогрев при снятии кэша кода: V8 кэширует только уже скомпилированные
 * функции, а компилирует лениво, так что без прогрева в кэш попадает лишь исполнение
 * модуля. Функция уезжает в дочерний node исходником (`String(fn)`) — без замыканий.
 *
 * `entry` — путь модуля-входа от корня репозитория; `sharedBudgetKb` при нём обязателен.
 *
 * @type {ReadonlyArray<{ id: string, reason: string, warmup?: (module: any) => unknown, entry?: string, sharedBudgetKb?: number }>}
 */
export const LAZY_CHUNKS = [
    { id: "yauzl", reason: "установка .vsix" },
    // Зовётся из common-кода — через importLazyModule.
    { id: "semver", reason: "магазин расширений: версии реестра и engines" },
    {
        id: "@xterm/headless",
        reason: "встроенный терминал: VT-эмулятор",
        // Как первый вывод XtermSurface: цвет и перевод строки.
        warmup: async (xterm) => {
            const term = new xterm.Terminal({ cols: 80, rows: 24, allowProposedApi: true, scrollback: 1000 });
            await new Promise((resolve) => term.write("diode \u001b[32mwarmup\u001b[0m\r\n$ ", resolve));
            term.dispose();
        },
    },
    {
        id: "iconv-lite",
        reason: "кодировки кроме utf-8 и UTF-16",
        // Однобайтная кодировка туда и обратно — как encoding.ts на reopen и save.
        warmup: (iconv) => {
            const bytes = iconv.encode("Привет, мир!\n", "windows1251", { addBOM: false });
            iconv.decode(bytes, "windows1251", { stripBOM: false });
        },
    },
    // Бюджет — замер плюс ~5 %; общее с ядром — vscodeTypes, протокол RPC, vscode-uri,
    // jsonc-parser, base/common. Подъёмы: 155 — парсеры environmentVariableCollection,
    // 156 (решение человека) — `sideEditors` в снимке полосы (#683, 155.06 КБ).
    {
        id: "roles/extension-host",
        reason: "роль extension host: реализация vscode API",
        entry: "src/vs/diode/roles/extensionHostRole.ts",
        sharedBudgetKb: 156,
    },
    // Общее с ядром (63 КБ из 75) — chokidar: ядро держит его для подписок на файлы настроек.
    {
        id: "roles/file-watcher",
        reason: "роль file watcher: обход дерева",
        entry: "src/vs/diode/roles/fileWatcherRole.ts",
        sharedBudgetKb: 66,
    },
];

/**
 * `module` раньше `main`: под CJS esbuild берёт `main`, а у jsonc-parser там UMD с
 * `require` внутри фабрики — esbuild его не вклеит, и бандл падает в рантайме.
 */
export const MAIN_FIELDS = ["module", "main"];

/**
 * Путь — от `repoRoot`: tsup бандлит свой конфиг вместе с этим модулем, и
 * `import.meta.dirname` здесь указывал бы на корень.
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

const LAZY_CHUNK_IDS = new Set(LAZY_CHUNKS.map(({ id }) => id));

/**
 * `import()` входа куска → внешний `import("<id>")`: без code-splitting esbuild вклеил
 * бы вход в `main.cjs`. Статический импорт входа превращается так же — и его ловит гейт.
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
 * Ключ SEA-ассета и путь относительно `main.cjs`; та же формула — в `src/vs/base/node/lazyModule.ts`.
 *
 * @param {string} id
 */
export function lazyChunkAssetName(id) {
    return `lazy/${id}.cjs`;
}

/**
 * Та же формула — в `src/vs/base/node/lazyModule.ts`.
 *
 * @param {string} id
 */
export function lazyChunkCacheAssetName(id) {
    return `lazy/${id}.v8cache`;
}

/**
 * Только для SEA. V8 принимает кэш, лишь если совпали версия, флаги и снапшот процесса
 * (у node 26 — снапшот того же входа с `--predictable`), поэтому кэш снимает бинарь
 * первого прохода в run-as-node, а второй проход вшивает его в бинарь из того же
 * `main.cjs`. Без `NODE_OPTIONS`: флаги V8 обязаны совпасть с рантаймом бинаря.
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
    // Не константой модуля: tsup вклеивает файл в свой конфиг, и `import.meta.dirname` там — корень.
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
                      // Другие куски зовутся import()'ом через загрузчик.
                      external: [...LAZY_CHUNK_IDS].filter((other) => other !== id),
                      // Та же сборка пакетов, что в main.cjs, иначе общий модуль — разные файлы, и гейт копию не видит.
                      mainFields: MAIN_FIELDS,
                      // Тот же шим, что у ядра: entryDir() куска обязан быть каталогом main.cjs.
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
 * Храповик на граф первого кадра. Кусок из нашего кода делит с ядром общие модули,
 * поэтому для него правило мягче, чем для пакета: вход вне `main.cjs`, а копия общих
 * модулей (лишний парс и состояние модуля в двух экземплярах) — в бюджете.
 *
 * @param {{ mainMetafile: import("esbuild").Metafile, chunks: ReadonlyArray<{ id: string, metafile: import("esbuild").Metafile, entry?: string, sharedBudgetKb?: number }> }} params
 * @returns {string[]} нарушения, по строке на каждое
 */
export function verifyLazyChunks({ mainMetafile, chunks }) {
    const errors = [];
    const mainOutputs = codeOutputs(mainMetafile);
    const mainInputs = new Set(mainOutputs.flatMap(([, output]) => Object.keys(output.inputs)));

    for (const { id, metafile, entry, sharedBudgetKb } of chunks) {
        // 1. Модули куска не продублированы в ядре.
        if (entry === undefined) {
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
        // 3. Кусок самодостаточен: только встроенные модули и другие куски через import().
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
 * @param {import("esbuild").Metafile} metafile
 */
function codeOutputs(metafile) {
    return Object.entries(metafile.outputs).filter(([file]) => /[.]c?js$/.test(file));
}

/**
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
 * По этой сводке бюджет выставляют и поднимают осознанно.
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
