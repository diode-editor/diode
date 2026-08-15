import { createRequire } from "node:module";

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * Автодополнение стокового `typescript-language-server` в SEA-бинаре: набор
 * точки сам открывает попап с членами типа (триггер-символ объявляет сервер),
 * а Ctrl+Space при открытом попапе разворачивает панель описания, куда
 * приезжает сигнатура из отдельного `completionItem/resolve`.
 *
 * Почему e2e, а не юнит: до этой задачи конвертер стокового клиента падал на
 * каждом ответе сервера молча (ошибка только в его outputChannel), и попап
 * оставался с одними словами из буфера. Такое видно лишь на настоящем кадре.
 */

const require_ = createRequire(import.meta.url);

const LSP_SETTINGS = {
    "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
    "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
};

const DEFS_TS = 'export function greet(name: string): string {\n    return "hi " + name;\n}\n';
// Ошибка типов даёт squiggle — он же readiness-сигнал «сервер поднялся».
const MAIN_TS = 'import { greet } from "./defs";\n\nconst reply: number = greet("world");\n\nexport { reply };\n';

/** Squiggle рисуется undercurl'ом (StyleFlags.Undercurl === 8). */
const UNDERCURL = 8;

describe.skipIf(process.platform === "win32" || process.platform === "darwin")(
    "SEA binary — completion от стокового typescript-language-server",
    () => {
        beforeAll(async () => {
            await getBinaryPath();
        }, 300_000);

        it("точка открывает попап с членами типа, Ctrl+Space — панель описания", { timeout: 240_000 }, async () => {
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

            // Сервер поднялся и проиндексировал проект.
            await waitUntil(
                () => session.captureFrame(),
                (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
                { describe: "undercurl squiggle от tsserver", timeoutMs: 120_000, intervalMs: 500 },
            );

            // В конец файла, новая строка, набираем `reply.`.
            for (let i = 0; i < 6; i++) await session.key("ArrowDown");
            await session.key("End");
            await session.key("Enter");
            for (const key of ["r", "e", "p", "l", "y", "."]) await session.key(key);

            // Точка — триггер-символ сервера: попап открылся сам, и в нём члены
            // number, а не слова из буфера (их в файле нет вовсе).
            await session.waitForText((text) => text.includes("toFixed") && text.includes("toPrecision"), {
                timeoutMs: 120_000,
                intervalMs: 500,
            });

            // Ctrl+Space при открытом попапе — тумблер панели описания. Сигнатура
            // приезжает отдельным resolve уже после показа списка.
            await session.key("Ctrl+Space");
            await session.waitForText((text) => text.includes("(method)") && text.includes("Number.to"), {
                timeoutMs: 60_000,
                intervalMs: 500,
            });

            // Панель — отдельный элемент рядом со списком, а не поверх него.
            const { root } = await session.getDocument();
            const boxes: { type: string; box: { x: number; width: number } }[] = [];
            const walk = (node: { type: string; box: { x: number; width: number }; children?: unknown[] }): void => {
                boxes.push({ type: node.type, box: node.box });
                for (const child of (node.children ?? []) as typeof node[]) walk(child);
            };
            walk(root as unknown as { type: string; box: { x: number; width: number }; children?: unknown[] });

            const details = boxes.find((n) => n.type === "CompletionDetailsElement");
            const list = boxes.find((n) => n.type === "CompletionListElement");
            expect(details?.box.width).toBeGreaterThan(0);
            expect(list?.box.width).toBeGreaterThan(0);
            // Не пересекаются: панель стоит сбоку (слева или справа — как влезло).
            const [left, right] =
                details!.box.x < list!.box.x ? [details!.box, list!.box] : [list!.box, details!.box];
            expect(left.x + left.width).toBeLessThanOrEqual(right.x);
        });
    },
);
