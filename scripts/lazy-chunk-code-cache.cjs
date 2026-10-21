"use strict";
/**
 * Кэш кода V8 для ленивого куска (`lazy/<id>.v8cache`). Отдельный CJS без импортов
 * из репозитория: сборка SEA исполняет его САМИМ бинарём в run-as-node — V8 примет
 * кэш, только если процесс восстановлен из снапшота того же входа с `--predictable`.
 * Кэш голого node годится только голому node (так его снимают юниты загрузчика).
 *
 * Запуск: `[DIODE_RUN_AS_NODE=1 diode | node] lazy-chunk-code-cache.cjs <кусок> <ассет> <выход> [<прогрев>]`.
 */

const { createRequire } = require("node:module");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

/** Байт в байт как `LAZY_CHUNK_WRAPPER` в `src/vs/base/node/lazyModule.ts`: кэш V8 привязан к исходнику целиком. */
const LAZY_CHUNK_WRAPPER = {
    prefix: "(function (exports, require, module, __filename, __dirname) {",
    suffix: "\n})",
};

/**
 * Исполняем и прогреваем: в кэш попадают только уже скомпилированные функции (xterm:
 * компиляция — 10 КБ и 31 мс, исполнение — 183 КБ и 20 мс, прогрев — 294 КБ и 11 мс).
 *
 * Звать в чистом процессе: V8 делит скомпилированные функции между скриптами одного
 * исходника, и кэш вобрал бы чужой прогрев.
 *
 * @param {string} code исходник куска
 * @param {string} assetName `lazy/<id>.cjs` — имя файла скрипта, как у загрузчика
 * @param {((module: any) => unknown) | undefined} warmup
 * @returns {Promise<Buffer>}
 */
async function createLazyChunkCodeCache(code, assetName, warmup) {
    const filename = `diode:${assetName}`;
    const script = new vm.Script(LAZY_CHUNK_WRAPPER.prefix + code + LAZY_CHUNK_WRAPPER.suffix, { filename });
    const module = { exports: {} };
    script.runInThisContext()(module.exports, createRequire(process.execPath), module, filename, path.dirname(filename));
    await warmup?.(module.exports);
    return script.createCachedData();
}

/** @param {string[]} args `<кусок> <ассет> <выход> [<исходник прогрева>]` */
async function runFromArgv(args) {
    const [chunkPath, assetName, out, warmupSource] = args;
    // eslint-disable-next-line no-eval -- исходник прогрева из LAZY_CHUNKS (build-lazy-chunks.mjs)
    const warmup = warmupSource === undefined ? undefined : (0, eval)(`(${warmupSource})`);
    fs.writeFileSync(out, await createLazyChunkCodeCache(fs.readFileSync(chunkPath, "utf8"), assetName, warmup));
    // Прогрев мог оставить таймеры куска.
    process.exit(0);
}

// run-as-node бинаря грузит скрипт через `import()`: `require.main` пуст, путь — в argv[1].
if (require.main === module || path.resolve(process.argv[1] ?? "") === __filename) {
    void runFromArgv(process.argv.slice(2));
} else {
    module.exports = { LAZY_CHUNK_WRAPPER };
}
