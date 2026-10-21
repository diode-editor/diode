"use strict";
/**
 * V8 code cache for a lazy chunk (`lazy/<id>.v8cache`). A standalone CJS with no repo
 * imports: the SEA build runs it with the binary ITSELF in run-as-node, because V8 accepts
 * the cache only if the process is restored from a snapshot of the same entry with `--predictable`.
 * A plain node cache fits only plain node (that is how the loader unit tests take it).
 *
 * Usage: `[DIODE_RUN_AS_NODE=1 diode | node] lazy-chunk-code-cache.cjs <chunk> <asset> <out> [<warmup>]`.
 */

const { createRequire } = require("node:module");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

/** Byte for byte as `LAZY_CHUNK_WRAPPER` in `src/vs/base/node/lazyModule.ts`: the V8 cache is bound to the whole source. */
const LAZY_CHUNK_WRAPPER = {
    prefix: "(function (exports, require, module, __filename, __dirname) {",
    suffix: "\n})",
};

/**
 * Runs and warms up: only already compiled functions go into the cache (xterm:
 * compile 10 KB and 31 ms, run 183 KB and 20 ms, warmup 294 KB and 11 ms).
 *
 * Call it in a clean process: V8 shares compiled functions between scripts of the same
 * source, and the cache would absorb someone else's warmup.
 *
 * @param {string} code chunk source
 * @param {string} assetName `lazy/<id>.cjs`, the script file name, as in the loader
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

/** @param {string[]} args `<chunk> <asset> <out> [<warmup source>]` */
async function runFromArgv(args) {
    const [chunkPath, assetName, out, warmupSource] = args;
    // eslint-disable-next-line no-eval -- warmup source from LAZY_CHUNKS (build-lazy-chunks.mjs)
    const warmup = warmupSource === undefined ? undefined : (0, eval)(`(${warmupSource})`);
    fs.writeFileSync(out, await createLazyChunkCodeCache(fs.readFileSync(chunkPath, "utf8"), assetName, warmup));
    // The warmup may have left chunk timers.
    process.exit(0);
}

// The binary's run-as-node loads the script via `import()`: `require.main` is empty, the path is in argv[1].
if (require.main === module || path.resolve(process.argv[1] ?? "") === __filename) {
    void runFromArgv(process.argv.slice(2));
} else {
    module.exports = { LAZY_CHUNK_WRAPPER };
}
