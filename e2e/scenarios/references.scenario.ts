import { createRequire } from "node:module";
import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// The code lines in the panel come from a file that is not in an open buffer.

const require_ = createRequire(import.meta.url);
const sampleDir = resolve(repoRoot, "e2e", "fixtures", "lspSample");
const mainFile = resolve(sampleDir, "main.ts");

/** StyleFlags.Undercurl. */
const UNDERCURL = 8;

export default defineScenario({
    name: "references",
    title: "Find All References: ссылки из двух файлов в сайдбаре, F4 по ним",
    open: [sampleDir, mainFile],
    // The server comes from the repo's devDeps (the built-in one: docs/arch/Extensions.md, "Builtin LSP client"
    // section).
    settings: {
        "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
        "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
    },
    cols: 100,
    rows: 24,
    // Extension host scenarios run a subprocess + a spawned server — Linux only.
    skipOn: ["win32", "darwin"],
    // Collapse All lives in the "⋯" menu, which opens by mouse — the demo puts it on an F key.
    userKeybindings: [{ key: "f7", command: "references-view.collapseAll" }],
    async run(editor) {
        await editor.waitForText((t) => t.includes("const reply"));

        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от tsserver", timeoutMs: 120_000, intervalMs: 500 },
        );

        // Onto the `greet` call (line 2, column 23).
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        for (let i = 0; i < 23; i++) await editor.sendKey("ArrowRight");
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+R");

        await editor.waitForText((t) => t.includes("results in 2") && t.includes("export function greet"), {
            timeoutMs: 120_000,
        });
        await editor.capture("results");

        await editor.sendKey("F7");
        await editor.waitForText((t) => !t.includes("export function greet"));
        await editor.capture("collapsed");

        // The server decides reference order — capture the frame after the walk, without tying it to a file.
        await editor.sendKey("F7");
        await editor.sendKey("F4");
        await editor.sendKey("F4");
        await editor.waitForText((t) => t.includes("results in 2"));
        await editor.capture("navigated");
    },
});
