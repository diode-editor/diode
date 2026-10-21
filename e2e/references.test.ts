import { createRequire } from "node:module";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * Почему e2e: строки кода, которых нет в открытом буфере, добирает наш слой превью,
 * читая соседний файл, — стык сервер → превью → строка списка → кадр юниты не видят.
 */

const require_ = createRequire(import.meta.url);

const LSP_SETTINGS = {
    "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
    "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
};

const DEFS_TS = 'export function greet(name: string): string {\n    return "hi " + name;\n}\n';
// Ошибка типов даёт squiggle — он же readiness-сигнал «сервер поднялся».
const MAIN_TS = 'import { greet } from "./defs";\n\nconst reply: number = greet("world");\n\nexport { reply };\n';

const UNDERCURL = 8;

/** Держится ли предикат на кадре в ближайшие пару секунд (без падения по таймауту). */
async function holdsSoon(
    session: { captureFrame(): Promise<GridSnapshot> },
    predicate: (text: string) => boolean,
): Promise<boolean> {
    for (let i = 0; i < 20; i++) {
        if (predicate(frameToText(await session.captureFrame()))) return true;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
}

describe.skipIf(process.platform === "win32" || process.platform === "darwin")(
    "SEA binary — Find All References от стокового typescript-language-server",
    () => {
        beforeAll(async () => {
            await getBinaryPath();
        }, 300_000);

        it("панель собирает ссылки из двух файлов, Enter и F4 водят по ним", { timeout: 240_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: {
                    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
                    "defs.ts": DEFS_TS,
                    "main.ts": MAIN_TS,
                },
                settings: LSP_SETTINGS,
                // Вьюлеты сайдбара (в том числе REFERENCES) собираются на workspaceFolder — без папки
                // панели нет вовсе.
                open: [".", "main.ts"],
            });
            await session.waitForNode("EditorElement");

            await waitUntil(
                () => session.captureFrame(),
                (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
                { describe: "undercurl squiggle от tsserver", timeoutMs: 120_000, intervalMs: 500 },
            );

            // Каретка на вызов `greet` (строка 3, колонка 23) и Find All References.
            await session.key("ArrowDown");
            await session.key("ArrowDown");
            for (let i = 0; i < 23; i++) await session.key("ArrowRight");
            await session.key("Ctrl+K");
            await session.key("Ctrl+R");

            await session.waitForText(
                // `export function greet` есть только в defs.ts.
                (text) => text.includes("REFERENCES") && text.includes("results in 2") && text.includes("export function greet"),
                { timeoutMs: 120_000, intervalMs: 500 },
            );

            // Порядок ссылок задаёт сервер, «первая» — не обязательно объявление: идём по F4,
            // пока не попадём в defs.ts. Важно, что обход уводит редактор в ДРУГОЙ файл.
            let reachedDefs = false;
            for (let step = 0; step < 4 && !reachedDefs; step++) {
                await session.key(step === 0 ? "Enter" : "F4");
                reachedDefs = await holdsSoon(session, (text) => text.includes('return "hi " + name'));
            }
            expect(reachedDefs, "обход ссылок не привёл в defs.ts").toBe(true);

            // Панель на месте и после переходов: результат живёт до следующего поиска.
            const frame = frameToText(await session.captureFrame());
            expect(frame).toContain("REFERENCES");
        });
    },
);
