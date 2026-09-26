import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const userData = resolve(here, "fixtures", "user-data-with-inline-ghost");

const FIB_BODY = "onacci(n) {\n    if (n <= 1) return n;\n    return fibonacci(n - 1) + fibonacci(n - 2);\n}";
/** Продолжение фикстурного провайдера для триггера «const greeting». */
const GREETING_BODY = ' = "Hello from ghost text!";';

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

    it("Esc закрывает suggest-попап — и призрак появляется без дополнительной правки", async () => {
        const { session } = await useHeadlessApp({
            seedUserData: userData,
            // Слово «fibber» в буфере держит word-based попап живым на «fib»:
            // на полном триггере призрака попап гарантированно открыт.
            files: { "sample.ts": "// fibber demo\n" },
            open: ["sample.ts"],
        });
        await session.waitForNode("EditorElement");
        await session.key("End");
        await session.key("Enter");
        // До полного триггера: попап открываем ЯВНО (Ctrl+Space, «fi» —
        // префикс «fibber»), чтобы правка ниже гарантированно пришлась на
        // открытый попап — без гонки с таймингами авто-suggest.
        await session.text("function fi");
        await session.key("Ctrl+Space");
        await session.waitForNode("CompletionListElement", { timeoutMs: 5000 });

        // Правка при открытом попапе: запрос призрака дропается гейтом —
        // подсказка НЕ показывается, попап остаётся («fib» всё ещё префикс).
        await session.key("b");
        await session.waitForNode("CompletionListElement", { timeoutMs: 5000 });
        const held = await session.node("EditorElement");
        expect(held?.state?.ghostText ?? null).toBeNull();

        // Esc закрывает попап; повторный запрос уходит сам — БЕЗ новой правки.
        await session.key("Escape");
        await session.waitForNoNode("CompletionListElement", { timeoutMs: 5000 });
        const withGhost = await session.waitForState(
            "EditorElement",
            (s) => (s?.ghostText ?? null) !== null,
            { timeoutMs: 5000 },
        );
        expect((withGhost.state?.ghostText as IGhostState).lines[0]).toBe("onacci(n) {");
    }, 120_000);

    // Заявка n-4: каретка в середине строки (типичный случай — внутри скобок,
    // в середине объекта). Пользователь ждёт призрака между кареткой и хвостом
    // строки; сегодня подсказка не показывается вовсе.
    it("каретка в середине строки: призрак рисуется перед хвостом, Tab вставляет, Esc возвращает строку", async () => {
        const { session } = await useHeadlessApp({
            seedUserData: userData,
            // Во второй строке заранее лежит хвост «)» — наберём триггер перед ним.
            files: { "sample.ts": "// demo\n)\n" },
            open: ["sample.ts"],
        });
        await session.waitForNode("EditorElement");
        await session.key("ArrowDown");
        await session.key("Home");
        await session.text("const greeting");

        // Призрак пришёл на каретку (колонка 14), хвост строки — за ним.
        const withGhost = await waitForGhostRetyping(session, "g");
        const ghost = withGhost.state?.ghostText as IGhostState;
        expect(ghost).toEqual({ line: 1, character: 14, lines: [GREETING_BODY] });
        // Кадр: пользователь видит и подсказку, и свой хвост «)».
        await session.waitForText((t) => t.includes(`const greeting${GREETING_BODY})`), { timeoutMs: 5000 });
        // Документ фантом не трогает: строк по-прежнему 3.
        expect(withGhost.state?.lineCount).toBe(3);

        // Tab вставляет подсказку в середину строки: каретка — за вставкой,
        // перед хвостом; хвост «)» на месте.
        await session.key("Tab");
        const accepted = await session.waitForState("EditorElement", (s) => s?.ghostText === null, {
            timeoutMs: 5000,
        });
        expect(accepted.state?.selections).toEqual([
            {
                anchor: { line: 1, character: 14 + GREETING_BODY.length },
                active: { line: 1, character: 14 + GREETING_BODY.length },
                collapsed: true,
            },
        ]);
        await session.waitForText((t) => t.includes(`const greeting${GREETING_BODY})`), { timeoutMs: 5000 });

        // Undo — и строка снова «const greeting)», без хвоста подсказки.
        await session.key("Ctrl+Z");
        await session.waitForText((t) => !t.includes("Hello from ghost text"), { timeoutMs: 5000 });
    }, 120_000);

    it("каретка в середине строки: Esc гасит призрака и возвращает строку в исходный вид", async () => {
        const { session } = await useHeadlessApp({
            seedUserData: userData,
            files: { "sample.ts": "// demo\n)\n" },
            open: ["sample.ts"],
        });
        await session.waitForNode("EditorElement");
        await session.key("ArrowDown");
        await session.key("Home");
        await session.text("const greeting");

        await waitForGhostRetyping(session, "g");

        await session.key("Escape");
        const hidden = await session.waitForState("EditorElement", (s) => s?.ghostText === null, {
            timeoutMs: 5000,
        });
        expect(hidden.state?.lineCount).toBe(3);
        await session.waitForText((t) => !t.includes("Hello from ghost text"), { timeoutMs: 5000 });
        await session.waitForText((t) => t.includes("const greeting)"), { timeoutMs: 5000 });
    }, 120_000);

    // Ручной режим: `enabled: false` гейтит ТОЛЬКО автозапрос (как в vscode),
    // команда `editor.action.inlineSuggest.trigger` работает независимо.
    // Клавиша — Alt+\ (терминал шлёт её как ESC + `\`).
    it("enabled:false — набор призрака не зовёт, Alt+\\ зовёт", async () => {
        const { session } = await useHeadlessApp({
            seedUserData: userData,
            settings: { "editor.inlineSuggest.enabled": false },
            files: { "sample.ts": "// Fibonacci demo\n" },
            open: ["sample.ts"],
        });
        await session.waitForNode("EditorElement");
        await session.key("End");
        await session.key("Enter");
        await session.text("function fib");

        // Расширение активируется асинхронно; ждём его готовности по контрольному
        // Alt+\ — и он же первый ассерт: ручной триггер работает при выключенной
        // настройке. Ретраи нужны только против гонки активации.
        let ghost: IGhostState | null = null;
        for (let attempt = 0; attempt < 15 && ghost === null; attempt++) {
            await session.key("Alt+\\");
            try {
                const shown = await session.waitForState(
                    "EditorElement",
                    (s) => (s?.ghostText ?? null) !== null,
                    { timeoutMs: 2000 },
                );
                ghost = shown.state?.ghostText as IGhostState;
            } catch {
                // провайдер ещё не зарегистрирован — пробуем ещё раз
            }
        }
        if (ghost === null) throw new Error("Alt+\\ не показал призрака за 15 попыток");
        expect(ghost.lines[0]).toBe("onacci(n) {");

        // А теперь — главное: при выключённой настройке НАБОР призрака не зовёт.
        // Esc гасит показанного, печатаем новый триггер и ждём заведомо дольше
        // дефолтного дебаунса (50 мс) и задержки ответа фикстуры (250 мс).
        await session.key("Escape");
        await session.waitForState("EditorElement", (s) => s?.ghostText === null, { timeoutMs: 5000 });
        await session.key("Enter");
        await session.text("const greeting");
        await new Promise((r) => setTimeout(r, 3000));
        const quiet = await session.node("EditorElement");
        expect(quiet?.state?.ghostText ?? null).toBeNull();

        // …и та же позиция по Alt+\ призрака отдаёт: молчал гейт, а не провайдер.
        await session.key("Alt+\\");
        const manual = await session.waitForState("EditorElement", (s) => (s?.ghostText ?? null) !== null, {
            timeoutMs: 5000,
        });
        expect((manual.state?.ghostText as IGhostState).lines[0]).toBe(GREETING_BODY);
    }, 120_000);

    // `requestTimeout` читается на КАЖДЫЙ запрос: провайдер, отвечающий дольше
    // дефолтных 5000 мс, при поднятой настройке дожидается.
    it("requestTimeout даёт дождаться провайдера, который не успевает за дефолт", async () => {
        const { session } = await useHeadlessApp({
            seedUserData: userData,
            settings: {
                // Фикстура отвечает через 7 с — дефолтные 5000 мс это не переживают.
                "inlineGhost.responseDelay": 7000,
                "editor.inlineSuggest.requestTimeout": 20000,
            },
            files: { "sample.ts": "// Fibonacci demo\n" },
            open: ["sample.ts"],
        });
        await session.waitForNode("EditorElement");
        await session.key("End");
        await session.key("Enter");
        await session.text("function fib");

        // Ждём дольше 7 с — при дефолтном таймауте призрака бы не было вовсе.
        // Ретраи против гонки активации: каждый заход — новая правка (новый запрос).
        let ghost: IGhostState | null = null;
        for (let attempt = 0; attempt < 3 && ghost === null; attempt++) {
            try {
                const shown = await session.waitForState(
                    "EditorElement",
                    (s) => (s?.ghostText ?? null) !== null,
                    { timeoutMs: 12_000 },
                );
                ghost = shown.state?.ghostText as IGhostState;
            } catch {
                await session.key("Backspace");
                await session.key("b");
                await session.key("Escape");
            }
        }
        if (ghost === null) throw new Error("медленный провайдер так и не дождался показа");
        expect(ghost.lines[0]).toBe("onacci(n) {");
    }, 180_000);

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
