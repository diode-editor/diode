import { setLazyModuleLoader } from "../../base/common/lazyModule.ts";
import { loadLazyModule } from "../../base/node/lazyModule.ts";
import { runTreeWatcherSubprocess } from "../../platform/files/node/treeWatcherMain.ts";

/**
 * The watcher loads no lazy chunks yet; the loader is injected into the chunk's copy of `lazyModule.ts` (as in
 * `extensionHostRole.ts`) so the role does not depend on whether `importLazyModule` ends up there.
 */
export function runFileWatcherRole(): void {
    setLazyModuleLoader(loadLazyModule);
    runTreeWatcherSubprocess();
}
