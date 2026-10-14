import { setLazyModuleLoader } from "../../base/common/lazyModule.ts";
import { loadLazyModule } from "../../base/node/lazyModule.ts";
import { runExtensionHostSubprocess } from "../../workbench/services/extensions/node/extensionHostSubprocess.ts";

/**
 * Роль extension host (`DIODE_EXTENSION_HOST=1`) — вход ленивого куска
 * `roles/extension-host` (`scripts/build-lazy-chunks.mjs`). Реализация vscode API
 * нужна только этому процессу, поэтому она не лежит в `main.js`: редактор её не
 * парсит, а `main.ts` грузит кусок, только войдя в эту ветку.
 *
 * Общие с редактором модули (`base/common`, протокол RPC, `vscodeTypes`) кусок
 * несёт своей копией, со своим состоянием уровня модуля. Поэтому загрузчик
 * ленивых кусков подставляется заново — в копию `base/common/lazyModule.ts`
 * куска: подстановка из `main.ts` попала в копию `main.js`, и без этой строки
 * `encoding.ts` в extension host искал бы iconv в node_modules, которых в
 * упакованной сборке нет. Своё состояние роль ставит сама (обработчик
 * `setUnexpectedErrorHandler` — в {@link runExtensionHostSubprocess}).
 */
export function runExtensionHostRole(): void {
    setLazyModuleLoader(loadLazyModule);
    runExtensionHostSubprocess();
}
