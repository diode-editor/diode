import { createRequire } from "node:module";
import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";


const require_ = createRequire(import.meta.url);
/** StyleFlags.Undercurl. */
const UNDERCURL = 8;

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "lspSample");
const mainFile = resolve(sampleDir, "main.ts");

export default defineScenario({
    name: "hover",
    title: "Stock typescript-language-server: hover popup",
    open: [sampleDir, mainFile],
    settings: {
        "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
        "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
    },
    cols: 100,
    rows: 24,
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("const reply"));

        // До squiggle (проект проиндексирован) hover-провайдер ещё не зарегистрирован.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от tsserver (сервер готов)", timeoutMs: 120_000, intervalMs: 500 },
        );

        // Вызов `greet`: строка 2, колонка 23.
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        for (let i = 0; i < 23; i++) await editor.sendKey("ArrowRight");
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+U");

        // Этого текста нет в буфере main.ts — без работающего hover'а кадр его не покажет.
        await editor.waitForText((t) => t.includes("(alias) greet(name: string): string"), { timeoutMs: 60_000 });
        await editor.capture("hover");
    },
});
