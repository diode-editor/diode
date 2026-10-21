import { setLazyModuleLoader } from "../../base/common/lazyModule.ts";
import { loadLazyModule } from "../../base/node/lazyModule.ts";
import { runExtensionHostSubprocess } from "../../workbench/services/extensions/node/extensionHostSubprocess.ts";

/**
 * Общие с редактором модули кусок несёт своей копией, поэтому загрузчик ленивых кусков подставляется
 * заново: подстановка из `main.ts` попала в копию `main.cjs`, и `encoding.ts` здесь искал бы iconv
 * в node_modules, которых в упакованной сборке нет.
 */
export function runExtensionHostRole(): void {
    setLazyModuleLoader(loadLazyModule);
    runExtensionHostSubprocess();
}
