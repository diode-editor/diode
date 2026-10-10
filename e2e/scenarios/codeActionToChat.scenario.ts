import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Code action «в чат» у расширения с webview-чатом — форма стокового Supermaven
// («Fix with Supermaven»). Действие без правок: только команда с
// `vscode.Position` в аргументах, а её обработчик без await зовёт
// `chatPanel.chatView.focus` и шлёт сообщение в webview. Раньше пользователь
// видел «Code action failed»: меню собирается из ответов нескольких
// провайдеров, и кэш субпроцесса вытеснял действие самого быстрого раньше, чем
// его выбирали. Теперь действие исполняется, а вместо панели чата (webview в
// TUI не будет) — внятный тост от команды `<вид>.focus`.
//
// Заодно видно `CodeAction.disabled`: неактивный «Rewrite with Chat Panel»
// Quick Fix не показывает (как эталон).

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-chat-panel");

export default defineScenario({
    name: "code-action-to-chat",
    title: "Code action «в чат»: действие исполняется, вместо webview-панели — внятный тост",
    seedUserData: userData,
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    // Extension-host сценарий: субпроцесс расширений на Windows флейкает (как webview-noop).
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        // Меню code actions у каретки (Ctrl+K Ctrl+Q — досягаемый на legacy бинд).
        // Ждём ОБА quickfix'а расширения: медленный отвечает позже быстрого.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+Q");
        // Неактивный рефакторинг в Quick Fix не попадает.
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

        // Тост команды `<вид>.focus` — и никакого «Code action failed».
        await editor.waitForText((t) => t.includes(`view "Chat" is a webview`) && !t.includes("Code action failed"), {
            timeoutMs: 15000,
        });
        await editor.capture("toast");
    },
});
