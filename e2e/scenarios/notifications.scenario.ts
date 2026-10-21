import { resolve } from "node:path";

import { defineScenario, repoRoot, type ScenarioDriver } from "./framework.ts";

// Сообщение с кнопками — единственная дверь к регистрации у AI-автодополнений (Supermaven): проверяется
// путь ответа до расширения (строка в канале Output «Diode Notify»).

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-notifications-probe");

async function runProbeCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.sendKey("Enter");
}

export default defineScenario({
    name: "notifications",
    title: "Сообщения расширений с кнопками (show*Message) и env.openExternal",
    seedUserData: userData,
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 30,
    // Только Linux: субпроцесс расширений на Windows флейкает.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("Diode Notify"), { timeoutMs: 30000 });

        await runProbeCommand(editor, "Show Error");
        await editor.waitForText((t) => t.includes("tsserver: crashed 3 times") && t.includes("×"), {
            timeoutMs: 20000,
        });
        await editor.capture("error-toast");

        // Фокус тост не забирает — в рамке написано, как добраться до кнопок.
        await runProbeCommand(editor, "Ask Activate");
        await editor.waitForText((t) => t.includes("Use free version") && t.includes("F6"), { timeoutMs: 20000 });
        await editor.capture("question");

        await editor.sendKey("F6");
        await editor.waitForText((t) => t.includes("Enter — выбрать"));
        await editor.capture("question-focused");

        await editor.sendKey("ArrowRight");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Ask returned: Use free version"), { timeoutMs: 20000 });
        await editor.capture("answer-delivered");

        await runProbeCommand(editor, "Show Many");
        await editor.waitForText((t) => t.includes("Message one") && t.includes("more"), { timeoutMs: 20000 });
        await editor.capture("stack");

        await runProbeCommand(editor, "Clear All");
        await editor.waitForText((t) => !t.includes("Message one"), { timeoutMs: 20000 });

        // Escape отдаёт кнопку с isCloseAffordance.
        await runProbeCommand(editor, "Ask Modal");
        await editor.waitForText((t) => t.includes("Delete 12 files permanently?"), { timeoutMs: 20000 });
        await editor.capture("modal");
        await editor.sendKey("Escape");
        await editor.waitForText((t) => t.includes("Modal returned: item:Cancel"), { timeoutMs: 20000 });

        // Браузера в контейнере/по ssh нет — URL уезжает в буфер обмена и показывается сообщением.
        await runProbeCommand(editor, "Open External");
        await editor.waitForText((t) => t.includes("Ссылка скопирована в буфер обмена"), { timeoutMs: 20000 });
        await editor.capture("open-external-fallback");
        // Тост накрывает нижние ряды Output — без него свежей строки расширения на кадре не видно.
        await runProbeCommand(editor, "Clear All");
        await editor.waitForText((t) => t.includes("openExternal returned: true"), { timeoutMs: 20000 });

        await runProbeCommand(editor, "Clipboard Round Trip");
        // Ждём по началу строки: полный текст в панели Output обрезан её шириной.
        await editor.waitForText((t) => t.includes("clipboard readText: clipboard-from"), { timeoutMs: 20000 });
        await editor.capture("clipboard");
    },
});
