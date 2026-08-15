import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { BundleAssetAccess } from "../../common/assets/bundleAssetAccess.ts";
import { BUNDLE_FILE_NAME, tryReadBundleFile } from "../../common/assets/bundleFile.ts";
import type { IAssetAccess } from "../../common/assets/iAssetAccess.ts";

import { FsAssetAccess } from "./fsAssetAccess.ts";
import { entryDir } from "./packagedRuntime.ts";

const SEA_BUNDLE_KEY = BUNDLE_FILE_NAME;

/**
 * Возвращает {@link IAssetAccess} для текущего рантайма — три источника одного
 * и того же `diode.bundle`, по убыванию приоритета:
 *
 *   - **SEA-бинарь** (`node:sea.isSea() === true`) — бандл встроен в исполняемый
 *     файл, достаётся через `sea.getAsset()`;
 *   - **self-extract** — бандл лежит файлом рядом с `main.js` (см.
 *     `scripts/build-selfextract.mjs`); формат тот же, меняется только источник байтов;
 *   - **dev/tests** — {@link FsAssetAccess} с mapping'ом на реальные файлы
 *     в `extensions/` и `node_modules/vscode-oniguruma`.
 *
 * `node:sea` доступен только через `require()` внутри SEA-сборки —
 * статический ESM-импорт падает даже в работающем SEA executable
 * (`mainFormat: "module"`).
 */
export function createDefaultAssetAccess(): IAssetAccess {
    const seaBundle = tryLoadSeaBundle();
    if (seaBundle !== null) return new BundleAssetAccess(seaBundle);

    const dir = entryDir();
    const fileBundle = dir === null ? null : tryReadBundleFile(dir);
    if (fileBundle !== null) return new BundleAssetAccess(fileBundle);

    return createDevAssetAccess();
}

function tryLoadSeaBundle(): Uint8Array | null {
    try {
        const req = createRequire("file:///");
        const sea = req("node:sea") as { isSea(): boolean; getAsset(key: string): ArrayBuffer };
        if (!sea.isSea()) return null;
        const buffer = sea.getAsset(SEA_BUNDLE_KEY);
        return new Uint8Array(buffer);
    } catch {
        return null;
    }
}

/**
 * Создаёт {@link FsAssetAccess} для dev/test режима. Резолвит реальные пути
 * к `extensions/` и `node_modules/vscode-oniguruma/.../onig.wasm`
 * относительно расположения этого файла.
 */
export function createDevAssetAccess(): FsAssetAccess {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // src/vs/base/node/assets → корень репозитория
    const repoRootDir = path.resolve(here, "..", "..", "..", "..", "..");
    const builtinDir = path.resolve(repoRootDir, "extensions");

    const require = createRequire(import.meta.url);
    const onigWasmPath = require.resolve("vscode-oniguruma/release/onig.wasm");

    return new FsAssetAccess({
        "Extensions/builtin/": builtinDir,
        "onig.wasm": onigWasmPath,
    });
}
