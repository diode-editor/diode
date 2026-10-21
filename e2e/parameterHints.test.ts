import { createRequire } from "node:module";

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/** Ассерты ждут текст, которого НЕТ в буфере, — грабля «слабый ассерт» (docs/TODO/Suggest.md). */

const require_ = createRequire(import.meta.url);
const SERVER_CLI = require_.resolve("typescript-language-server/lib/cli.mjs");
const TSSERVER_JS = require_.resolve("typescript/lib/tsserver.js");

const LSP_SETTINGS = {
    "diode.lsp.typescript.serverPath": SERVER_CLI,
    "diode.lsp.typescript.tsserverPath": TSSERVER_JS,
};

const DEFS_TS = "export function greet(name: string, age: number): string {\n    return name + String(age);\n}\n";
// Ошибка типов в последней строке — для squiggle (readiness).
const MAIN_TS = 'import { greet } from "./defs";\n\nconst reply: number = 1;\n';

const UNDERCURL = 8;
const SIGNATURE = "greet(name: string, age: number): string";

// Только Linux: extension host + спавн language-сервера (docs/TODO/E2E.md).
describe.skipIf(process.platform === "win32" || process.platform === "darwin")(
    "SEA binary — подсказка параметров от стокового typescript-language-server",
    () => {
        beforeAll(async () => {
            await getBinaryPath();
        }, 300_000);

        it("«(» открывает подсказку, запятая двигает параметр, Escape закрывает", { timeout: 240_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: {
                    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
                    "defs.ts": DEFS_TS,
                    "main.ts": MAIN_TS,
                },
                settings: LSP_SETTINGS,
                open: ["main.ts"],
            });
            await session.waitForNode("EditorElement");

            // Squiggle от tsserver — readiness-сигнал «сервер проиндексировал проект».
            await waitUntil(
                () => session.captureFrame(),
                (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
                { describe: "undercurl squiggle от tsserver", timeoutMs: 120_000, intervalMs: 500 },
            );

            await session.key("Ctrl+End");
            // Нажатиями: подсказку открывает НАБОР триггер-символа (onDidType), а вставка —
            // даже одного символа — намеренно нет, как в VS Code. `session.text` — это вставка.
            for (const char of "greet(") await session.key(char);

            await session.waitForText((text) => text.includes(SIGNATURE), {
                timeoutMs: 60_000,
                intervalMs: 500,
            });

            for (const char of '"world",') await session.key(char);
            await waitUntil(
                () => session.captureFrame(),
                (frame) => frameToText(frame).includes(SIGNATURE),
                { describe: "подсказка пережила запятую", timeoutMs: 30_000, intervalMs: 250 },
            );

            // Набор `world` клавишами мог открыть и автодополнение, а Escape принадлежит ему,
            // пока оно показано (как в VS Code), — тогда подсказку закрывает следующий Escape.
            let frame = await session.captureFrame();
            for (let attempt = 0; attempt < 3 && frameToText(frame).includes(SIGNATURE); attempt++) {
                await session.key("Escape");
                frame = await session.captureFrame();
            }
            expect(frameToText(frame)).not.toContain(SIGNATURE);
            expect(frameToText(frame)).toContain('greet("world",');
        });
    },
);
