import { createRequire } from "node:module";
import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Автодополнение от стокового typescript-language-server: набор `.` сам
// открывает попап с членами типа (триггер-символ объявляет сервер), а Ctrl+Space
// при открытом попапе разворачивает панель описания сбоку.
//
// Демо обязательное: юнит-тесты видят данные, но не кадр — а именно на кадре
// видно, что список не схлопнулся фильтром и панель встала рядом, а не поверх.

const require_ = createRequire(import.meta.url);
/** Squiggle рисуется undercurl'ом (StyleFlags.Undercurl === 8) на диапазоне ошибки. */
const UNDERCURL = 8;

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "lspSample");
const mainFile = resolve(sampleDir, "main.ts");

export default defineScenario({
    name: "lsp-completion",
    title: "Stock typescript-language-server: completions + details panel",
    open: [sampleDir, mainFile],
    // Сервер живёт в devDeps репозитория (в SEA не пакуется — см. docs/TODO/LSP.md).
    settings: {
        "vexx.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
        "vexx.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
    },
    cols: 100,
    rows: 24,
    // Extension-host сценарии гоняют subprocess + спавн сервера — Linux only,
    // как goto-definition / editorconfig-stock.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("const reply"));

        // Сначала дожидаемся, что сервер поднялся и проиндексировал проект:
        // squiggle от настоящего tsserver — тот же readiness-сигнал, что в
        // сценарии goto-definition. Без него набор уходит в пустоту: провайдер
        // ещё не зарегистрирован, и попап открывается словами из буфера.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от tsserver (сервер готов)", timeoutMs: 120_000, intervalMs: 500 },
        );

        // В конец файла, на пустую строку — там наберём выражение.
        for (let i = 0; i < 6; i++) await editor.sendKey("ArrowDown");
        await editor.sendKey("End");
        await editor.sendKey("Enter");
        for (const key of ["r", "e", "p", "l", "y", "."]) await editor.sendKey(key);

        // Точка — триггер-символ сервера: попап открывается сам, без Ctrl+Space.
        // Холодный tsserver индексирует проект секундами.
        await editor.waitForText((t) => t.includes("toFixed"), { timeoutMs: 120_000 });
        await editor.capture("completion");

        // Ctrl+Space при открытом попапе — тумблер панели описания. Ждём именно
        // текст сигнатуры от сервера (`(method) Number.toFixed…`): он приезжает
        // отдельным resolve-запросом уже после показа списка, и снимать кадр
        // раньше — значит снять пустую панель.
        await editor.sendKey("Ctrl+Space");
        await editor.waitForText((t) => t.includes("(method)"), { timeoutMs: 30_000 });
        await editor.capture("completion-details");
    },
});
