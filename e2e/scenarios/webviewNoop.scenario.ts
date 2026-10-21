import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Webview не поддерживается, но расширение с чат-панелью обязано активироваться целиком: `activate()`
// сначала регистрирует webview-view-провайдер. Клавиши — user-кейбинды: палитра и меню-бар уводят фокус.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-chat-panel");

export default defineScenario({
    name: "webview-noop",
    title: "Расширение с чат-панелью живёт без webview (Output + палитра)",
    seedUserData: userData,
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    // Только Linux: субпроцесс расширений на Windows флейкает.
    skipOn: ["win32"],
    userKeybindings: [
        { key: "alt+u", command: "workbench.action.output.toggleOutput" },
        { key: "alt+j", command: "workbench.action.output.show.extensions" },
        { key: "f7", command: "workbench.action.showCommands", args: "Chat Panel" },
    ],
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        await editor.sendKey("Alt+U");
        await editor.sendKey("Alt+J");
        await editor.waitForText((t) => t.includes("webview в TUI не поддерживается"), { timeoutMs: 15000 });
        await editor.capture("output-line");

        await editor.sendKey("F7");
        await editor.waitForText((t) => t.includes("Chat Panel: Ping"));
        await editor.capture("palette");

        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("pong"), { timeoutMs: 10000 });
        await editor.capture("command-executed");
    },
});
