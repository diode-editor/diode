import { createRequire } from "node:module";
import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// #196. Via the command palette: Shift+Alt+O exists only on kitty/csi-u, and the headless session key DSL
// can't serialize it.

const require_ = createRequire(import.meta.url);
const sampleDir = resolve(repoRoot, "e2e", "fixtures", "organizeSample");
const mainFile = resolve(sampleDir, "main.ts");

/** StyleFlags.Undercurl. */
const UNDERCURL = 8;

const ALPHA_IMPORT = 'import { alpha } from "./alpha";';
const ZETA_IMPORT = 'import { zeta } from "./zeta";';

export default defineScenario({
    name: "organize-imports",
    title: "Organize Imports: source action of the stock typescript-language-server",
    open: [sampleDir, mainFile],
    settings: {
        "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
        "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
    },
    cols: 100,
    rows: 24,
    // Extension host scenarios run a subprocess + server spawn: Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes(ZETA_IMPORT));

        // Readiness: an undercurl from the real tsserver.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "tsserver undercurl squiggle", timeoutMs: 120_000, intervalMs: 500 },
        );
        await editor.capture("before");

        await editor.sendKey("Ctrl+P");
        await editor.sendText(">Organize Imports");
        await editor.waitForText((t) => t.includes("Organize Imports"));
        await editor.capture("palette");
        await editor.sendKey("Enter");

        await editor.waitForText(
            (t) => t.indexOf(ALPHA_IMPORT) >= 0 && t.indexOf(ALPHA_IMPORT) < t.indexOf(ZETA_IMPORT),
            { timeoutMs: 60_000 },
        );
        await editor.capture("after");
    },
});
