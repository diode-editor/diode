import { createRequire } from "node:module";
import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Undo после quick fix'а: удаление ОДНОГО имени из списка импорта сервер
// присылает двумя смежными диапазонами на одной строке, и обратные правки
// схлопываются в одну точку. Ctrl+Z обязан вернуть строку дословно — раньше
// буфер собирался перемешанным (`import { alphazeta,  } from "./both";`).

const require_ = createRequire(import.meta.url);
const sampleDir = resolve(repoRoot, "e2e", "fixtures", "quickfixUndoSample");
const mainFile = resolve(sampleDir, "main.ts");

/** Squiggle рисуется undercurl'ом (StyleFlags.Undercurl === 8) на диапазоне ошибки. */
const UNDERCURL = 8;

const BOTH_IMPORT = 'import { alpha, zeta } from "./both";';
const BOTH_IMPORT_FIXED = 'import { alpha } from "./both";';

export default defineScenario({
    name: "quick-fix-undo",
    title: "Undo после quick fix'а: Ctrl+Z возвращает строку импорта дословно",
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
        await editor.waitForText((t) => t.includes(BOTH_IMPORT));

        // Readiness: undercurl от НАСТОЯЩЕГО tsserver'а.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от tsserver", timeoutMs: 120_000, intervalMs: 500 },
        );
        await editor.capture("before");

        // Каретка на идентификатор `zeta` (колонка 16) → меню действий.
        for (let i = 0; i < 16; i++) await editor.sendKey("ArrowRight");
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+Q");
        await editor.waitForText((t) => t.includes("Select Code Action"), { timeoutMs: 60_000 });
        await editor.sendText("Remove unused declaration");
        await editor.waitForText((t) => t.includes("Remove unused declaration"));

        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes(BOTH_IMPORT_FIXED), { timeoutMs: 60_000 });
        await editor.capture("fixed");

        await editor.sendKey("Ctrl+Z");
        // Перемешанный буфер состоит из тех же символов, поэтому мало вхождения
        // исходной строки — ждём и отсутствия склейки.
        await editor.waitForText((t) => t.includes(BOTH_IMPORT) && !t.includes("alphazeta"), { timeoutMs: 30_000 });
        await editor.capture("undone");
    },
});
