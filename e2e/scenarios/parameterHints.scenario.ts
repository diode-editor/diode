import { createRequire } from "node:module";
import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Подсказка параметров от стокового typescript-language-server: набранная «(»
// открывает попап над строкой вызова, запятая переводит подсветку на следующий
// параметр.
//
// Демо обязательное: юнит-тесты видят данные, но не кадр — а именно на кадре
// видно, что попап встал НАД кареткой (не подрался с автодополнением), рамка не
// съехала и активный параметр действительно подсвечен.

const require_ = createRequire(import.meta.url);
/** Squiggle рисуется undercurl'ом (StyleFlags.Undercurl === 8) на диапазоне ошибки. */
const UNDERCURL = 8;

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "lspHints");
const mainFile = resolve(sampleDir, "main.ts");

/**
 * Набор ПОСИМВОЛЬНО: подсказка открывается на набранный триггер-символ, а
 * вставка блока (`sendText` целой строкой) — намеренно не набор (та же
 * эвристика, что у автодополнения; в VS Code вставка тоже не открывает попап).
 */
async function type_(editor: { sendText(value: string): Promise<void> }, text: string): Promise<void> {
    for (const char of text) await editor.sendText(char);
}

export default defineScenario({
    name: "parameter-hints",
    title: "Stock typescript-language-server: parameter hints",
    open: [sampleDir, mainFile],
    // Сервер живёт в devDeps репозитория (в SEA не пакуется — см. docs/TODO/LSP.md).
    settings: {
        "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
        "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
    },
    cols: 100,
    rows: 24,
    // Extension-host сценарии гоняют subprocess + спавн сервера — Linux only,
    // как goto-definition / hover / references.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("const label"));

        // Ждём readiness настоящего tsserver'а: squiggle — сигнал «сервер
        // проиндексировал проект», без него провайдер ещё не зарегистрирован.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от tsserver (сервер готов)", timeoutMs: 120_000, intervalMs: 500 },
        );

        // Набираем вызов перегруженной функции в конце файла: «(» — триггер-символ
        // сервера, подсказка открывается сама. Рядом всплывает и попап
        // автодополнения — они намеренно расходятся по разные стороны каретки.
        await editor.sendKey("Ctrl+End");
        await type_(editor, "describe(");
        await editor.waitForText((t) => t.includes("1/2 describe(what: string): string"), { timeoutMs: 60_000 });
        await editor.capture("parameter-hints");

        // Escape принадлежит попапу автодополнения, пока тот показан, — подсказка
        // остаётся; стрелка вниз листает перегрузки (счётчик 1/2 → 2/2).
        await editor.sendKey("Escape");
        await editor.sendKey("ArrowDown");
        await editor.waitForText((t) => t.includes("2/2 describe(what: string, times: number): string"), {
            timeoutMs: 60_000,
        });
        await editor.capture("parameter-hints-overload");
    },
});
