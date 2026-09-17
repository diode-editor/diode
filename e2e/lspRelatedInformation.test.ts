import { createRequire } from "node:module";

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * Диагностика с related information от НАСТОЯЩЕГО tsserver'а доезжает до
 * squiggle и панели Problems.
 *
 * Регресс на класс-ловушку: конвертер vscode-languageclient конструирует
 * `new code.DiagnosticRelatedInformation(...)` на каждую такую диагностику, а
 * класса в нашем стабе vscode API не было. Падал не один маркер — падала ВСЯ
 * пачка (`Processing diagnostic queue failed`), файл оставался вообще без
 * подчёркиваний, и увидеть причину можно было только в output-канале клиента.
 * Поэтому фикстура здесь ровно такая: TS2741 «Property … is missing», у которой
 * tsserver всегда шлёт related information («'retries' is declared here»), —
 * ошибка из соседних LSP-сьютов (TS2322 «not assignable») её не ловит.
 */

const require_ = createRequire(import.meta.url);
const LSP_SETTINGS = {
    "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
    "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
};

const CONFIG_TS = "export interface Config {\n    name: string;\n    retries: number;\n}\n";
// TS2741: в объекте нет обязательного `retries` — сообщение + related information
// с местом объявления поля.
const MAIN_TS =
    'import type { Config } from "./config";\n\nexport function makeConfig(): Config {\n    return {\n        name: "demo",\n    };\n}\n';

/** Squiggle рисуется undercurl'ом (StyleFlags.Undercurl === 8) на диапазоне ошибки. */
const UNDERCURL = 8;

// Extension-host subprocess + спавн language-сервера — Linux-only, как соседние
// стоковые LSP-сьюты (см. docs/TODO/E2E.md).
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

            // 1. Волна на кадре: пачка диагностик пережила конвертацию.
            await waitUntil(
                () => session.captureFrame(),
                (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
                { describe: "undercurl squiggle от tsserver", timeoutMs: 120_000, intervalMs: 500 },
            );

            // 2. Панель Problems (Ctrl+J) показывает ИМЕННО это сообщение —
            // маркер доехал до MarkerService, а не просто «что-то подчёркнулось».
            await session.key("Ctrl+J");
            await session.waitForText((text) => /is missing/i.test(text), { timeoutMs: 60_000, intervalMs: 500 });

            const screen = frameToText(await session.captureFrame());
            expect(screen).toMatch(/retries/);
            expect(screen).toMatch(/main\.ts/);
        });
    },
);
