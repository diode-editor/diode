import { createRequire } from "node:module";

/**
 * Возвращает `true`, если процесс запущен из SEA-бинаря (Single Executable
 * Application). `node:sea` доступен только через `require()` внутри SEA-сборки —
 * статический ESM-импорт падает с `ERR_UNKNOWN_BUILTIN_MODULE` даже в
 * работающем SEA exe.
 *
 * Используется кодом, который должен по-разному вести себя в dev (`tsx`/`npm`)
 * и production (`diode` SEA): выбор asset access, конфигурация log sinks,
 * spawn-аргументы extension host'а.
 */
export function isSeaBinary(): boolean {
    try {
        const req = createRequire("file:///");
        const sea = req("node:sea") as { isSea(): boolean };
        return sea.isSea();
    } catch {
        return false;
    }
}

/**
 * Байты SEA-ассета по имени (`node:sea.getAsset`). Только внутри SEA-бинаря —
 * вне его `node:sea` недоступен, и вызов бросает.
 */
// Stryker disable all: тело исполняется только внутри SEA-бинаря — юнитом не достать (файл исключён и из покрытия); проверяет e2e на собранном бинаре
export function readSeaAsset(name: string): ArrayBuffer {
    const req = createRequire("file:///");
    const sea = req("node:sea") as { getAsset(key: string): ArrayBuffer };
    return sea.getAsset(name);
}
// Stryker restore all
