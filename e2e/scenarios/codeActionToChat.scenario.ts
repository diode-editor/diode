import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// A "to chat" code action shaped like stock Supermaven's: no edits, only a command that focuses a webview view.
// The TUI has no webviews, so a toast is expected rather than "Code action failed".

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-chat-panel");

export default defineScenario({
    name: "code-action-to-chat",
    title: "'To chat' code action: the action runs, and a clear toast replaces the webview panel",
    seedUserData: userData,
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    // The extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));
        // activate() registers the providers, and the host starts after the first frames: without waiting, the menu is
        // empty.
        await editor.waitForReady();

        // Ctrl+K Ctrl+Q is reachable on a legacy terminal. Wait for BOTH quick fixes: the slow provider answers after
        // the fast one.
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
