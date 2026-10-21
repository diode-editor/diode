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
    name: "goto-definition",
    title: "Stock typescript-language-server: diagnostics + Go to Definition (F12)",
    open: [sampleDir, mainFile],
    // The server path from devDeps goes via settings; tsserver.js is for sandboxes without their own TypeScript.
    settings: {
        "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
        "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
    },
    cols: 100,
    rows: 24,
    skipOn: ["win32", "darwin"],
    // Shows the LS output channel without losing focus to the command palette or menu.
    userKeybindings: [
        {
            key: "alt+t",
            command: "workbench.action.output.show.extensions.diode.diode-lsp-typescript.typescript-diode",
        },
    ],
    async run(editor) {
        await editor.waitForText((t) => t.includes("const reply"));

        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle from tsserver", timeoutMs: 120_000, intervalMs: 500 },
        );
        await editor.sendKey("Ctrl+J");
        await editor.waitForText((t) => /not assignable/i.test(t));
        await editor.capture("diagnostics");

        // The `greet` call: line 2, column 23.
        await editor.sendKey("Ctrl+J"); // hide the panel, return focus to the editor
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        for (let i = 0; i < 23; i++) await editor.sendKey("ArrowRight");
        await editor.sendKey("F12");
        await editor.waitForText((t) => t.includes('return "hi " + name'), { timeoutMs: 60_000 });
        await editor.capture("definition");

        // Ctrl+K Ctrl+H opens the OUTPUT panel, Alt+T switches the selector to the client's channel (show.<id> only
        // switches the channel).
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+H");
        await editor.waitForText((t) => t.includes("OUTPUT"));
        await editor.sendKey("Alt+T");
        await editor.waitForText((t) => t.includes("language server started"), { timeoutMs: 30_000 });
        await editor.capture("output");
    },
});
