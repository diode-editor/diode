import { resolve } from "node:path";

import { frameToText } from "../helpers/frame.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// `editor.inlineSuggest.enabled: false` гейтит только автозапрос, как в VS Code: на той же позиции Alt+\ приводит
// призрака того же провайдера.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "ghost-sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-inline-ghost");

export default defineScenario({
    name: "inline-suggest-settings",
    title: "Manual inline suggestions: editor.inlineSuggest.enabled=false + Alt+\\",
    seedUserData: userData,
    settings: {
        "editor.inlineSuggest.enabled": false,
        // Быстрый ответ: сценарию важен гейт, а не медлительность провайдера.
        "inlineGhost.responseDelay": 50,
    },
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

        // Сначала контрольный Alt+\ доказывает, что провайдер жив: иначе «призрака нет» неотличимо от «расширение ещё
        // не поднялось».
        let ready = false;
        for (let attempt = 0; attempt < 15 && !ready; attempt++) {
            await editor.sendKey("Alt+\\");
            try {
                await editor.waitForText((t) => t.includes("return fibonacci(n - 1)"), { timeoutMs: 2000 });
                ready = true;
            } catch {
                // провайдер ещё не зарегистрирован — пробуем ещё раз
            }
        }
        if (!ready) throw new Error("inline-suggest-settings: Alt+\\ не показал призрака за 15 попыток");

        await editor.sendKey("Escape");
        await editor.sendKey("Enter");
        await editor.sendText("const greeting");
        await new Promise((r) => setTimeout(r, 3000));
        const quietText = frameToText(await editor.captureFrame());
        if (quietText.includes("Hello from ghost text!")) {
            throw new Error("inline-suggest-settings: призрак пришёл сам при enabled:false");
        }
        await editor.capture("manual-quiet");

        await editor.sendKey("Alt+\\");
        await editor.waitForText((t) => t.includes("Hello from ghost text!"), { timeoutMs: 5000 });
        await editor.capture("manual-triggered");

        await editor.sendKey("Tab");
        await editor.waitForText((t) => t.includes("Col 43"), { timeoutMs: 5000 });
        await editor.capture("accepted");
    },
});
