import { createRequire } from "node:module";
import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

const require_ = createRequire(import.meta.url);
const sampleDir = resolve(repoRoot, "e2e", "fixtures", "lspSample");
const mainFile = resolve(sampleDir, "main.ts");

/** StyleFlags.Undercurl. */
const UNDERCURL = 8;

export default defineScenario({
    name: "workspace-symbols",
    title: "Go to Symbol in Workspace: Ctrl+T finds a symbol through tsserver, Enter opens its file",
    open: [sampleDir, mainFile],
    settings: {
        "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
        "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
    },
    cols: 100,
    rows: 24,
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("const reply"));

        // The squiggle in main.ts says tsserver has loaded the project.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle from tsserver", timeoutMs: 120_000, intervalMs: 500 },
        );

        await editor.sendKey("Ctrl+T");
        await editor.waitForNode("#quickInput");
        await editor.sendText("greet");
        await editor.waitForText((t) => t.includes("greet") && t.includes("defs.ts"), { timeoutMs: 60_000 });
        await editor.capture("symbol-found");

        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes('return "hi " + name'));
        await editor.waitForText((t) => t.includes("Ln 1, Col"));
        await editor.capture("file-opened");
    },
});
