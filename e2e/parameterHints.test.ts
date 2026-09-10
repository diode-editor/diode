import { createRequire } from "node:module";

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * Подсказка параметров от стокового `typescript-language-server` в SEA-бинаре:
 * набранная «(» открывает попап сама, запятая двигает активный параметр,
 * Escape закрывает. Ассерты ждут текст, которого НЕТ в буфере (сигнатуру из
 * соседнего модуля) — грабля «слабый ассерт прячет неработающую фичу» из
 * docs/TODO/Suggest.md.
 */

const require_ = createRequire(import.meta.url);
const SERVER_CLI = require_.resolve("typescript-language-server/lib/cli.mjs");
const TSSERVER_JS = require_.resolve("typescript/lib/tsserver.js");

const LSP_SETTINGS = {
    "diode.lsp.typescript.serverPath": SERVER_CLI,
    "diode.lsp.typescript.tsserverPath": TSSERVER_JS,
};

const DEFS_TS = "export function greet(name: string, age: number): string {\n    return name + String(age);\n}\n";
// Ошибка типов в последней строке (reply объявлен number) → squiggle-readiness.
const MAIN_TS = 'import { greet } from "./defs";\n\nconst reply: number = 1;\n';

/** Squiggle рисуется undercurl'ом (StyleFlags.Undercurl === 8) на диапазоне ошибки. */
const UNDERCURL = 8;
const SIGNATURE = "greet(name: string, age: number): string";

// Extension-host subprocess + спавн language-сервера — Linux-only, как
// gotoDefinition / hover (см. docs/TODO/E2E.md).
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

            // Диагностика настоящего tsserver'а дорисовалась до squiggle — это же
            // readiness-сигнал «сервер проиндексировал проект».
            await waitUntil(
                () => session.captureFrame(),
                (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
                { describe: "undercurl squiggle от tsserver", timeoutMs: 120_000, intervalMs: 500 },
            );

            // Набираем вызов в конце файла: «(» — триггер-символ сервера,
            // подсказка обязана открыться сама, без единой команды.
            await session.key("Ctrl+End");
            // Посимвольно: подсказку открывает НАБОР триггер-символа, а вставка
            // блока — намеренно нет (та же эвристика, что у автодополнения).
            for (const char of "greet(") await session.text(char);

            await session.waitForText((text) => text.includes(SIGNATURE), {
                timeoutMs: 60_000,
                intervalMs: 500,
            });

            // Запятая перезапрашивает подсказку: активным становится второй
            // параметр — попап остаётся на месте с той же сигнатурой.
            for (const char of '"world",') await session.text(char);
            await waitUntil(
                () => session.captureFrame(),
                (frame) => frameToText(frame).includes(SIGNATURE),
                { describe: "подсказка пережила запятую", timeoutMs: 30_000, intervalMs: 250 },
            );

            // Escape закрывает попап, буфер остаётся с набранным текстом —
            // значит Escape не просочился в редактор и не отменил правку.
            await session.key("Escape");
            const frame = await waitUntil(
                () => session.captureFrame(),
                (f) => !frameToText(f).includes(SIGNATURE),
                { describe: "попап закрыт по Escape", timeoutMs: 30_000, intervalMs: 250 },
            );
            expect(frameToText(frame)).toContain('greet("world",');
        });
    },
);
