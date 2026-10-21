import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Фикстура `inline-ghost` — фейковый «LLM» с канированными продолжениями и задержкой ответа ~250 мс.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "ghost-sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-inline-ghost");

export default defineScenario({
    name: "inline-completion",
    title: "Ghost text from an inline completion provider (Tab to accept)",
    seedUserData: userData,
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 24,
    // Субпроцесс расширений на Windows флейкает.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("Fibonacci demo"));

        await editor.sendKey("End");
        await editor.sendKey("Enter");
        await editor.sendText("function fib");

        // Расширение активируется асинхронно — при неудаче перепечатываем последний символ (новая правка → новый запрос).
        // Esc перед перепечаткой — против гонки активации: пока провайдера нет, попап по словам открывается, а под ним
        // призрак не рисуется.
        let ghostShown = false;
        for (let attempt = 0; attempt < 10 && !ghostShown; attempt++) {
            try {
                await editor.waitForText((t) => t.includes("return fibonacci(n - 1)"), { timeoutMs: 2000 });
                ghostShown = true;
            } catch {
                await editor.sendKey("Escape");
                await editor.sendKey("Backspace");
                await editor.sendKey("b");
            }
        }
        if (!ghostShown) throw new Error("inline-completion: ghost text не появился за 10 попыток");
        await editor.capture("ghost");

        // Пока текст был фантомом, каретка стояла на Ln 2 — «Ln 5» доказывает вставку.
        await editor.sendKey("Tab");
        await editor.waitForText((t) => t.includes("Ln 5"), { timeoutMs: 4000 });
        await editor.capture("accepted");

        // Заявка n-4: каретка в середине строки — призрак встаёт между кареткой и хвостом, а не поверх.
        await editor.sendKey("End");
        await editor.sendKey("Enter");
        await editor.sendText("// greeting for the demo");
        await editor.sendKey("Home");
        await editor.sendText("const greeting");
        let midLineShown = false;
        for (let attempt = 0; attempt < 10 && !midLineShown; attempt++) {
            try {
                await editor.waitForText((t) => t.includes('greeting = "Hello from ghost text!";// greeting'), {
                    timeoutMs: 2000,
                });
                midLineShown = true;
            } catch {
                await editor.sendKey("Escape");
                await editor.sendKey("Backspace");
                await editor.sendKey("g");
            }
        }
        if (!midLineShown) throw new Error("inline-completion: призрак в середине строки не появился за 10 попыток");
        await editor.capture("ghost-mid-line");

        // Col 43 = 14 набранных + 28 вставленных + 1.
        await editor.sendKey("Tab");
        await editor.waitForText((t) => t.includes("Col 43"), { timeoutMs: 4000 });
        await editor.capture("mid-line-accepted");
    },
});
