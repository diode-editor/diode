import { createRequire } from "node:module";
import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// #196. Чорд Ctrl+K Ctrl+Q — второй бинд, досягаемый на legacy: Ctrl+. терминал без kitty-протокола не кодирует.

const require_ = createRequire(import.meta.url);
const sampleDir = resolve(repoRoot, "e2e", "fixtures", "quickfixSample");
const mainFile = resolve(sampleDir, "main.ts");

/** StyleFlags.Undercurl. */
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

        // Readiness: undercurl от настоящего tsserver'а.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от tsserver", timeoutMs: 120_000, intervalMs: 500 },
        );
        await editor.capture("before");

        // Открытие ставит каретку в (0,0) — на строку импорта.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+Q");
        await editor.waitForText((t) => t.includes("Select Code Action"), { timeoutMs: 60_000 });
        // Пин на нужное действие набором в фильтр — порядок пунктов за сервером.
        await editor.sendText("Remove import");
        await editor.waitForText((t) => t.includes("Remove import"));
        await editor.capture("menu");

        await editor.sendKey("Enter");
        // Импорт обязан исчезнуть из буфера, а не спрятаться за оверлеем меню.
        await editor.waitForText(
            (t) => !t.includes("Code Actions") && !t.includes(ZETA_IMPORT) && t.includes("export const kept"),
            { timeoutMs: 60_000 },
        );
        await editor.capture("after");
    },
});
