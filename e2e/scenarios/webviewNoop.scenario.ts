import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Webview в TUI не поддерживается — но расширение с чат-панелью обязано
// активироваться ЦЕЛИКОМ. Фикстурное расширение `chat-panel` устроено как
// настоящее: `activate()` СНАЧАЛА регистрирует webview-view-провайдер и только
// потом команду и свой output-канал. Раньше на первой же строке прилетало
// `registerWebviewViewProvider is not a function`, и вместе с панелью пропадало
// всё остальное — палитра оставалась пустой.
//
// Сценарий показывает обе половины поведения: в Output одна внятная строка про
// неподдерживаемый webview (панели при этом нет), а команда расширения видна в
// палитре и исполняется.
//
// Клавиши — через user-кейбинды: палитра возвращает фокус тому, у кого он был,
// а маршрут через меню-бар оставляет фокус в меню (общая договорённость
// сценариев, см. output/quick-open-prefill).

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-chat-panel");

export default defineScenario({
    name: "webview-noop",
    title: "Расширение с чат-панелью живёт без webview (Output + палитра)",
    seedUserData: userData,
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    // Extension-host сценарий: CI-safety-net гоняем только на Linux (как
    // inline-completion — субпроцесс расширений на Windows флейкает).
    skipOn: ["win32"],
    userKeybindings: [
        { key: "alt+u", command: "workbench.action.output.toggleOutput" },
        { key: "alt+j", command: "workbench.action.output.show.extensions" },
        { key: "f7", command: "workbench.action.showCommands", args: "Chat Panel" },
    ],
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        // Канал Extensions: одна строка отказа вместо мёртвого расширения.
        // Панели с чатом в раскладке при этом нет — её и не будет.
        await editor.sendKey("Alt+U");
        await editor.sendKey("Alt+J");
        await editor.waitForText((t) => t.includes("webview в TUI не поддерживается"), { timeoutMs: 15000 });
        await editor.capture("output-line");

        // Палитра с префиллом: команда расширения на месте — значит activate()
        // дошёл до конца, а не умер на webview-вызове.
        await editor.sendKey("F7");
        await editor.waitForText((t) => t.includes("Chat Panel: Ping"));
        await editor.capture("palette");

        // И она исполняется: расширение пишет «pong» в свой канал и показывает
        // его — Output переключается с Extensions на Chat Panel.
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("pong"), { timeoutMs: 10000 });
        await editor.capture("command-executed");
    },
});
