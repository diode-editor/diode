import { createRequire } from "node:module";
import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Лампочка code actions (индикатор в гуттере): на строке каретки с
// доступными действиями настоящего typescript-language-server загорается
// codicon-лампочка; уход на строку без действий её гасит. Меню — по Ctrl+K
// Ctrl+Q (сценарий quick-fix), лампочка — только индикатор.

const require_ = createRequire(import.meta.url);
const sampleDir = resolve(repoRoot, "e2e", "fixtures", "quickfixSample");
const mainFile = resolve(sampleDir, "main.ts");

/** Squiggle рисуется undercurl'ом (StyleFlags.Undercurl === 8) на диапазоне ошибки. */
const UNDERCURL = 8;
const LIGHTBULB = "\uea61"; //  nf-cod-lightbulb ()

export default defineScenario({
    name: "lightbulb",
    title: "Лампочка code actions: индикатор действий tsserver'а на строке каретки",
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
        await editor.waitForText((t) => t.includes("import { zeta }"));

        // Readiness: undercurl от НАСТОЯЩЕГО tsserver'а (ошибка типов в main.ts).
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от tsserver", timeoutMs: 120_000, intervalMs: 500 },
        );

        // Каретка стоит на строке неиспользуемого импорта (0,0) — после
        // дебаунса и ответа сервера в гуттере загорается лампочка.
        await editor.waitForText((t) => t.includes(LIGHTBULB), { timeoutMs: 60_000 });
        await editor.capture("lit");

        // Уход на пустую строку — действий нет, лампочка гаснет.
        await editor.sendKey("ArrowDown");
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => !frame.cells.some((cell) => cell.char === LIGHTBULB),
            { describe: "лампочка погасла на пустой строке", timeoutMs: 30_000, intervalMs: 250 },
        );
        await editor.capture("off");
    },
});
