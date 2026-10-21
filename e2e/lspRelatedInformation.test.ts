import { createRequire } from "node:module";

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * Регресс: конвертер vscode-languageclient конструирует `new DiagnosticRelatedInformation`
 * на каждую такую диагностику, а класса в стабе не было — падала ВСЯ пачка, файл
 * оставался без подчёркиваний. Поэтому фикстура — TS2741, у которой tsserver всегда
 * шлёт related information; TS2322 соседних сьютов её не ловит.
 */

const require_ = createRequire(import.meta.url);
const LSP_SETTINGS = {
    "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
    "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
};

const CONFIG_TS = "export interface Config {\n    name: string;\n    retries: number;\n}\n";
const MAIN_TS =
    'import type { Config } from "./config";\n\nexport function makeConfig(): Config {\n    return {\n        name: "demo",\n    };\n}\n';

const UNDERCURL = 8;

// Только Linux: extension host + спавн language-сервера (docs/TODO/E2E.md).
describe.skipIf(process.platform === "win32" || process.platform === "darwin")(
    "SEA binary — диагностика с related information (stock typescript-language-server)",
    () => {
        beforeAll(async () => {
            await getBinaryPath();
        }, 300_000);

        it("squiggle и текст ошибки доезжают, а не теряются вместе с пачкой", { timeout: 240_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: {
                    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
                    "config.ts": CONFIG_TS,
                    "main.ts": MAIN_TS,
                },
                settings: LSP_SETTINGS,
                open: ["main.ts"],
            });
            await session.waitForNode("EditorElement");

            // Пачка диагностик пережила конвертацию.
            await waitUntil(
                () => session.captureFrame(),
                (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
                { describe: "undercurl squiggle от tsserver", timeoutMs: 120_000, intervalMs: 500 },
            );

            // Маркер доехал до MarkerService, а не просто «что-то подчёркнулось».
            await session.key("Ctrl+J");
            await session.waitForText((text) => /is missing/i.test(text), { timeoutMs: 60_000, intervalMs: 500 });

            const screen = frameToText(await session.captureFrame());
            expect(screen).toMatch(/retries/);
            expect(screen).toMatch(/main\.ts/);
        });
    },
);
