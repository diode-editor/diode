import { createRequire } from "node:module";

import { beforeAll, describe, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * Hover от стокового `typescript-language-server` в SEA-бинаре: Ctrl+K I
 * (legacy-фолбэк VS Code-чорда Ctrl+K Ctrl+I — в терминале Ctrl+I неотличим от
 * Tab) показывает попап с типом символа под кареткой, Escape закрывает его.
 * Ассерт ждёт текст, которого НЕТ в буфере (`function greet`) — грабля «слабый
 * ассерт прячет неработающую фичу» из docs/TODO/Suggest.md.
 */

const require_ = createRequire(import.meta.url);
const SERVER_CLI = require_.resolve("typescript-language-server/lib/cli.mjs");
const TSSERVER_JS = require_.resolve("typescript/lib/tsserver.js");

const LSP_SETTINGS = {
    "diode.lsp.typescript.serverPath": SERVER_CLI,
    "diode.lsp.typescript.tsserverPath": TSSERVER_JS,
};

const DEFS_TS = 'export function greet(name: string): string {\n    return "hi " + name;\n}\n';
// Ошибка типов: greet возвращает string, а reply объявлен number → squiggle.
const MAIN_TS = 'import { greet } from "./defs";\n\nconst reply: number = greet("world");\n\nexport { reply };\n';

/** Squiggle рисуется undercurl'ом (StyleFlags.Undercurl === 8) на диапазоне ошибки. */
const UNDERCURL = 8;

// Extension-host subprocess + спавн language-сервера — Linux-only, как
// gotoDefinition / editorconfig-stock (см. docs/TODO/E2E.md).
describe.skipIf(process.platform === "win32" || process.platform === "darwin")(
    "SEA binary — hover от стокового typescript-language-server",
    () => {
        beforeAll(async () => {
            await getBinaryPath();
        }, 300_000);

        it("Ctrl+K I показывает тип символа, Escape закрывает попап", { timeout: 240_000 }, async () => {
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

            // Каретка на `greet` в вызове (строка 2, колонка 23) и Ctrl+K I.
            await session.key("ArrowDown");
            await session.key("ArrowDown");
            for (let i = 0; i < 23; i++) await session.key("ArrowRight");
            await session.key("Ctrl+K");
            await session.key("i");

            // Попап показывает сигнатуру: для call-site импортированного символа
            // tsserver отвечает `(alias) greet(name: string): string` — этого
            // текста в буфере main.ts нет, кадр не может пройти ассерт без
            // работающего hover'а (грабля «слабый ассерт»).
            await session.waitForText((text) => text.includes("(alias) greet(name: string): string"), {
                timeoutMs: 60_000,
                intervalMs: 500,
            });

            // Escape закрывает попап, буфер остаётся нетронутым.
            await session.key("Escape");
            await waitUntil(
                () => session.captureFrame(),
                (frame) => !frameToText(frame).includes("(alias) greet"),
                { describe: "hover-попап закрыт по Escape", timeoutMs: 30_000, intervalMs: 250 },
            );
        });
    },
);
