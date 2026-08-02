import { createRequire } from "node:module";

import { beforeAll, describe, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * Сквозная интеграция стокового `typescript-language-server` в SEA-бинаре:
 * builtin `vexx-lsp-typescript` (стоковый vscode-languageclient внутри бандла)
 * лениво активируется по открытию `.ts`, спавнит сервер из devDeps репозитория
 * (путь через настройку — сервер не пакуется в SEA, см. docs/TODO/LSP.md),
 * и его диагностика доезжает до squiggle, а F12 прыгает в другой файл.
 *
 * Правки НЕ сохраняются на диск — сервер обязан видеть живой буфер (didChange).
 */

const require_ = createRequire(import.meta.url);
const SERVER_CLI = require_.resolve("typescript-language-server/lib/cli.mjs");
const TSSERVER_JS = require_.resolve("typescript/lib/tsserver.js");

const LSP_SETTINGS = {
    "vexx.lsp.typescript.serverPath": SERVER_CLI,
    "vexx.lsp.typescript.tsserverPath": TSSERVER_JS,
};

const DEFS_TS = 'export function greet(name: string): string {\n    return "hi " + name;\n}\n';
// Ошибка типов: greet возвращает string, а reply объявлен number → squiggle.
const MAIN_TS = 'import { greet } from "./defs";\n\nconst reply: number = greet("world");\n\nexport { reply };\n';

/** Squiggle рисуется undercurl'ом (StyleFlags.Undercurl === 8) на диапазоне ошибки. */
const UNDERCURL = 8;

// Extension-host subprocess + спавн language-сервера — Linux-only, как
// editorconfig-stock / sea-git (см. docs/TODO/E2E.md).
describe.skipIf(process.platform === "win32" || process.platform === "darwin")(
    "SEA binary — stock typescript-language-server (LSP)",
    () => {
        beforeAll(async () => {
            await getBinaryPath();
        }, 300_000);

        it("squiggle от tsserver и F12 через несохранённую правку", { timeout: 240_000 }, async () => {
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

            // 1. Диагностика настоящего tsserver'а дорисовалась до squiggle —
            // это же readiness-сигнал «сервер проиндексировал проект».
            await waitUntil(
                () => session.captureFrame(),
                (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
                { describe: "undercurl squiggle от tsserver", timeoutMs: 120_000, intervalMs: 500 },
            );

            // 2. Несохранённая правка: две пустые строки в начале main.ts —
            // вызов greet съезжает на строку 4. Сервер обязан видеть живой буфер.
            await session.key("Enter");
            await session.key("Enter");

            // 3. Каретка на `greet` в вызове (строка 4, колонка 23) и F12.
            await session.key("ArrowDown");
            await session.key("ArrowDown");
            for (let i = 0; i < 23; i++) await session.key("ArrowRight");
            await session.key("F12");

            // 4. Прыжок в defs.ts: контент другого файла на экране, каретка на
            // объявлении greet (0-based 0:16).
            await session.waitForText((text) => text.includes('return "hi " + name'), {
                timeoutMs: 60_000,
                intervalMs: 500,
            });
            await session.waitForState(
                "EditorElement",
                (state) => {
                    const selections = state?.selections as
                        | { active: { line: number; character: number } }[]
                        | undefined;
                    const active = selections?.[0]?.active;
                    return active?.line === 0 && active.character === 16;
                },
                { timeoutMs: 30_000 },
            );
        });
    },
);
