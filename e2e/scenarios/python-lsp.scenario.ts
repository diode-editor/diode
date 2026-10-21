import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Сигнатура и строки объявления добираются из defs.py, которого нет в открытом буфере.

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "pySample");
const mainFile = resolve(sampleDir, "main.py");

/** StyleFlags.Undercurl. */
const UNDERCURL = 8;

export default defineScenario({
    name: "python-lsp",
    title: "Python LSP из коробки: basedpyright — squiggle, hover, references",
    open: [sampleDir, mainFile],
    installVsix: ["detachhead.basedpyright"],
    network: true,
    cols: 100,
    rows: 24,
    // Extension-host сценарии гоняют subprocess + форк сервера — Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("reply: int"));

        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от basedpyright", timeoutMs: 180_000, intervalMs: 500 },
        );
        await editor.capture("diagnostics");

        // На вызов `greet` (строка 2, колонка 15) → hover.
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        for (let i = 0; i < 15; i++) await editor.sendKey("ArrowRight");
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+U");
        await editor.waitForText((t) => t.includes("greet(name: str) -> str"), { timeoutMs: 60_000 });
        await editor.capture("hover");

        await editor.sendKey("Escape");
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+R");
        await editor.waitForText((t) => t.includes("results in 2") && t.includes("def greet"), {
            timeoutMs: 120_000,
        });
        await editor.capture("references");
    },
});
