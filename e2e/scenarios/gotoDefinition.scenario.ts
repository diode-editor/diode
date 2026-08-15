import { createRequire } from "node:module";
import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Стоковый typescript-language-server поверх builtin `diode-lsp-typescript`
// (стоковый vscode-languageclient в бандле): диагностика настоящего tsserver'а
// доезжает до squiggle + панели Problems, F12 прыгает к определению в другой
// файл. Демо закрывает видимую половину LSP-стека — то, что юнит-тесты по
// устройству не видят (урок #194: тест обязан дойти до кадра).

const require_ = createRequire(import.meta.url);
const sampleDir = resolve(repoRoot, "e2e", "fixtures", "lspSample");
const mainFile = resolve(sampleDir, "main.ts");

/** Squiggle рисуется undercurl'ом (StyleFlags.Undercurl === 8) на диапазоне ошибки. */
const UNDERCURL = 8;

export default defineScenario({
    name: "goto-definition",
    title: "Stock typescript-language-server: diagnostics + Go to Definition (F12)",
    open: [sampleDir, mainFile],
    // Сервер живёт в devDeps репозитория (в SEA не пакуется — см. docs/TODO/LSP.md),
    // путь передаётся настройками; tsserver.js — для песочниц без своего TypeScript.
    settings: {
        "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
        "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
    },
    cols: 100,
    rows: 24,
    // Extension-host сценарии гоняют subprocess + спавн сервера — Linux only,
    // как editorconfig-stock / region-folding.
    skipOn: ["win32", "darwin"],
    // Показ output-канала LS без ухода фокуса через палитру/меню.
    userKeybindings: [{ key: "alt+t", command: "workbench.action.output.show.extensions.typescript-diode" }],
    async run(editor) {
        await editor.waitForText((t) => t.includes("const reply"));

        // Дождаться squiggle от НАСТОЯЩЕГО tsserver'а (холодная индексация — секунды)
        // и показать текст ошибки в панели Problems.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от tsserver", timeoutMs: 120_000, intervalMs: 500 },
        );
        await editor.sendKey("Ctrl+J");
        await editor.waitForText((t) => /not assignable/i.test(t));
        await editor.capture("diagnostics");

        // Каретка на вызов `greet` (строка 2, колонка 23) → F12 → объявление в defs.ts.
        await editor.sendKey("Ctrl+J"); // спрятать панель, вернуть фокус редактору
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        for (let i = 0; i < 23; i++) await editor.sendKey("ArrowRight");
        await editor.sendKey("F12");
        await editor.waitForText((t) => t.includes('return "hi " + name'), { timeoutMs: 60_000 });
        await editor.capture("definition");

        // Output-канал клиента (`window.createOutputChannel` — настоящий):
        // строки languageclient'а видны отдельным каналом «TypeScript (Diode)».
        // Ctrl+K Ctrl+H открывает панель OUTPUT, Alt+T переключает селектор на
        // канал (команда show.<id> переключает канал, панель открываем штатно).
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+H");
        await editor.waitForText((t) => t.includes("OUTPUT"));
        await editor.sendKey("Alt+T");
        await editor.waitForText((t) => t.includes("language server started"), { timeoutMs: 30_000 });
        await editor.capture("output");
    },
});
