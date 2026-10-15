import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Загрузка onig-движка — на пути к первой подсветке. `loadWASM` с байтами
// проверяет `instanceof Response`, а ленивый глобал `Response` тянет undici
// вместе с `http` (~40 мс на старте). Проверка — в свежем процессе: в воркере
// vitest undici может быть уже загружен кем угодно.

const REPO_ROOT = fileURLToPath(new URL("../../../../../..", import.meta.url));
const ONIG_LIB = new URL("./onigLib.ts", import.meta.url).href;
const ASSETS = new URL("../../../../base/node/assets/createDefaultAssetAccess.ts", import.meta.url).href;

const SCRIPT = `
import { getOnigLib } from ${JSON.stringify(ONIG_LIB)};
import { createDevAssetAccess } from ${JSON.stringify(ASSETS)};
const lib = await getOnigLib(createDevAssetAccess());
const scanner = lib.createOnigScanner(["b+"]);
const match = scanner.findNextMatchSync(lib.createOnigString("abbbc"), 0);
const loaded = process.moduleLoadList.filter((m) => /\\b(http|https|undici)\\b/.test(m));
console.log(JSON.stringify({ start: match?.captureIndices[0].start, end: match?.captureIndices[0].end, loaded }));
`;

describe("getOnigLib", () => {
    it("движок работает, а undici и http при загрузке не будятся", () => {
        const out = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", SCRIPT], {
            cwd: REPO_ROOT,
            encoding: "utf8",
            timeout: 30_000,
        });
        expect(JSON.parse(out)).toEqual({ start: 1, end: 4, loaded: [] });
    });
});
