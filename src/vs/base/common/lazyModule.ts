/**
 * Ленивый кусок бандла — со стороны кода, которому нельзя в `node/`
 * (docs/arch/Common.md, «Ленивые куски бандла»).
 *
 * Сам загрузчик (`loadLazyModule`, `base/node/lazyModule.ts`) читает упакованные
 * ассеты и компилирует кусок через `node:vm` — common-код его импортировать не
 * может. Поэтому common зовёт {@link importLazyModule}, а как именно кусок
 * приходит, решает процесс: точка входа (`src/vs/diode/main.ts`) один раз
 * подставляет node-загрузчик через {@link setLazyModuleLoader}. Аналог в
 * эталоне — `importAMDNodeModule` из `vs/amdX.ts`, которым common-код vscode
 * лениво берёт iconv и xterm.
 *
 * Без подстановки (vitest, сторонние точки входа) работает `importer` —
 * обычный `import()` из node_modules. В упакованной сборке такой путь упал бы
 * («пакета нет»), поэтому точка входа обязана подставить загрузчик до первого
 * вызова; ловит это e2e фичи на SEA-бинаре.
 */

/** Загрузчик куска: `id` — запись `LAZY_CHUNKS`, `importer` — `() => import("<id>")`. */
export type LazyModuleLoader = <T>(id: string, importer: () => Promise<T>) => Promise<T>;

const importDirectly: LazyModuleLoader = (_id, importer) => importer();

let loader: LazyModuleLoader = importDirectly;

/**
 * Модуль `id` из ленивого куска. Вызов асинхронный: синхронный код получает
 * модуль параметром от асинхронной границы фичи, а не берёт его сам.
 *
 * @param id имя пакета; обязано быть записью `LAZY_CHUNKS` в `scripts/build-lazy-chunks.mjs`
 * @param importer `() => import("<id>")` — литеральный, чтобы tsx/vitest и типы видели модуль
 */
export function importLazyModule<T>(id: string, importer: () => Promise<T>): Promise<T> {
    return loader(id, importer);
}

/** Подставляет загрузчик процесса (точка входа); `undefined` — вернуть прямой `import()` (тесты). */
export function setLazyModuleLoader(next: LazyModuleLoader | undefined): void {
    loader = next ?? importDirectly;
}
