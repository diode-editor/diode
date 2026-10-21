import { createRequire } from "node:module";
import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// The dot is a server trigger character, so the popup opens by itself; Ctrl+Space with the popup open
// toggles the details panel.

const require_ = createRequire(import.meta.url);
/** StyleFlags.Undercurl. */
const UNDERCURL = 8;

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "lspSample");
const mainFile = resolve(sampleDir, "main.ts");

export default defineScenario({
    name: "lsp-completion",
    title: "Stock typescript-language-server: completions + details panel",
    open: [sampleDir, mainFile],
    // The server comes from the repo's devDeps (builtin client: docs/arch/Extensions.md, "Builtin LSP client" section).
    settings: {
        "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
        "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
    },
    cols: 100,
    rows: 24,
    // Extension host + server spawn: Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("const reply"));

        // A tsserver squiggle signals readiness: before it the provider isn't registered
        // and the popup shows buffer words.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от tsserver (сервер готов)", timeoutMs: 120_000, intervalMs: 500 },
        );

        for (let i = 0; i < 6; i++) await editor.sendKey("ArrowDown");
        await editor.sendKey("End");
        await editor.sendKey("Enter");
        for (const key of ["r", "e", "p", "l", "y", "."]) await editor.sendKey(key);

        // A cold tsserver takes seconds to index the project.
        await editor.waitForText((t) => t.includes("toFixed"), { timeoutMs: 120_000 });
        await editor.capture("completion");

        // The signature arrives via a separate resolve after the list shows;
        // without waiting the frame captures an empty panel.
        await editor.sendKey("Ctrl+Space");
        await editor.waitForText((t) => t.includes("(method)"), { timeoutMs: 30_000 });
        await editor.capture("completion-details");
    },
});
