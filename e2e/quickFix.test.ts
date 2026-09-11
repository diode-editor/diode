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
    },
);
