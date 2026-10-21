import { createRequire } from "node:module";

/**
 * База — `process.execPath`, а не `"file:///"`: тот на win32 бросает
 * (`ERR_INVALID_FILE_URL_PATH`: у файлового URL нет буквы диска), и `isSeaBinary()`
 * на Windows-SEA молча отвечал бы `false` — ассеты искались бы файлами рядом с exe.
 */
export function seaRequire(): NodeJS.Require {
    return createRequire(process.execPath);
}

/**
 * `node:sea` доступен только через `require()` внутри SEA-сборки — статический
 * ESM-импорт падает с `ERR_UNKNOWN_BUILTIN_MODULE` даже в работающем SEA exe.
 */
export function isSeaBinary(): boolean {
    try {
        const req = seaRequire();
        const sea = req("node:sea") as { isSea(): boolean };
        return sea.isSea();
    } catch {
        return false;
    }
}

// Stryker disable all: тело исполняется только внутри SEA-бинаря — юнитом не достать (файл исключён и из покрытия); проверяет e2e на собранном бинаре
export function readSeaAsset(name: string): ArrayBuffer {
    const req = seaRequire();
    const sea = req("node:sea") as { getAsset(key: string): ArrayBuffer };
    return sea.getAsset(name);
}

/** Вид на память бинаря: только чтение, запись роняет процесс. */
export function readSeaRawAsset(name: string): ArrayBuffer | null {
    const req = seaRequire();
    const sea = req("node:sea") as { getRawAsset(key: string): ArrayBuffer };
    try {
        return sea.getRawAsset(name);
    } catch {
        return null;
    }
}
// Stryker restore all
