import { createRequire } from "node:module";

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * Quick Fix (#196) от стокового `typescript-language-server` в SEA-бинаре:
 * Ctrl+K Ctrl+Q открывает меню действий у каретки, выбранное действие
 * («Remove import from …») правит буфер.
 *
 * Второй кейс — undo после quick fix'а: удаление ОДНОГО имени из списка
 * импорта сервер присылает двумя смежными диапазонами на одной строке, и
 * Ctrl+Z обязан вернуть строку дословно (буфер собирался перемешанным —
 * `import { alphazeta,  } from …`).
 */

const require_ = createRequire(import.meta.url);
const SERVER_CLI = require_.resolve("typescript-language-server/lib/cli.mjs");
const TSSERVER_JS = require_.resolve("typescript/lib/tsserver.js");

const LSP_SETTINGS = {
    "diode.lsp.typescript.serverPath": SERVER_CLI,
    "diode.lsp.typescript.tsserverPath": TSSERVER_JS,
};

const ZETA_IMPORT = 'import { zeta } from "./zeta";';
// Неиспользуемый импорт (quickfix) + ошибка типов (readiness по undercurl).
const MAIN_TS = `${ZETA_IMPORT}\n\nconst bad: number = "oops";\n\nexport const kept = 1;\n`;

// Список из двух имён: quickfix на неиспользуемом `zeta` режет строку ДВУМЯ
// смежными диапазонами (", " и "zeta") — форма, на которой ломался undo.
const BOTH_IMPORT = 'import { alpha, zeta } from "./both";';
const BOTH_IMPORT_FIXED = 'import { alpha } from "./both";';
const BOTH_TS = `${BOTH_IMPORT}\n\nalpha();\n`;

/** Squiggle рисуется undercurl'ом (StyleFlags.Undercurl === 8) на диапазоне ошибки. */
const UNDERCURL = 8;

// Extension-host subprocess + спавн language-сервера — Linux-only, как
// organizeImports / formatDocument (см. docs/TODO/E2E.md).
describe.skipIf(process.platform === "win32" || process.platform === "darwin")(
    "SEA binary — Quick Fix от стокового typescript-language-server",
    () => {
        beforeAll(async () => {
            await getBinaryPath();
        }, 300_000);

        it("Ctrl+K Ctrl+Q → «Remove import from …» убирает импорт", { timeout: 240_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: {
                    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, noUnusedLocals: true } }),
                    "zeta.ts": "export function zeta(): void {}\n",
                    "main.ts": MAIN_TS,
                },
                settings: LSP_SETTINGS,
                open: ["main.ts"],
            });
            await session.waitForNode("EditorElement");

            await waitUntil(
                () => session.captureFrame(),
                (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
                { describe: "undercurl squiggle от tsserver", timeoutMs: 120_000, intervalMs: 500 },
            );

            // Каретка на строке импорта (открытие ставит её в начало файла).
            await session.key("Ctrl+K");
            await session.key("Ctrl+Q");
            await session.waitForText((text) => text.includes("Select Code Action"), { timeoutMs: 60_000 });
            // Пин на нужное действие фильтром — порядок пунктов за сервером.
            await session.text("Remove import");
            await session.waitForText((text) => text.includes("Remove import"), { timeoutMs: 30_000 });
            await session.key("Enter");

            const frame = await waitUntil(
                () => session.captureFrame(),
                (f) => {
                    const text = frameToText(f);
                    return !text.includes("Code Actions") && !text.includes(ZETA_IMPORT) && text.includes("export const kept");
                },
                { describe: "импорт удалён правкой quickfix", timeoutMs: 60_000, intervalMs: 500 },
            );
            expect(frameToText(frame)).toContain('const bad: number = "oops";');
        });

        it("Ctrl+Z после quick fix'а возвращает строку импорта дословно", { timeout: 240_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: {
                    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, noUnusedLocals: true } }),
                    "both.ts": "export function alpha(): void {}\nexport function zeta(): void {}\n",
                    "main.ts": BOTH_TS,
                },
                settings: LSP_SETTINGS,
                open: ["main.ts"],
            });
            await session.waitForNode("EditorElement");

            // Readiness: сервер проиндексировал проект и подчеркнул `zeta`.
            await waitUntil(
                () => session.captureFrame(),
                (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
                { describe: "undercurl squiggle от tsserver", timeoutMs: 120_000, intervalMs: 500 },
            );

            // Каретка на идентификатор `zeta` в первой строке (колонка 16).
            for (let i = 0; i < 16; i++) await session.key("ArrowRight");
            await session.key("Ctrl+K");
            await session.key("Ctrl+Q");
            await session.waitForText((text) => text.includes("Select Code Action"), { timeoutMs: 60_000 });
            await session.text("Remove unused declaration");
            await session.waitForText((text) => text.includes("Remove unused declaration"), { timeoutMs: 30_000 });
            await session.key("Enter");

            await waitUntil(
                () => session.captureFrame(),
                (f) => frameToText(f).includes(BOTH_IMPORT_FIXED),
                { describe: "quickfix убрал zeta из списка импорта", timeoutMs: 60_000, intervalMs: 500 },
            );

            await session.key("Ctrl+Z");
            const undone = await waitUntil(
                () => session.captureFrame(),
                (f) => frameToText(f).includes(BOTH_IMPORT),
                { describe: "Ctrl+Z вернул строку импорта", timeoutMs: 30_000, intervalMs: 250 },
            );
            // Перемешанный буфер (`import { alphazeta,  } from …`) состоит из тех
            // же символов, поэтому мало вхождения — проверяем и его отсутствие.
            expect(frameToText(undone)).not.toContain("alphazeta");
            // Redo здесь не дёргаем: `Ctrl+Shift+Z` не выражается в key-DSL
            // движка (serializeKey не знает формы Ctrl+Shift+буква), а обходить
            // ограничение tuidom нельзя — правило AGENTS. Redo закрыт на уровне
            // команды в extensionHost.typescriptLsp.codeActions.test.ts.
        });
    },
);
