import { createRequire } from "node:module";
import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Диагностика поверх направляющих отступа. Ошибка настоящего tsserver'а лежит на
// многострочном диапазоне (объектный литерал без обязательного поля), то есть
// накрывает отступы внутренних строк — ячейки, где уже нарисованы `│`
// направляющих фолдинга. Кадр показывает, что глиф направляющей остаётся своего
// цвета, а цвет ошибки достаётся тексту: раньше отступ превращался в красную
// полосу на всю высоту блока.
//
// Второй кадр — quick pick над тем же файлом: тело и рамка пикера должны быть
// чистыми, без просвечивающей волны из редактора под ним.

const require_ = createRequire(import.meta.url);
const sampleDir = resolve(repoRoot, "e2e", "fixtures", "diagnosticsGuides");
const mainFile = resolve(sampleDir, "main.ts");

/** Squiggle рисуется undercurl'ом (StyleFlags.Undercurl === 8) на диапазоне ошибки. */
const UNDERCURL = 8;

export default defineScenario({
    name: "diagnostics-guides",
    title: "Диагностика поверх направляющих отступа и под quick pick",
    open: [sampleDir, mainFile],
    // Сервер живёт в devDeps репозитория — как в goto-definition.
    settings: {
        "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
        "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
    },
    cols: 100,
    rows: 24,
    // Extension-host сценарии гоняют subprocess + спавн сервера — Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("describe("));

        // Дождаться squiggle от НАСТОЯЩЕГО tsserver'а (холодная индексация — секунды).
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от tsserver", timeoutMs: 120_000, intervalMs: 500 },
        );
        await editor.capture("diagnostics");

        // Quick Open поверх подчёркнутого текста.
        await editor.sendKey("Ctrl+P");
        await editor.waitForText((t) => t.includes("Go to File"));
        await editor.capture("quick-pick");
    },
});
