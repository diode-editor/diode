import { createRequire } from "node:module";
import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// #196. The Ctrl+K Ctrl+Q chord is the second binding, reachable on legacy terminals: without the kitty protocol a
// terminal cannot encode Ctrl+.

const require_ = createRequire(import.meta.url);
const sampleDir = resolve(repoRoot, "e2e", "fixtures", "quickfixSample");
const mainFile = resolve(sampleDir, "main.ts");

/** StyleFlags.Undercurl. */
const UNDERCURL = 8;

const ZETA_IMPORT = 'import { zeta } from "./zeta";';

export default defineScenario({
    name: "quick-fix",
    title: "Quick Fix (Ctrl+K Ctrl+Q): действия стокового typescript-language-server у каретки",
    open: [sampleDir, mainFile],
    settings: {
        "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
        "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
    },
    cols: 100,
    rows: 24,
    // Extension host scenarios run a subprocess + a spawned server — Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes(ZETA_IMPORT));

        // Readiness: an undercurl from the real tsserver.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от tsserver", timeoutMs: 120_000, intervalMs: 500 },
        );
        await editor.capture("before");

        // Opening puts the cursor at (0,0) — on the import line.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+Q");
        await editor.waitForText((t) => t.includes("Select Code Action"), { timeoutMs: 60_000 });
        // Pin the wanted action by typing into the filter — item order is up to the server.
        await editor.sendText("Remove import");
        await editor.waitForText((t) => t.includes("Remove import"));
        await editor.capture("menu");

        await editor.sendKey("Enter");
        // The import must be gone from the buffer, not just hidden behind the menu overlay.
        await editor.waitForText(
            (t) => !t.includes("Code Actions") && !t.includes(ZETA_IMPORT) && t.includes("export const kept"),
            { timeoutMs: 60_000 },
        );
        await editor.capture("after");
    },
});
