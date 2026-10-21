import { createRequire } from "node:module";

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/** Ассерт ждёт текст, которого НЕТ в буфере, — грабля «слабый ассерт» (docs/TODO/Suggest.md). */

const require_ = createRequire(import.meta.url);
const SERVER_CLI = require_.resolve("typescript-language-server/lib/cli.mjs");
const TSSERVER_JS = require_.resolve("typescript/lib/tsserver.js");

const LSP_SETTINGS = {
    "diode.lsp.typescript.serverPath": SERVER_CLI,
    "diode.lsp.typescript.tsserverPath": TSSERVER_JS,
};

const DEFS_TS = 'export function greet(name: string): string {\n    return "hi " + name;\n}\n';
// Ошибка типов — для squiggle (readiness).
const MAIN_TS = 'import { greet } from "./defs";\n\nconst reply: number = greet("world");\n\nexport { reply };\n';

const UNDERCURL = 8;

// Только Linux: extension host + спавн language-сервера (docs/TODO/E2E.md).
describe.skipIf(process.platform === "win32" || process.platform === "darwin")(
    "SEA binary — hover от стокового typescript-language-server",
    () => {
        beforeAll(async () => {
            await getBinaryPath();
        }, 300_000);

        it("Ctrl+K Ctrl+U показывает тип символа, Escape закрывает попап", { timeout: 240_000 }, async () => {
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

            // Каретка на `greet` в вызове (строка 2, колонка 23) и Ctrl+K Ctrl+U.
            await session.key("ArrowDown");
            await session.key("ArrowDown");
            for (let i = 0; i < 23; i++) await session.key("ArrowRight");
            await session.key("Ctrl+K");
            await session.key("Ctrl+U");

            // `(alias) greet(name: string): string` в буфере main.ts нет.
            await session.waitForText((text) => text.includes("(alias) greet(name: string): string"), {
                timeoutMs: 60_000,
                intervalMs: 500,
            });

            // Строка цела — ни чорд, ни Escape не просочились в редактор.
            await session.key("Escape");
            const frame = await waitUntil(
                () => session.captureFrame(),
                (f) => !frameToText(f).includes("(alias) greet"),
                { describe: "hover-попап закрыт по Escape", timeoutMs: 30_000, intervalMs: 250 },
            );
            expect(frameToText(frame)).toContain('const reply: number = greet("world");');
        });
    },
);
