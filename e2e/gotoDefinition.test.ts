import { createRequire } from "node:module";

import { beforeAll, describe, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/** Правки НЕ сохраняются на диск — сервер обязан видеть живой буфер (didChange). */

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

            // Squiggle от tsserver — readiness-сигнал «сервер проиндексировал проект».
            await waitUntil(
                () => session.captureFrame(),
                (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
                { describe: "undercurl squiggle от tsserver", timeoutMs: 120_000, intervalMs: 500 },
            );

            // Несохранённая правка: вызов greet съезжает на строку 4.
            await session.key("Enter");
            await session.key("Enter");

            // 3. Каретка на `greet` в вызове (строка 4, колонка 23) и F12.
            await session.key("ArrowDown");
            await session.key("ArrowDown");
            for (let i = 0; i < 23; i++) await session.key("ArrowRight");
            await session.key("F12");

            // Каретка на объявлении greet в defs.ts (0-based 0:16).
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
