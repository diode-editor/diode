import oniguruma from "vscode-oniguruma";
import type { IOnigLib } from "vscode-textmate";

import type { IAssetAccess } from "../../../../base/common/assets/iAssetAccess.ts";

// `loadWASM` mutates the module's global state, exactly once per process.

let onigLibPromise: Promise<IOnigLib> | undefined;

export function getOnigLib(assets: IAssetAccess): Promise<IOnigLib> {
    onigLibPromise ??= loadOnigLib(assets);
    return onigLibPromise;
}

async function loadOnigLib(assets: IAssetAccess): Promise<IOnigLib> {
    const wasmBytes = await assets.read("onig.wasm");
    // An instantiator, not bytes: with bytes `loadWASM` checks `instanceof Response`,
    // and the lazy `Response` global loads undici together with `http` (~40 ms at startup).
    // Copy: `instantiate` is typed for a buffer over `ArrayBuffer`, while the asset is `ArrayBufferLike`.
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
