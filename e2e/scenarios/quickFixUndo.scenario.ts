import { createRequire } from "node:module";
import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// The server sends the removal of one import name as two adjacent ranges on the line — the inverse edits
// collapse into one point; Ctrl+Z must restore the line verbatim, not `import { alphazeta,  }`.

const require_ = createRequire(import.meta.url);
const sampleDir = resolve(repoRoot, "e2e", "fixtures", "quickfixUndoSample");
const mainFile = resolve(sampleDir, "main.ts");

/** StyleFlags.Undercurl. */
const UNDERCURL = 8;

const BOTH_IMPORT = 'import { alpha, zeta } from "./both";';
const BOTH_IMPORT_FIXED = 'import { alpha } from "./both";';

export default defineScenario({
    name: "quick-fix-undo",
    title: "Undo after a quick fix: Ctrl+Z restores the import line verbatim",
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
        await editor.waitForText((t) => t.includes(BOTH_IMPORT));

        // Readiness: an undercurl from the REAL tsserver.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "tsserver undercurl squiggle", timeoutMs: 120_000, intervalMs: 500 },
        );
        await editor.capture("before");

        // Onto `zeta` (column 16).
        for (let i = 0; i < 16; i++) await editor.sendKey("ArrowRight");
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+Q");
        await editor.waitForText((t) => t.includes("Select Code Action"), { timeoutMs: 60_000 });
        await editor.sendText("Remove unused declaration");
        await editor.waitForText((t) => t.includes("Remove unused declaration"));

        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes(BOTH_IMPORT_FIXED), { timeoutMs: 60_000 });
        await editor.capture("fixed");

        await editor.sendKey("Ctrl+Z");
        // A scrambled buffer has the same characters: containing the line is not enough, also wait for the glued text
        // to be gone.
        await editor.waitForText((t) => t.includes(BOTH_IMPORT) && !t.includes("alphazeta"), { timeoutMs: 30_000 });
        await editor.capture("undone");
    },
});
