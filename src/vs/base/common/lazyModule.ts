/**
 * Ленивые куски бандла для common-кода (docs/arch/Common.md, «Ленивые куски
 * бандла»; аналог `importAMDNodeModule` эталона). Настоящий загрузчик живёт в
 * `node/`, и точка входа обязана подставить его до первого вызова: прямой
 * `import()` в упакованной сборке падает — пакета нет.
 */

export type LazyModuleLoader = <T>(id: string, importer: () => Promise<T>) => Promise<T>;

const importDirectly: LazyModuleLoader = (_id, importer) => importer();

let loader: LazyModuleLoader = importDirectly;

/**
 * @param id имя пакета; обязано быть записью `LAZY_CHUNKS` в `scripts/build-lazy-chunks.mjs`
 * @param importer `() => import("<id>")` — литеральный, чтобы tsx/vitest и типы видели модуль
 */
export function importLazyModule<T>(id: string, importer: () => Promise<T>): Promise<T> {
    return loader(id, importer);
}

/** `undefined` — вернуть прямой `import()`. */
export function setLazyModuleLoader(next: LazyModuleLoader | undefined): void {
    loader = next ?? importDirectly;
}
