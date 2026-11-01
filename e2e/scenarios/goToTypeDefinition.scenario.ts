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
    name: "go-to-type-definition",
    title: "Go to Type Definition: from the palette, a variable leads to its interface",
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

        // `s` in `export const s: Shape` (line 17, column 14).
        await editor.sendKey("Ctrl+End");
        await editor.sendKey("ArrowUp");
        await editor.sendKey("Home");
        for (let i = 0; i < 13; i++) await editor.sendKey("ArrowRight");
        await editor.capture("caret-on-variable");

        await editor.sendKey("Ctrl+Shift+P");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Go to Type Definition");
        await editor.waitForText((t) => t.includes("Go to Type Definition"));
        await editor.capture("palette");
        await editor.sendKey("Enter");

        // The status bar shows the jump: line 1 of the same file, `Shape` in `export interface Shape`.
        await editor.waitForText((t) => t.includes("Ln 1, Col 18"), { timeoutMs: 60_000 });
        await editor.capture("interface-shape");
    },
});
