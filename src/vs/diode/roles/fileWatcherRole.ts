import { setLazyModuleLoader } from "../../base/common/lazyModule.ts";
import { loadLazyModule } from "../../base/node/lazyModule.ts";
import { runTreeWatcherSubprocess } from "../../platform/files/node/treeWatcherMain.ts";

/**
 * Watcher кусков пока не грузит; загрузчик подставляется в копию `lazyModule.ts` куска (как в
 * `extensionHostRole.ts`), чтобы роль не зависела от того, попадёт ли туда `importLazyModule`.
 */
export function runFileWatcherRole(): void {
    setLazyModuleLoader(loadLazyModule);
    runTreeWatcherSubprocess();
}
