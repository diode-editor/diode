import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Loading the onig engine is on the path to the first highlight. `loadWASM` with bytes
// checks `instanceof Response`, and the lazy `Response` global pulls in undici
// together with `http` (~40 ms at startup). The check runs in a fresh process: in a vitest
// worker undici may already be loaded by anyone.

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
