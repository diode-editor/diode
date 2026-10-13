import { createRequire } from "node:module";
import * as path from "node:path";
import * as vm from "node:vm";

import { readPackagedAsset } from "./assets/packagedAsset.ts";

/**
 * Ленивые куски бандла («распил», docs/TODO/OpenPerformance.md, этап 1).
 *
 * Зависимость, которая не нужна до первого кадра, не лежит в `dist/main.js`:
 * `scripts/build-lazy-chunks.mjs` собирает её отдельным самодостаточным
 * CJS-файлом `lazy/<id>.cjs`, а `tsup.config.ts` объявляет её внешней. Кусок
 * парсится, только когда фиче он впервые понадобился, — не на каждом старте.
 *
 * Откуда берётся кусок (тот же порядок, что у остальных упакованных ассетов,
 * {@link readPackagedAsset}):
 *  - SEA — вшитый ассет `lazy/<id>.cjs`;
 *  - self-extract и `node dist/main.js` — файл `lazy/<id>.cjs` рядом с `main.js`;
 *  - dev и тесты (tsx/vitest) — куска нет, работает `importer` — обычный
 *    `import("<id>")` из node_modules. В бандле это голый внешний `import()`:
 *    упакованная сборка до него не доходит, кусок находится раньше.
 */

/** Шов для тестов: откуда читаются байты куска. По умолчанию — упакованные ассеты процесса. */
export interface ILazyModuleSource {
    /** Байты куска по имени ассета; `null` — куска в этой сборке нет (dev). */
    read(assetName: string): Uint8Array | null;
}

const packagedSource: ILazyModuleSource = { read: (assetName) => readPackagedAsset(assetName) };

/**
 * Имя ассета куска: ключ SEA-ассета и путь файла относительно `main.js`.
 * Та же формула — в `lazyChunkAssetName` (`scripts/build-lazy-chunks.mjs`).
 */
export function lazyChunkAssetName(id: string): string {
    return `lazy/${id}.cjs`;
}

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
    return evaluateChunk(new TextDecoder().decode(bytes), assetName) as T;
}

/**
 * Исполняет CJS-кусок в обёртке модуля. `require` внутри — настоящий, от
 * `createRequire`: кусок самодостаточен и тянет только встроенные модули node
 * (это проверяет гейт `verifyLazyChunks`). База `process.execPath` — абсолютный
 * путь, валидный и в SEA, где у куска нет файла на диске; резолв builtin'ов от
 * базы не зависит.
 *
 * Компиляция — `vm.compileFunction`, а не `Module._compile`, ради будущего
 * code cache: у неё есть `cachedData` (docs/TODO/OpenPerformance.md).
 */
function evaluateChunk(code: string, assetName: string): unknown {
    // Имя файла — для стек-трейсов: `diode:lazy/<id>.cjs` сразу говорит, откуда код.
    const filename = `diode:${assetName}`;
    const wrapper = vm.compileFunction(code, ["exports", "require", "module", "__filename", "__dirname"], {
        filename,
    }) as (exports: unknown, require: NodeJS.Require, module: { exports: unknown }, f: string, d: string) => void;
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
