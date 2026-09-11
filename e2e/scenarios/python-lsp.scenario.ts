import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Python из коробки: НАСТОЯЩИЙ сторонний basedpyright.vsix (фикстура с
// open-vsx) ставится штатным installVsix, его вшитый сервер даёт диагностику
// (squiggle на намеренной ошибке типов), hover с сигнатурой из другого файла
// и вьюлет REFERENCES. Демо закрывает видимую часть: сигнатура и строки
// объявления добраны из defs.py, которого нет в открытом буфере.

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "pySample");
const mainFile = resolve(sampleDir, "main.py");
const vsix = resolve(repoRoot, "e2e", "fixtures", "basedpyright", "detachhead.basedpyright-1.40.0.vsix");

/** Squiggle рисуется undercurl'ом (StyleFlags.Undercurl === 8) — сигнал «сервер поднялся». */
const UNDERCURL = 8;

export default defineScenario({
    name: "python-lsp",
    title: "Python LSP из коробки: basedpyright — squiggle, hover, references",
    open: [sampleDir, mainFile],
    installVsix: [vsix],
    cols: 100,
    rows: 24,
    // Extension-host сценарии гоняют subprocess + форк сервера — Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("reply: int"));

        // Дождаться, пока настоящий basedpyright проверит открытый файл.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от basedpyright", timeoutMs: 180_000, intervalMs: 500 },
        );
        await editor.capture("diagnostics");

        // Каретка на вызов `greet` (строка 2, колонка 15) → hover (Ctrl+K Ctrl+U):
        // сигнатура из defs.py, в буфере main.py её нет.
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        for (let i = 0; i < 15; i++) await editor.sendKey("ArrowRight");
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+U");
        await editor.waitForText((t) => t.includes("greet(name: str) -> str"), { timeoutMs: 60_000 });
        await editor.capture("hover");

        // Escape закрывает попап → Find All References (Ctrl+K Ctrl+R): ссылки
        // из двух файлов во вьюлете REFERENCES, объявление приехало из defs.py.
        await editor.sendKey("Escape");
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+R");
        await editor.waitForText((t) => t.includes("results in 2") && t.includes("def greet"), {
            timeoutMs: 120_000,
        });
        await editor.capture("references");
    },
});
