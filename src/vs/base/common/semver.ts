import type * as SemverModule from "semver";

import { importLazyModule } from "./lazyModule.ts";

/**
 * A lazy chunk: the first frame doesn't need it. Synchronous consumers get the module
 * as a parameter from `await loadSemver()`, so the load can't be forgotten.
 */
export type Semver = typeof SemverModule;

export function loadSemver(): Promise<Semver> {
    return importLazyModule("semver", () => import("semver"));
}
