import { createRequire } from "node:module";
import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Hover от стокового typescript-language-server: Alt+Q показывает
// попап с типом символа под кареткой.
//
// Демо обязательное: юнит-тесты видят данные, но не кадр — а именно на кадре
// видно, что попап встал у каретки, рамка не съехала и текст не обрезан.

const require_ = createRequire(import.meta.url);
/** Squiggle рисуется undercurl'ом (StyleFlags.Undercurl === 8) на диапазоне ошибки. */
const UNDERCURL = 8;

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "lspSample");
const mainFile = resolve(sampleDir, "main.ts");

export default defineScenario({
    name: "hover",
    title: "Stock typescript-language-server: hover popup",
    open: [sampleDir, mainFile],
    // Сервер живёт в devDeps репозитория (в SEA не пакуется — см. docs/TODO/LSP.md).
    settings: {
        "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
        "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
    },
    cols: 100,
    rows: 24,
    // Extension-host сценарии гоняют subprocess + спавн сервера — Linux only,
    // как goto-definition / lsp-completion.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("const reply"));

        // Ждём readiness настоящего tsserver'а: squiggle — сигнал «сервер
        // проиндексировал проект», без него hover-провайдер ещё не зарегистрирован.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от tsserver (сервер готов)", timeoutMs: 120_000, intervalMs: 500 },
        );

        // Каретка на `greet` в вызове (строка 2, колонка 23) и Alt+Q.
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        for (let i = 0; i < 23; i++) await editor.sendKey("ArrowRight");
        await editor.sendKey("Alt+Q");

        // Сигнатура для call-site импортированного символа —
        // `(alias) greet(name: string): string`: этого текста нет в буфере
        // main.ts, кадр без работающего hover'а её показать не может.
        await editor.waitForText((t) => t.includes("(alias) greet(name: string): string"), { timeoutMs: 60_000 });
        await editor.capture("hover");
    },
});
