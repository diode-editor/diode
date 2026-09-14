import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const userData = resolve(here, "fixtures", "user-data-with-inline-ghost");

const FIB_BODY = "onacci(n) {\n    if (n <= 1) return n;\n    return fibonacci(n - 1) + fibonacci(n - 2);\n}";

interface IGhostState {
    line: number;
    character: number;
    lines: string[];
}

// Extension-host субпроцесс на Windows в e2e флейкает (см. docs/TESTING.md).
const describeLinuxOnly = process.platform === "linux" ? describe : describe.skip;

/**
 * Ждёт появления ghost text, перепечатывая последний символ триггера при
 * неудаче: расширение активируется асинхронно (на медленном раннере — секундами
 * после открытия файла), а запрос, ушедший до регистрации провайдера,
 * возвращает пусто. Backspace+символ — новая правка → новый авто-запрос
 * (паттерн region-folding: retry до признака, который даёт только провайдер).
 */
async function waitForGhostRetyping(
    session: {
        key(name: string): Promise<void>;
        waitForState(
            selector: string,
            predicate: (s: Record<string, unknown> | undefined) => boolean,
            opts?: { timeoutMs?: number },
        ): Promise<{ state?: Record<string, unknown> }>;
    },
    lastChar: string,
): Promise<{ state?: Record<string, unknown> }> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await session.waitForState("EditorElement", (s) => (s?.ghostText ?? null) !== null, {
                timeoutMs: 2000,
            });
        } catch (error) {
            if (attempt >= 10) throw error;
            await session.key("Backspace");
            await session.key(lastChar);
        }
    }
}

// Призрачные подсказки end-to-end на настоящем бинаре: фикстурное расширение
// inline-ghost (канированный «LLM» с задержкой ответа) — набор текста рисует
// ghost text, Esc гасит, Tab принимает одной undo-правкой. Ассерты — по
// inspectState (ghostText/viewZones/lineCount): фантом не должен менять документ.
describeLinuxOnly("inline completions — ghost text from a user extension", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 180_000);

    it("набор триггера показывает ghost text, Tab принимает одной правкой, undo снимает целиком", async () => {
        const { session } = await useHeadlessApp({
            seedUserData: userData,
            files: { "sample.ts": "// Fibonacci demo\n" },
            open: ["sample.ts"],
        });
        await session.waitForNode("EditorElement");
        await session.key("End");
        await session.key("Enter");
        await session.text("function fib");

        // Ghost появился (inspectState) и дорисован в кадре, а документ не
        // изменился: строк по-прежнему 3 (фантом живёт в view zones).
        const withGhost = await waitForGhostRetyping(session, "b");
        const ghost = withGhost.state?.ghostText as IGhostState;
        expect(ghost).toEqual({ line: 1, character: 12, lines: FIB_BODY.split("\n") });
        expect(withGhost.state?.viewZones).toEqual([{ afterLine: 1, size: 3 }]);
        expect(withGhost.state?.lineCount).toBe(3); // «// Fibonacci demo», «function fib», хвостовая пустая
        await session.waitForText((t) => t.includes("return fibonacci(n - 1)"), { timeoutMs: 5000 });

        // Tab принимает подсказку целиком: строки стали настоящими (lineCount
        // 3 → 6), ghost и зоны сняты, каретка в конце вставки.
        await session.key("Tab");
        const accepted = await session.waitForState(
            "EditorElement",
            (s) => s?.ghostText === null && s?.lineCount === 6,
            { timeoutMs: 5000 },
        );
        expect(accepted.state?.viewZones).toEqual([]);
        await session.waitForText((t) => t.includes("Ln 5"), { timeoutMs: 5000 });

        // Принятие — одна undo-операция: Ctrl+Z снимает ВСЮ вставку разом.
        await session.key("Ctrl+Z");
        await session.waitForState("EditorElement", (s) => s?.lineCount === 3, { timeoutMs: 5000 });
    }, 120_000);

    it("Escape гасит подсказку, не трогая документ", async () => {
        const { session } = await useHeadlessApp({
            seedUserData: userData,
            files: { "sample.ts": "const x = 1\n" },
            open: ["sample.ts"],
        });
        await session.waitForNode("EditorElement");
        await session.key("End");
        await session.key("Enter");
        await session.text("const greeting");

        await waitForGhostRetyping(session, "g");

        await session.key("Escape");
        const hidden = await session.waitForState("EditorElement", (s) => s?.ghostText === null, {
            timeoutMs: 5000,
        });
        // Документ не изменился: однострочный фантом зон не заводил, строк 3.
        expect(hidden.state?.viewZones).toEqual([]);
        expect(hidden.state?.lineCount).toBe(3);
    }, 120_000);
});
