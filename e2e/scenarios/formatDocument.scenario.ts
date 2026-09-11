import { createRequire } from "node:module";
import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Format Document (Shift+Alt+F) поверх стокового typescript-language-server:
// каша из пробелов в буфере приводится правками настоящего tsserver'а (#196).
// Кадры: до (с undercurl-диагностикой — сервер жив) и после форматирования.

const require_ = createRequire(import.meta.url);
const sampleDir = resolve(repoRoot, "e2e", "fixtures", "formatSample");
const mainFile = resolve(sampleDir, "main.ts");

/** Squiggle рисуется undercurl'ом (StyleFlags.Undercurl === 8) на диапазоне ошибки. */
const UNDERCURL = 8;

export default defineScenario({
    name: "format-document",
    title: "Format Document (Shift+Alt+F): правки стокового typescript-language-server",
    open: [sampleDir, mainFile],
    settings: {
        "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
        "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
    },
    cols: 100,
    rows: 24,
    // Extension-host сценарии гоняют subprocess + спавн сервера — Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("function   greet"));

        // Readiness: undercurl от НАСТОЯЩЕГО tsserver'а (ошибка типов в 1-й строке).
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от tsserver", timeoutMs: 120_000, intervalMs: 500 },
        );
        await editor.capture("before");

        // Shift+Alt+F legacy-терминал не передаёт (ESC F без shift-флага) —
        // жмём досягаемый чорд Ctrl+K Ctrl+E, второй бинд той же команды.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+E");
        await editor.waitForText((t) => t.includes("function greet(name: string) {"), { timeoutMs: 60_000 });
        await editor.capture("after");
    },
});
