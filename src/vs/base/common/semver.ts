import type * as SemverModule from "semver";

import { importLazyModule } from "./lazyModule.ts";

/**
 * Ленивый кусок: первому кадру не нужен. Синхронные потребители получают модуль
 * параметром от `await loadSemver()` — так загрузку не забыть.
 */
export type Semver = typeof SemverModule;

export function loadSemver(): Promise<Semver> {
    return importLazyModule("semver", () => import("semver"));
}
