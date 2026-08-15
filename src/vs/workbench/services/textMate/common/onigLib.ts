import oniguruma from "vscode-oniguruma";
import type { IOnigLib } from "vscode-textmate";

import type { IAssetAccess } from "../../../../base/common/assets/iAssetAccess.ts";

/**
 * Singleton initializer for the `vscode-oniguruma` WASM regex engine.
 *
 * `loadWASM` мутирует глобальное состояние модуля и должен вызываться ровно
 * один раз за процесс. Возвращаемый `IOnigLib` совместим с
 * `vscode-textmate` `RegistryOptions.onigLib`. Источник `onig.wasm` —
 * абстракция {@link IAssetAccess}: в dev/tests читаем из реальной FS,
 * в SEA-сборке — из встроенного `diode.bundle`.
 */

let onigLibPromise: Promise<IOnigLib> | undefined;

export function getOnigLib(assets: IAssetAccess): Promise<IOnigLib> {
    onigLibPromise ??= loadOnigLib(assets);
    return onigLibPromise;
}

async function loadOnigLib(assets: IAssetAccess): Promise<IOnigLib> {
    const wasmBytes = await assets.read("onig.wasm");
    await oniguruma.loadWASM(wasmBytes);
    return {
        createOnigScanner(patterns: string[]) {
            return oniguruma.createOnigScanner(patterns);
        },
        createOnigString(s: string) {
            return oniguruma.createOnigString(s);
        },
    };
}
