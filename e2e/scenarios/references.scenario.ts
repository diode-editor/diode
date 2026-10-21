import { createRequire } from "node:module";
import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Строки кода в панели добираются из файла, которого нет в открытом буфере.

const require_ = createRequire(import.meta.url);
const sampleDir = resolve(repoRoot, "e2e", "fixtures", "lspSample");
const mainFile = resolve(sampleDir, "main.ts");

/** StyleFlags.Undercurl. */
const UNDERCURL = 8;

export default defineScenario({
    name: "references",
    title: "Find All References: ссылки из двух файлов в сайдбаре, F4 по ним",
    open: [sampleDir, mainFile],
    // Сервер живёт в devDeps репозитория (вшитый — docs/arch/Extensions.md, «Builtin LSP-клиент»).
    settings: {
        "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
        "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
    },
    cols: 100,
    rows: 24,
    // Extension-host сценарии гоняют subprocess + спавн сервера — Linux only.
    skipOn: ["win32", "darwin"],
    // Collapse All живёт в «⋯»-меню, а оно открывается мышью — для демо он на F-клавише.
    userKeybindings: [{ key: "f7", command: "references-view.collapseAll" }],
    async run(editor) {
        await editor.waitForText((t) => t.includes("const reply"));

        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от tsserver", timeoutMs: 120_000, intervalMs: 500 },
        );

        // На вызов `greet` (строка 2, колонка 23).
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

        // Порядок ссылок задаёт сервер — кадр снимаем после обхода, не привязываясь к файлу.
        await editor.sendKey("F7");
        await editor.sendKey("F4");
        await editor.sendKey("F4");
        await editor.waitForText((t) => t.includes("results in 2"));
        await editor.capture("navigated");
    },
});
