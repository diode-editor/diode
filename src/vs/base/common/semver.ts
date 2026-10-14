import type * as SemverModule from "semver";

import { importLazyModule } from "./lazyModule.ts";

/**
 * node-semver — ленивый кусок бандла: нужен только магазину расширений
 * (разбор реестра, совместимость `engines`), а не первому кадру.
 *
 * Функции, которым он нужен, синхронные и чистые, поэтому модуль они получают
 * параметром: асинхронная граница фичи (чтение реестра, установка, загрузка
 * каталога) делает `await loadSemver()` и передаёт его дальше. Забыть загрузку
 * так нельзя — без модуля такую функцию не вызвать.
 */
export type Semver = typeof SemverModule;

export function loadSemver(): Promise<Semver> {
    return importLazyModule("semver", () => import("semver"));
}
