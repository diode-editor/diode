import { createRequire } from "node:module";
import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Organize Imports поверх стокового typescript-language-server (#196):
// импорты в обратном порядке пересортировываются source-действием сервера.
// Команда вызывается через палитру — как пользователь (Shift+Alt+O живёт
// только на kitty/csi-u, key-DSL headless-сессии его не сериализует).

const require_ = createRequire(import.meta.url);
const sampleDir = resolve(repoRoot, "e2e", "fixtures", "organizeSample");
const mainFile = resolve(sampleDir, "main.ts");

/** Squiggle рисуется undercurl'ом (StyleFlags.Undercurl === 8) на диапазоне ошибки. */
const UNDERCURL = 8;

const ALPHA_IMPORT = 'import { alpha } from "./alpha";';
const ZETA_IMPORT = 'import { zeta } from "./zeta";';

export default defineScenario({
    name: "organize-imports",
    title: "Organize Imports: source-действие стокового typescript-language-server",
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
        await editor.waitForText((t) => t.includes(ZETA_IMPORT));

        // Readiness: undercurl от НАСТОЯЩЕГО tsserver'а (ошибка типов в main.ts).
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от tsserver", timeoutMs: 120_000, intervalMs: 500 },
        );
        await editor.capture("before");

        // Команда — через палитру (Quick Open + префикс «>»), как пользователь.
        await editor.sendKey("Ctrl+P");
        await editor.sendText(">Organize Imports");
        await editor.waitForText((t) => t.includes("Organize Imports"));
        await editor.capture("palette");
        await editor.sendKey("Enter");

        await editor.waitForText(
            (t) => t.indexOf(ALPHA_IMPORT) >= 0 && t.indexOf(ALPHA_IMPORT) < t.indexOf(ZETA_IMPORT),
            { timeoutMs: 60_000 },
        );
        await editor.capture("after");
    },
});
