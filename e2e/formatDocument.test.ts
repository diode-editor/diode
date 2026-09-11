import { createRequire } from "node:module";

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * Format Document (Shift+Alt+F) от стокового `typescript-language-server` в
 * SEA-бинаре: команда ядра гонит запрос через провайдерный шов и применяет
 * правки настоящего tsserver'а к буферу (#196).
 */

const require_ = createRequire(import.meta.url);
const SERVER_CLI = require_.resolve("typescript-language-server/lib/cli.mjs");
const TSSERVER_JS = require_.resolve("typescript/lib/tsserver.js");

const LSP_SETTINGS = {
    "diode.lsp.typescript.serverPath": SERVER_CLI,
    "diode.lsp.typescript.tsserverPath": TSSERVER_JS,
};

// Каша из пробелов + ошибка типов (readiness по undercurl — сервер проиндексировал).
const MESSY_TS = 'const  answer :   number  =  "oops";\n\nfunction   greet( name:string ){\n        return  "hi "  +  name;\n}\n';

/** Squiggle рисуется undercurl'ом (StyleFlags.Undercurl === 8) на диапазоне ошибки. */
const UNDERCURL = 8;

// Extension-host subprocess + спавн language-сервера — Linux-only, как
// gotoDefinition / parameterHints (см. docs/TODO/E2E.md).
describe.skipIf(process.platform === "win32" || process.platform === "darwin")(
    "SEA binary — Format Document от стокового typescript-language-server",
    () => {
        beforeAll(async () => {
            await getBinaryPath();
        }, 300_000);

        it("Shift+Alt+F приводит кашу из пробелов к формату tsserver'а", { timeout: 240_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: {
                    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
                    "main.ts": MESSY_TS,
                },
                settings: LSP_SETTINGS,
                open: ["main.ts"],
            });
            await session.waitForNode("EditorElement");

            // Диагностика настоящего tsserver'а дорисовалась до squiggle — это же
            // readiness-сигнал «сервер проиндексировал проект».
            await waitUntil(
                () => session.captureFrame(),
                (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
                { describe: "undercurl squiggle от tsserver", timeoutMs: 120_000, intervalMs: 500 },
            );

            // Shift+Alt+F legacy-терминал не передаёт (ESC F без shift-флага) —
            // жмём досягаемый чорд Ctrl+K Ctrl+E, второй бинд той же команды.
            await session.key("Ctrl+K");
            await session.key("Ctrl+E");
            const frame = await waitUntil(
                () => session.captureFrame(),
                (f) => frameToText(f).includes("function greet(name: string) {"),
                { describe: "правки формата tsserver'а в буфере", timeoutMs: 60_000, intervalMs: 500 },
            );

            const text = frameToText(frame);
            expect(text).toContain('const answer: number = "oops";');
            expect(text).toContain('return "hi " + name;');
        });
    },
);
