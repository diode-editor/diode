import { createRequire } from "node:module";
import * as path from "node:path";
import * as vm from "node:vm";

import { onUnexpectedError } from "../common/errors.ts";

import { readPackagedAssetView } from "./assets/packagedAsset.ts";

/**
 * Lazy chunks (docs/TODO/OpenPerformance.md): a dependency not needed before the first frame is built
 * as a separate `lazy/<id>.cjs` (`scripts/build-lazy-chunks.mjs`) and parsed on
 * first use. In dev and tests there is no chunk and `importer` runs; in the bundle
 * that is a bare external `import()` the packaged build never reaches.
 */

export interface ILazyModuleSource {
    read(assetName: string): Uint8Array | null;
}

const packagedSource: ILazyModuleSource = { read: (assetName) => readPackagedAssetView(assetName) };

/** The same formula is in `scripts/build-lazy-chunks.mjs`. */
export function lazyChunkAssetName(id: string): string {
    return `lazy/${id}.cjs`;
}

/** The same formula is in `scripts/build-lazy-chunks.mjs`. */
export function lazyChunkCacheAssetName(id: string): string {
    return `lazy/${id}.v8cache`;
}

/** The V8 code cache is bound to the whole source: `scripts/lazy-chunk-code-cache.cjs` wraps the chunk exactly the same way. */
export const LAZY_CHUNK_WRAPPER = {
    prefix: "(function (exports, require, module, __filename, __dirname) {",
    suffix: "\n})",
} as const;

const loaded = new Map<string, Promise<unknown>>();

/**
 * @param id must be a `LAZY_CHUNKS` entry in `scripts/build-lazy-chunks.mjs`
 * @param importer `() => import("<id>")`, a literal so tsx/vitest and the types see the module
 */
export function loadLazyModule<T>(
    id: string,
    importer: () => Promise<T>,
    source: ILazyModuleSource = packagedSource,
): Promise<T> {
    let pending = loaded.get(id);
    if (pending === undefined) {
        pending = loadOnce(id, importer, source);
        loaded.set(id, pending);
        // A failure doesn't stick: the next call tries again.
        pending.catch(() => loaded.delete(id));
    }
    return pending as Promise<T>;
}

export function resetLazyModulesForTests(): void {
    loaded.clear();
}

async function loadOnce<T>(id: string, importer: () => Promise<T>, source: ILazyModuleSource): Promise<T> {
    const assetName = lazyChunkAssetName(id);
    const bytes = source.read(assetName);
    if (bytes === null) return importer();
    const cachedData = source.read(lazyChunkCacheAssetName(id)) ?? undefined;
    return evaluateChunk(new TextDecoder().decode(bytes), assetName, cachedData) as T;
}

/**
 * `require` comes from `createRequire(process.execPath)`: the chunk pulls in only builtins
 * (the `verifyLazyChunks` gate), and `execPath` is an absolute path, valid in SEA too.
 *
 * `vm.Script`, not `vm.compileFunction`: the `compileFunction` cache is taken before
 * the body is compiled and is nearly empty; on xterm 37 → 30 ms versus 37 → 12 for the script.
 *
 * V8 rejecting the cache doesn't break loading, but in SEA it must not happen (the cache
 * is taken from the snapshot of the same entry), hence it is logged as unexpected.
 */
function evaluateChunk(code: string, assetName: string, cachedData: Uint8Array | undefined): unknown {
    const filename = `diode:${assetName}`;
    const script = new vm.Script(LAZY_CHUNK_WRAPPER.prefix + code + LAZY_CHUNK_WRAPPER.suffix, {
        filename,
        cachedData,
    });
    if (script.cachedDataRejected === true) {
        onUnexpectedError(new Error(`кэш кода ${assetName} отвергнут V8 — кусок скомпилирован без него`));
    }
    const wrapper = script.runInThisContext() as (
        exports: unknown,
        require: NodeJS.Require,
        module: { exports: unknown },
        f: string,
        d: string,
    ) => void;
    const module = { exports: {} as unknown };
    wrapper.call(
        module.exports,
        module.exports,
        createRequire(process.execPath),
        module,
        filename,
        path.dirname(filename),
    );
    return toNamespace(module.exports);
}

function toNamespace(exports: unknown): Record<string, unknown> {
    const namespace: Record<string, unknown> = { default: exports };
    if ((typeof exports === "object" && exports !== null) || typeof exports === "function") {
        for (const [key, value] of Object.entries(exports)) {
            if (key !== "default") namespace[key] = value;
        }
    }
    return namespace;
}
