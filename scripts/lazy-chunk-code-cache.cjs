"use strict";
/**
 * Кэш кода V8 для ленивого куска (`lazy/<id>.v8cache`, scripts/build-lazy-chunks.mjs).
 *
 * Отдельный CJS-файл, а не функция в build-lazy-chunks.mjs, потому что сборка SEA
 * зовёт его ВНУТРИ V8-снапшота: бинарь стартует из снапшота (`useSnapshot`), а V8
 * принимает кэш кода, только если совпала контрольная сумма read-only части
 * снапшота процесса. Кэш, снятый голым node, бинарь отвергает, и наоборот.
 * Read-only часть одинакова у любых снапшотов одного node, собранных с
 * `--predictable` (без него она плавает от сборки к сборке, проверено на пустом
 * скрипте). Поэтому `build-sea.mjs` собирает бинарь `node --predictable
 * --build-sea`, а {@link buildLazyChunkCodeCaches} — крошечный снапшот из этого
 * файла с тем же флагом и снимает кэш каждого куска процессом из него. Записка —
 * docs/TODO/OpenPerformance.md, шаг 6.
 *
 * Снапшот принимает один файл, который тянет только встроенные модули node, —
 * отсюда CJS без импортов из репозитория.
 *
 * Запуск: `node [--snapshot-blob <blob>] lazy-chunk-code-cache.cjs <кусок> <ассет> <выход> [<прогрев>]`.
 * Без снапшота кэш годится голому node — так его снимают юниты загрузчика.
 */

const { createRequire } = require("node:module");
const fs = require("node:fs");
const path = require("node:path");
const v8 = require("node:v8");
const vm = require("node:vm");

/**
 * CJS-обёртка куска — байт в байт как `LAZY_CHUNK_WRAPPER` в
 * `src/vs/base/node/lazyModule.ts`: кэш V8 привязан к исходнику целиком.
 */
const LAZY_CHUNK_WRAPPER = {
    prefix: "(function (exports, require, module, __filename, __dirname) {",
    suffix: "\n})",
};

/**
 * Кэш кода V8 для куска — в ЭТОМ процессе (его V8, флагах и снапшоте). Кусок
 * исполняется и прогревается (`warmup`): V8 компилирует функции лениво, при
 * первом вызове, а в кэш кладёт только уже скомпилированные. Кэш одной
 * компиляции на xterm почти пуст (10 КБ, 36 → 31 мс), после исполнения — 183 КБ
 * и 20 мс, после прогрева первым терминалом — 294 КБ и 11 мс (замер —
 * docs/TODO/OpenPerformance.md).
 *
 * Звать в чистом процессе: V8 делит скомпилированные функции между скриптами
 * одного исходника, и кэш вобрал бы чужой прогрев.
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
    // Прогрев мог оставить таймеры куска — процесс своё дело сделал.
    process.exit(0);
}

// Вход снапшота исполняется без `module` и с `require` только для встроенных модулей.
if (v8.startupSnapshot.isBuildingSnapshot()) {
    v8.startupSnapshot.setDeserializeMainFunction(() => runFromArgv(process.argv.slice(2)));
} else if (require.main === module) {
    void runFromArgv(process.argv.slice(2));
} else {
    // Обёртку сверяет с загрузчиком юнит сборки (build-lazy-chunks.test.mjs).
    module.exports = { LAZY_CHUNK_WRAPPER };
}
