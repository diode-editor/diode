import { createRequire } from "node:module";
import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Точка — триггер-символ сервера: попап открывается сам; Ctrl+Space при открытом попапе — тумблер панели описания.

const require_ = createRequire(import.meta.url);
/** StyleFlags.Undercurl. */
const UNDERCURL = 8;

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "lspSample");
const mainFile = resolve(sampleDir, "main.ts");

export default defineScenario({
    name: "lsp-completion",
    title: "Stock typescript-language-server: completions + details panel",
    open: [sampleDir, mainFile],
    // Сервер живёт в devDeps репозитория (вшитый — docs/arch/Extensions.md, «Builtin LSP-клиент»).
    settings: {
        "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
        "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
    },
    cols: 100,
    rows: 24,
    // Extension host + спавн сервера — только Linux.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("const reply"));

        // Squiggle от tsserver — сигнал готовности: без него провайдер не зарегистрирован, и попап откроется словами из буфера.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от tsserver (сервер готов)", timeoutMs: 120_000, intervalMs: 500 },
        );

        for (let i = 0; i < 6; i++) await editor.sendKey("ArrowDown");
        await editor.sendKey("End");
        await editor.sendKey("Enter");
        for (const key of ["r", "e", "p", "l", "y", "."]) await editor.sendKey(key);

        // Холодный tsserver индексирует проект секундами.
        await editor.waitForText((t) => t.includes("toFixed"), { timeoutMs: 120_000 });
        await editor.capture("completion");

        // Сигнатура приезжает отдельным resolve после показа списка — без ожидания кадр снимет пустую панель.
        await editor.sendKey("Ctrl+Space");
        await editor.waitForText((t) => t.includes("(method)"), { timeoutMs: 30_000 });
        await editor.capture("completion-details");
    },
});
