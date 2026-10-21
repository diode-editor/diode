import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Code action «в чат» в форме стокового Supermaven: действие без правок, только команда, которая фокусирует
// webview-вид; webview в TUI нет, поэтому ожидается тост, а не «Code action failed».

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-chat-panel");

export default defineScenario({
    name: "code-action-to-chat",
    title: "Code action «в чат»: действие исполняется, вместо webview-панели — внятный тост",
    seedUserData: userData,
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    // Субпроцесс расширений на Windows флейкает.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));
        // Провайдеры регистрирует activate(), а хост поднимается после первых кадров: без ожидания меню пустое.
        await editor.waitForReady();

        // Ctrl+K Ctrl+Q досягаем на legacy-терминале. Ждём ОБА quickfix'а: медленный провайдер отвечает позже быстрого.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+Q");
        await editor.waitForText(
            (t) =>
                t.includes("Fix with Chat Panel") &&
                t.includes("Explain with Chat Panel") &&
                !t.includes("Rewrite with Chat Panel"),
            { timeoutMs: 30000 },
        );
        await editor.capture("menu");

        await editor.sendText("Fix with Chat");
        await editor.waitForText((t) => t.includes("Fix with Chat Panel") && !t.includes("Explain with Chat Panel"));
        await editor.sendKey("Enter");

        await editor.waitForText((t) => t.includes(`view "Chat" is a webview`) && !t.includes("Code action failed"), {
            timeoutMs: 15000,
        });
        await editor.capture("toast");
    },
});
