import { createRequire } from "node:module";

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * Лампочка code actions (#196, lightbulb) в SEA-бинаре: индикатор в гуттере
 * загорается на строке каретки с действиями настоящего
 * `typescript-language-server` и гаснет на строке без них.
 */

const require_ = createRequire(import.meta.url);
const SERVER_CLI = require_.resolve("typescript-language-server/lib/cli.mjs");
const TSSERVER_JS = require_.resolve("typescript/lib/tsserver.js");

const LSP_SETTINGS = {
    "diode.lsp.typescript.serverPath": SERVER_CLI,
    "diode.lsp.typescript.tsserverPath": TSSERVER_JS,
};

// Неиспользуемый импорт (действия на строке 0) + ошибка типов (readiness).
const MAIN_TS = 'import { zeta } from "./zeta";\n\nconst bad: number = "oops";\n\nexport const kept = 1;\n';

/** Squiggle рисуется undercurl'ом (StyleFlags.Undercurl === 8) на диапазоне ошибки. */
const UNDERCURL = 8;
const LIGHTBULB = "\uea61"; //  nf-cod-lightbulb ()

// Extension-host subprocess + спавн language-сервера — Linux-only, как
// quickFix / formatDocument (см. docs/TODO/E2E.md).
describe.skipIf(process.platform === "win32" || process.platform === "darwin")(
    "SEA binary — лампочка code actions от стокового typescript-language-server",
    () => {
        beforeAll(async () => {
            await getBinaryPath();
        }, 300_000);

        it("загорается на строке с действиями и гаснет на пустой", { timeout: 240_000 }, async () => {
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

            // Каретка на строке импорта (0,0) — лампочка загорается сама,
            // без единой команды.
            const lit = await waitUntil(
                () => session.captureFrame(),
                (frame) => frame.cells.some((cell) => cell.char === LIGHTBULB),
                { describe: "лампочка на строке неиспользуемого импорта", timeoutMs: 60_000, intervalMs: 500 },
            );
            expect(frameToText(lit)).toContain("import { zeta }");

            // Пустая строка — действий нет, лампочка гаснет.
            await session.key("ArrowDown");
            await waitUntil(
                () => session.captureFrame(),
                (frame) => !frame.cells.some((cell) => cell.char === LIGHTBULB),
                { describe: "лампочка погасла на пустой строке", timeoutMs: 30_000, intervalMs: 250 },
            );
        });
    },
);
