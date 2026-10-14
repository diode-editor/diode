import { setLazyModuleLoader } from "../../base/common/lazyModule.ts";
import { loadLazyModule } from "../../base/node/lazyModule.ts";
import { runTreeWatcherSubprocess } from "../../platform/files/node/treeWatcherMain.ts";

/**
 * Роль file watcher (`DIODE_FILE_WATCHER=1`) — вход ленивого куска
 * `roles/file-watcher` (`scripts/build-lazy-chunks.mjs`). Как и у extension host'а
 * (`extensionHostRole.ts`): общие с редактором модули у куска свои, поэтому
 * загрузчик ленивых кусков подставляется в его копию `base/common/lazyModule.ts`.
 * Сейчас watcher кусков не грузит; подстановка — чтобы роль не зависела от того,
 * что в её граф когда-нибудь попадёт `importLazyModule`.
 */
export function runFileWatcherRole(): void {
    setLazyModuleLoader(loadLazyModule);
    runTreeWatcherSubprocess();
}
