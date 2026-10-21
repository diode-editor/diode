import { createRequire } from "node:module";
import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Языковые пункты гейтятся `editorHas*Provider`, поэтому файл — с живым стоковым typescript-language-server.

const require_ = createRequire(import.meta.url);
const sampleDir = resolve(repoRoot, "e2e", "fixtures", "lspSample");
const mainFile = resolve(sampleDir, "main.ts");

/** StyleFlags.Undercurl — признак живого сервера. */
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

        // До старта сервера провайдеров нет — в меню только пункты, которым они не нужны.
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
