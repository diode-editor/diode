import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Призрачные подсказки (inline suggest, ghost text): фикстурное расширение
// `inline-ghost` — фейковый «LLM» с канированными продолжениями и задержкой
// ответа ~250 мс. Печатаем `function fib` — серым курсивом дорисовывается
// многострочное тело функции (первая строка — хвост строки каретки, остальные —
// view zones без номеров строк); Tab принимает подсказку одной правкой, и
// строки становятся настоящими (у них появляются номера в гуттере).

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "ghost-sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-inline-ghost");

export default defineScenario({
    name: "inline-completion",
    title: "Ghost text from an inline completion provider (Tab to accept)",
    seedUserData: userData,
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 24,
    // Extension-host сценарий: CI-safety-net гоняем только на Linux (субпроцесс
    // расширений на Windows флейкает — как settings-completion).
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("Fibonacci demo"));

        // Новая строка под комментарием; набираем триггер фейкового «LLM».
        await editor.sendKey("End");
        await editor.sendKey("Enter");
        await editor.sendText("function fib");

        // Ghost text дорисовался за кареткой: тела функции НЕТ в буфере — это
        // фантом (в т.ч. строки-зоны ниже, у них пустой гуттер). Расширение
        // активируется асинхронно — при неудаче перепечатываем последний символ
        // (новая правка → новый авто-запрос), паттерн region-folding.
        //
        // Esc после перепечатки — обязателен, а не подстраховка: набор `b`
        // поднимает word-based попап («Fibonacci» лежит в самом буфере), а
        // `InlineCompletionsService.trigger` при открытом попапе выходит сразу —
        // призраку некуда встать. Без Esc первая же ретрая гасила подсказку
        // навсегда, и все 10 попыток крутились впустую: сценарий проходил
        // только когда призрак успевал к ПЕРВОМУ ожиданию (на загруженной
        // машине — примерно в двух прогонах из трёх). Esc закрывает попап, а
        // закрытие пере-сеет inline-состояние (onDidClose) — это штатный путь
        // «Esc по попапу приводит призрака».
        let ghostShown = false;
        for (let attempt = 0; attempt < 10 && !ghostShown; attempt++) {
            try {
                await editor.waitForText((t) => t.includes("return fibonacci(n - 1)"), { timeoutMs: 2000 });
                ghostShown = true;
            } catch {
                await editor.sendKey("Backspace");
                await editor.sendKey("b");
                await editor.sendKey("Escape");
            }
        }
        if (!ghostShown) throw new Error("inline-completion: ghost text не появился за 10 попыток");
        await editor.capture("ghost");

        // Tab принимает подсказку целиком: строки становятся настоящими, а
        // каретка уезжает в конец вставки — статус-бар показывает Ln 5 (пока
        // текст был фантомом, каретка стояла на Ln 2 и «Ln 5» в кадре не было).
        await editor.sendKey("Tab");
        await editor.waitForText((t) => t.includes("Ln 5"), { timeoutMs: 4000 });
        await editor.capture("accepted");
    },
});
