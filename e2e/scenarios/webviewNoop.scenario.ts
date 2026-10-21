import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Webview is not supported, but an extension with a chat panel must still activate fully: `activate()` registers the
// webview view provider first. Keys are user keybindings: the command palette and the menu bar steal focus.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-chat-panel");

export default defineScenario({
    name: "webview-noop",
    title: "Расширение с чат-панелью живёт без webview (Output + палитра)",
    seedUserData: userData,
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    // Linux only: the extension host subprocess is flaky on Windows.
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
