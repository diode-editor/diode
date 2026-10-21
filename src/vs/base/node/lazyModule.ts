import { createRequire } from "node:module";
import * as path from "node:path";
import * as vm from "node:vm";

import { onUnexpectedError } from "../common/errors.ts";

import { readPackagedAssetView } from "./assets/packagedAsset.ts";

/**
 * Ленивые куски бандла (docs/TODO/OpenPerformance.md): зависимость, не нужная до первого кадра, собирается
 * отдельным `lazy/<id>.cjs` (`scripts/build-lazy-chunks.mjs`) и парсится при
 * первой надобности. В dev и тестах куска нет — работает `importer`; в бандле
 * это голый внешний `import()`, до которого упакованная сборка не доходит.
 */

export interface ILazyModuleSource {
    read(assetName: string): Uint8Array | null;
}

const packagedSource: ILazyModuleSource = { read: (assetName) => readPackagedAssetView(assetName) };

/** Та же формула — в `scripts/build-lazy-chunks.mjs`. */
export function lazyChunkAssetName(id: string): string {
    return `lazy/${id}.cjs`;
}

/** Та же формула — в `scripts/build-lazy-chunks.mjs`. */
export function lazyChunkCacheAssetName(id: string): string {
    return `lazy/${id}.v8cache`;
}

/** Кэш кода V8 привязан к исходнику целиком: `scripts/lazy-chunk-code-cache.cjs` оборачивает кусок ровно так же. */
export const LAZY_CHUNK_WRAPPER = {
    prefix: "(function (exports, require, module, __filename, __dirname) {",
    suffix: "\n})",
} as const;

const loaded = new Map<string, Promise<unknown>>();

/**
 * @param id обязан быть записью `LAZY_CHUNKS` в `scripts/build-lazy-chunks.mjs`
 * @param importer `() => import("<id>")` — литеральный, чтобы tsx/vitest и типы видели модуль
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
        // Сбой не залипает: следующий вызов попробует снова.
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
 * `require` — от `createRequire(process.execPath)`: кусок тянет только builtin'ы
 * (гейт `verifyLazyChunks`), а `execPath` — абсолютный путь, валидный и в SEA.
 *
 * `vm.Script`, а не `vm.compileFunction`: кэш `compileFunction` снимается до
 * компиляции тела и почти пуст — на xterm 37 → 30 мс против 37 → 12 у скрипта.
 *
 * Отказ V8 от кэша загрузку не ломает, но в SEA его быть не должно (кэш снят
 * из снапшота того же входа) — поэтому в лог как непредвиденный.
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
