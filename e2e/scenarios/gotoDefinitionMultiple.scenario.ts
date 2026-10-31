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
    name: "goto-definition-multiple",
    title: "Go to Definition: several targets go to the References panel, one target is a jump",
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

        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle from tsserver", timeoutMs: 120_000, intervalMs: 500 },
        );

        // One target, the `greet` call (line 2, column 23): a plain jump, no panel.
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        for (let i = 0; i < 23; i++) await editor.sendKey("ArrowRight");
        await editor.sendKey("F12");
        await editor.waitForText((t) => t.includes('return "hi " + name'), { timeoutMs: 60_000 });
        await editor.capture("one-target");
        await editor.sendKey("Ctrl+W");
        await editor.waitForText((t) => t.includes("const reply"));

        // `f` in the import (line 0, column 9), not in the call: at a call site tsserver itself answers with
        // the one resolved overload. Here it names two signatures and the implementation: three rows.
        await editor.sendKey("Ctrl+Home");
        for (let i = 0; i < 9; i++) await editor.sendKey("ArrowRight");
        await editor.sendKey("F12");
        await editor.waitForText((t) => t.includes("Definitions") && t.includes("3 results in 1 file"), {
            timeoutMs: 60_000,
        });
        await editor.capture("several-targets");

        // Enter on the active row opens the target.
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes('return "hi " + name'), { timeoutMs: 10_000 });
        await editor.capture("target-opened");
    },
});
