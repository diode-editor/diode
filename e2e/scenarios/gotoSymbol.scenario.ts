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
    name: "go-to-symbol",
    title: "Go to Symbol in Editor: the list from tsserver, a live preview, Escape returns",
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

        await editor.sendKey("Ctrl+P");
        await editor.waitForNode("#quickInput");
        await editor.sendText("shapes.ts");
        await editor.waitForText((t) => t.includes("shapes.ts"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("export const s: Shape"));
        await editor.waitForText((t) => t.includes("Ln 1, Col 1"));

        await editor.sendKey("Ctrl+P");
        await editor.waitForNode("#quickInput");
        await editor.sendText("@");
        await editor.waitForText((t) => t.includes("Circle") && t.includes("symbols ("), { timeoutMs: 60_000 });
        await editor.capture("symbols");

        // Two rows down is `Circle`: its line lights up, the status bar still shows the cursor on line 1.
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.waitForText((t) => t.includes("Ln 1, Col 1"));
        await editor.capture("preview-line");

        await editor.sendText("Square");
        await editor.waitForText((t) => t.includes("symbols (1)"));
        await editor.capture("filtered");

        await editor.sendKey("Escape");
        await editor.waitForText((t) => t.includes("Ln 1, Col 1"));
        await editor.capture("escape-returns");
    },
});
