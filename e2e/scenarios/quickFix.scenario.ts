import { createRequire } from "node:module";
import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Quick Fix (#196): меню code actions у каретки поверх стокового
// typescript-language-server — неиспользуемый импорт чинится действием
// «Remove import from …». Чорд Ctrl+K Ctrl+Q — досягаемый на legacy
// второй бинд (Ctrl+. терминал без kitty-протокола не кодирует).

const require_ = createRequire(import.meta.url);
const sampleDir = resolve(repoRoot, "e2e", "fixtures", "quickfixSample");
const mainFile = resolve(sampleDir, "main.ts");

/** Squiggle рисуется undercurl'ом (StyleFlags.Undercurl === 8) на диапазоне ошибки. */
const UNDERCURL = 8;

const ZETA_IMPORT = 'import { zeta } from "./zeta";';

export default defineScenario({
    name: "quick-fix",
    title: "Quick Fix (Ctrl+K Ctrl+Q): действия стокового typescript-language-server у каретки",
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

        // Каретка на строке импорта (открытие ставит её в (0,0)) → меню действий.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+Q");
        await editor.waitForText((t) => t.includes("Select Code Action"), { timeoutMs: 60_000 });
        // Пин на нужное действие набором в фильтр — порядок пунктов за сервером.
        await editor.sendText("Remove import");
        await editor.waitForText((t) => t.includes("Remove import"));
        await editor.capture("menu");

        await editor.sendKey("Enter");
        // Меню обязано закрыться, а импорт — исчезнуть из буфера (а не просто
        // спрятаться за оверлеем меню).
        await editor.waitForText(
            (t) => !t.includes("Code Actions") && !t.includes(ZETA_IMPORT) && t.includes("export const kept"),
            { timeoutMs: 60_000 },
        );
        await editor.capture("after");
    },
});
