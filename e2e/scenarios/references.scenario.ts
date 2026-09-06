import { createRequire } from "node:module";
import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Find All References поверх стокового typescript-language-server: Ctrl+K Ctrl+R
// на символе собирает ссылки из двух файлов во вьюлет REFERENCES, Enter уводит
// в файл ссылки, F4 идёт к следующей. Демо закрывает видимую часть фичи —
// строки кода в панели добраны из файла, которого нет в открытом буфере.

const require_ = createRequire(import.meta.url);
const sampleDir = resolve(repoRoot, "e2e", "fixtures", "lspSample");
const mainFile = resolve(sampleDir, "main.ts");

/** Squiggle рисуется undercurl'ом (StyleFlags.Undercurl === 8) — сигнал «сервер поднялся». */
const UNDERCURL = 8;

export default defineScenario({
    name: "references",
    title: "Find All References: ссылки из двух файлов в сайдбаре, F4 по ним",
    open: [sampleDir, mainFile],
    // Сервер живёт в devDeps репозитория (в SEA не пакуется — см. docs/TODO/LSP.md).
    settings: {
        "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
        "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
    },
    cols: 100,
    rows: 24,
    // Extension-host сценарии гоняют subprocess + спавн сервера — Linux only.
    skipOn: ["win32", "darwin"],
    // Collapse All живёт в «⋯»-меню заголовка; для демо биндим его на F-клавишу
    // (меню открывается мышью, а сценарий — клавиатурный).
    userKeybindings: [{ key: "f7", command: "references-view.collapseAll" }],
    async run(editor) {
        await editor.waitForText((t) => t.includes("const reply"));

        // Дождаться, пока настоящий tsserver проиндексирует проект.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от tsserver", timeoutMs: 120_000, intervalMs: 500 },
        );

        // Каретка на вызов `greet` (строка 2, колонка 23) → Find All References.
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        for (let i = 0; i < 23; i++) await editor.sendKey("ArrowRight");
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+R");

        // Вьюлет REFERENCES: файлы со счётчиком, под ними строки кода с
        // подсвеченным вхождением. Объявление приехало из defs.ts.
        await editor.waitForText((t) => t.includes("results in 2") && t.includes("export function greet"), {
            timeoutMs: 120_000,
        });
        await editor.capture("results");

        // Collapse All — только файлы со счётчиками.
        await editor.sendKey("F7");
        await editor.waitForText((t) => !t.includes("export function greet"));
        await editor.capture("collapsed");

        // Раскрыть обратно и пройтись по ссылкам: F4 уводит редактор к
        // следующей — панель при этом остаётся на месте. Порядок ссылок задаёт
        // сервер, поэтому кадр снимаем после обхода, не привязываясь к файлу.
        await editor.sendKey("F7");
        await editor.sendKey("F4");
        await editor.sendKey("F4");
        await editor.waitForText((t) => t.includes("results in 2"));
        await editor.capture("navigated");
    },
});
