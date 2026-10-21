import { createRequire } from "node:module";
import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Language items are gated by `editorHas*Provider`, so the file runs with a live stock typescript-language-server.

const require_ = createRequire(import.meta.url);
const sampleDir = resolve(repoRoot, "e2e", "fixtures", "lspSample");
const mainFile = resolve(sampleDir, "main.ts");

/** StyleFlags.Undercurl: a sign the server is live. */
const UNDERCURL = 8;

export default defineScenario({
    name: "editor-context-menu",
    title: "Контекст-меню редактора: состав как в VS Code (с живым языковым сервером)",
    open: [sampleDir, mainFile],
    settings: {
        "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
        "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
    },
    cols: 100,
    rows: 32,
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("const reply"));

        // Before the server starts there are no providers, so the menu has only items that don't need them.
        await editor.sendKey("Shift+F10");
        await editor.waitForText((t) => t.includes("Command Palette"));
        await editor.capture("without-providers");
        await editor.sendKey("Escape");

        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от tsserver", timeoutMs: 120_000, intervalMs: 500 },
        );

        await waitUntil(
            async () => {
                await editor.sendKey("Shift+F10");
                const frame = await editor.captureFrame();
                const text = frame.cells.map((cell) => cell.char).join("");
                if (!text.includes("Rename Symbol")) await editor.sendKey("Escape");
                return text;
            },
            (text) =>
                text.includes("Go to Definition") &&
                text.includes("Rename Symbol") &&
                text.includes("Format Document") &&
                text.includes("Refactor"),
            { describe: "языковые пункты в контекст-меню", timeoutMs: 60_000, intervalMs: 1000 },
        );
        await editor.capture("full");
    },
});
