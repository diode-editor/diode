/**
 * Lazy chunks for common code (docs/arch/Common.md#ленивые-куски-бандла; the
 * counterpart of upstream's `importAMDNodeModule`). The real loader lives in
 * `node/`, and the entry point must install it before the first call: a bare
 * `import()` fails in the packaged build, the package isn't there.
 */

export type LazyModuleLoader = <T>(id: string, importer: () => Promise<T>) => Promise<T>;

const importDirectly: LazyModuleLoader = (_id, importer) => importer();

let loader: LazyModuleLoader = importDirectly;

/**
 * @param id package name; must be a `LAZY_CHUNKS` entry in `scripts/build-lazy-chunks.mjs`
 * @param importer `() => import("<id>")`, a literal so tsx/vitest and the types see the module
 */
export function importLazyModule<T>(id: string, importer: () => Promise<T>): Promise<T> {
    return loader(id, importer);
}

/** `undefined` means return the bare `import()`. */
export function setLazyModuleLoader(next: LazyModuleLoader | undefined): void {
    loader = next ?? importDirectly;
}
