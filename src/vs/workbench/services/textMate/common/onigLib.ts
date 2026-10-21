import oniguruma from "vscode-oniguruma";
import type { IOnigLib } from "vscode-textmate";

import type { IAssetAccess } from "../../../../base/common/assets/iAssetAccess.ts";

// `loadWASM` мутирует глобальное состояние модуля — ровно один раз за процесс.

let onigLibPromise: Promise<IOnigLib> | undefined;

export function getOnigLib(assets: IAssetAccess): Promise<IOnigLib> {
    onigLibPromise ??= loadOnigLib(assets);
    return onigLibPromise;
}

async function loadOnigLib(assets: IAssetAccess): Promise<IOnigLib> {
    const wasmBytes = await assets.read("onig.wasm");
    // Инстанциатор, а не байты: с байтами `loadWASM` проверяет `instanceof Response`,
    // а ленивый глобал `Response` грузит undici вместе с `http` (~40 мс на старте).
    // Копия: `instantiate` типизирован на буфер поверх `ArrayBuffer`, а ассет — `ArrayBufferLike`.
    const wasm = new Uint8Array(wasmBytes);
    await oniguruma.loadWASM({ instantiator: (imports) => WebAssembly.instantiate(wasm, imports) });
    return {
        createOnigScanner(patterns: string[]) {
            return oniguruma.createOnigScanner(patterns);
        },
        createOnigString(s: string) {
            return oniguruma.createOnigString(s);
        },
    };
}
