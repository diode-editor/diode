import { createRequire } from "node:module";
import * as path from "node:path";
import * as vm from "node:vm";

import { onUnexpectedError } from "../common/errors.ts";

import { readPackagedAssetView } from "./assets/packagedAsset.ts";

/**
 * Ленивые куски бандла («распил», docs/TODO/OpenPerformance.md, этап 1).
 *
 * Зависимость, которая не нужна до первого кадра, не лежит в `dist/main.cjs`:
 * `scripts/build-lazy-chunks.mjs` собирает её отдельным самодостаточным
 * CJS-файлом `lazy/<id>.cjs`, а `tsup.config.ts` объявляет её внешней. Кусок
 * парсится, только когда фиче он впервые понадобился, — не на каждом старте.
 *
 * Откуда берётся кусок (тот же порядок, что у остальных упакованных ассетов,
 * {@link readPackagedAssetView}):
 *  - SEA — вшитый ассет `lazy/<id>.cjs` (без копии, `sea.getRawAsset`) и рядом
 *    его кэш кода V8 `lazy/<id>.v8cache`, снятый при сборке бинарём первого
 *    прохода (тот же node и снапшот того же `main.cjs`);
 *  - self-extract и `node dist/main.cjs` — файл `lazy/<id>.cjs` рядом с `main.cjs`;
 *  - dev и тесты (tsx/vitest) — куска нет, работает `importer` — обычный
 *    `import("<id>")` из node_modules. В бандле это голый внешний `import()`:
 *    упакованная сборка до него не доходит, кусок находится раньше.
 */

/** Шов для тестов: откуда читаются байты куска. По умолчанию — упакованные ассеты процесса. */
export interface ILazyModuleSource {
    /** Байты ассета (кусок или его кэш кода) по имени; `null` — его в этой сборке нет. */
    read(assetName: string): Uint8Array | null;
}

const packagedSource: ILazyModuleSource = { read: (assetName) => readPackagedAssetView(assetName) };

/**
 * Имя ассета куска: ключ SEA-ассета и путь файла относительно `main.cjs`.
 * Та же формула — в `lazyChunkAssetName` (`scripts/build-lazy-chunks.mjs`).
 */
export function lazyChunkAssetName(id: string): string {
    return `lazy/${id}.cjs`;
}

/** Имя ассета кэша кода куска. Та же формула — в `lazyChunkCacheAssetName` (`scripts/build-lazy-chunks.mjs`). */
export function lazyChunkCacheAssetName(id: string): string {
    return `lazy/${id}.v8cache`;
}

/**
 * CJS-обёртка куска. Кэш кода V8 привязан к исходнику целиком, поэтому сборка
 * (`scripts/lazy-chunk-code-cache.cjs`, `LAZY_CHUNK_WRAPPER`) оборачивает кусок
 * ровно так же; расхождение ловит юнит «кэш из сборки принят».
 */
export const LAZY_CHUNK_WRAPPER = {
    prefix: "(function (exports, require, module, __filename, __dirname) {",
    suffix: "\n})",
} as const;

const loaded = new Map<string, Promise<unknown>>();

/**
 * Модуль `id` из ленивого куска, а без куска — через `importer`. Загрузка одна на
 * процесс: повторные вызовы отдают тот же промис.
 *
 * Результат имеет форму пространства имён `import()` над CJS-модулем:
 * именованные поля `module.exports` плюс `default` — сам `module.exports`
 * (как у node для CJS), поэтому вызывающему всё равно, каким путём модуль пришёл.
 *
 * @param id имя пакета; обязано быть записью `LAZY_CHUNKS` в `scripts/build-lazy-chunks.mjs`
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

/** Сбрасывает загруженные модули — только для тестов. */
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
 * Исполняет CJS-кусок в обёртке модуля. `require` внутри — настоящий, от
 * `createRequire`: кусок самодостаточен и тянет только встроенные модули node
 * (это проверяет гейт `verifyLazyChunks`). База `process.execPath` — абсолютный
 * путь, валидный и в SEA, где у куска нет файла на диске; резолв builtin'ов от
 * базы не зависит.
 *
 * Компиляция — `vm.Script` над обёрткой-выражением (как `Module.wrap` в старом
 * загрузчике node), а не `vm.compileFunction`: обёртка в скобках компилируется
 * сразу, и кэш кода, снятый со скрипта при сборке, несёт тело куска. Кэш
 * `compileFunction` снимается до компиляции тела и почти пуст — на xterm он
 * давал 37 → 30 мс, кэш скрипта — 37 → 12 (замер — docs/arch/Common.md, «Ленивые куски бандла»).
 *
 * Кэш V8 отвергает молча, если не совпали версия V8, флаги, исходник или
 * V8-снапшот процесса (бинарь стартует из снапшота). Отказ загрузку не ломает
 * (кусок компилируется без кэша), но в SEA его быть не должно — кэш снят
 * бинарём первого прохода сборки из снапшота того же входа
 * (`buildLazyChunkCodeCaches`), — поэтому он уходит в лог как непредвиденный.
 */
function evaluateChunk(code: string, assetName: string, cachedData: Uint8Array | undefined): unknown {
    // Имя файла — для стек-трейсов: `diode:lazy/<id>.cjs` сразу говорит, откуда код.
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
