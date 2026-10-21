import { setLazyModuleLoader } from "../../base/common/lazyModule.ts";
import { loadLazyModule } from "../../base/node/lazyModule.ts";
import { runExtensionHostSubprocess } from "../../workbench/services/extensions/node/extensionHostSubprocess.ts";

/**
 * The chunk carries its own copy of modules shared with the editor, so the lazy chunk loader is injected
 * again: the injection from `main.ts` landed in the `main.cjs` copy, and `encoding.ts` here would look for
 * iconv in node_modules, which the packaged build does not have.
 */
export function runExtensionHostRole(): void {
    setLazyModuleLoader(loadLazyModule);
    runExtensionHostSubprocess();
}
