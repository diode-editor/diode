import { beforeAll, describe, expect, it } from "vitest";

import { BASEDPYRIGHT_ID } from "../src/TestUtils/basedpyrightFixture.ts";
import { MARKETPLACE_OFFLINE } from "../src/TestUtils/marketplaceEnv.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * Клиент внутри vsix форкает вшитый сервер (TransportKind.ipc → fork process.execPath) —
 * это и есть прогон env-фикса runAsNode под SEA.
 */

const DEFS_PY = 'def greet(name: str) -> str:\n    return "hi " + name\n';
// Ошибка типов — для squiggle (readiness).
const MAIN_PY = 'from defs import greet\n\nreply: int = greet("world")\nprint(reply)\n';

const UNDERCURL = 8;

const FILES = { "defs.py": DEFS_PY, "main.py": MAIN_PY };

async function waitForServerReady(session: {
    captureFrame: () => Promise<{ cells: { style: number }[] }>;
}): Promise<void> {
    await waitUntil(
        () => session.captureFrame(),
        (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
        { describe: "undercurl squiggle от basedpyright", timeoutMs: 180_000, intervalMs: 500 },
    );
}

// Только Linux: extension host + форк language-сервера (docs/TODO/E2E.md).
describe.skipIf(process.platform === "win32" || process.platform === "darwin" || MARKETPLACE_OFFLINE)(
    "SEA binary — стоковый basedpyright.vsix (Python LSP)",
    () => {
        beforeAll(async () => {
            await getBinaryPath();
        }, 300_000);

        it("hover: Ctrl+K Ctrl+U показывает сигнатуру из другого файла", { timeout: 300_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: FILES,
                installVsix: [BASEDPYRIGHT_ID],
                open: ["main.py"],
            });
            await session.waitForNode("EditorElement");
            await waitForServerReady(session);

            // Каретка на `greet` в вызове (строка 2, колонка 15) и Ctrl+K Ctrl+U.
            await session.key("ArrowDown");
            await session.key("ArrowDown");
            for (let i = 0; i < 15; i++) await session.key("ArrowRight");
            await session.key("Ctrl+K");
            await session.key("Ctrl+U");

            // Сигнатура из объявления в defs.py — в буфере main.py её нет.
            await session.waitForText((text) => text.includes("greet(name: str) -> str"), {
                timeoutMs: 60_000,
                intervalMs: 500,
            });

            await session.key("Escape");
            const frame = await waitUntil(
                () => session.captureFrame(),
                (f) => !frameToText(f).includes("greet(name: str) -> str"),
                { describe: "hover-попап закрыт по Escape", timeoutMs: 30_000, intervalMs: 250 },
            );
            expect(frameToText(frame)).toContain('reply: int = greet("world")');
        });

        it("F12 прыгает в объявление greet в defs.py", { timeout: 300_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: FILES,
                installVsix: [BASEDPYRIGHT_ID],
                open: ["main.py"],
            });
            await session.waitForNode("EditorElement");
            await waitForServerReady(session);

            await session.key("ArrowDown");
            await session.key("ArrowDown");
            for (let i = 0; i < 15; i++) await session.key("ArrowRight");
            await session.key("F12");

            // Каретка на объявлении (0-based 0:4).
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
                    return active?.line === 0 && active.character === 4;
                },
                { timeoutMs: 30_000 },
            );
        });

        it("точка открывает попап с членами int из typeshed", { timeout: 300_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: FILES,
                installVsix: [BASEDPYRIGHT_ID],
                open: ["main.py"],
            });
            await session.waitForNode("EditorElement");
            await waitForServerReady(session);

            await session.key("Ctrl+End");
            // Нажатиями: триггер-символ открывает попап только набором, не вставкой.
            for (const char of "reply.") await session.key(char);

            // Пункты из НАЧАЛА алфавитного списка: ниже LSP-пунктов стоят word-based кандидаты
            // буфера, и хвост (bit_length, to_bytes) — за пределами видимых строк.
            await session.waitForText((text) => text.includes("as_integer_ratio") && text.includes("bit_count"), {
                timeoutMs: 120_000,
                intervalMs: 500,
            });
        });

        it("«(» открывает подсказку параметров с сигнатурой greet", { timeout: 300_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: FILES,
                installVsix: [BASEDPYRIGHT_ID],
                open: ["main.py"],
            });
            await session.waitForNode("EditorElement");
            await waitForServerReady(session);

            await session.key("Ctrl+End");
            for (const char of "greet(") await session.key(char);

            await session.waitForText((text) => text.includes("(name: str) -> str"), {
                timeoutMs: 60_000,
                intervalMs: 500,
            });
        });

        it("Ctrl+K Ctrl+R собирает ссылки из двух файлов во вьюлет REFERENCES", { timeout: 300_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: FILES,
                installVsix: [BASEDPYRIGHT_ID],
                // Вьюлет сайдбара собирается только при открытой папке (см. references.test.ts).
                open: [".", "main.py"],
            });
            await session.waitForNode("EditorElement");
            await waitForServerReady(session);

            await session.key("ArrowDown");
            await session.key("ArrowDown");
            for (let i = 0; i < 15; i++) await session.key("ArrowRight");
            await session.key("Ctrl+K");
            await session.key("Ctrl+R");

            // Строка объявления добрана из defs.py, которого нет в открытом буфере.
            await session.waitForText((text) => text.includes("results in 2") && text.includes("def greet"), {
                timeoutMs: 120_000,
                intervalMs: 500,
            });
        });
    },
);
