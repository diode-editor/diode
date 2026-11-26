import { resolve } from "node:path";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// The terminal-demo extension shows `window.onDidChangeTerminalState` in its `st:<shell>:<idle|typed>` status bar item.

const sampleFile = resolve(repoRoot, "AGENTS.md");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-terminal-demo");

async function runCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.waitForText((t) => t.includes(title));
    await editor.sendKey("Enter");
}

export default defineScenario({
    name: "extension-terminal-state",
    title: "Extension terminals: terminal state (shell type, typed input) and a pty that renames its tab",
    seedUserData: userData,
    open: [sampleFile],
    cols: 120,
    rows: 30,
    // Real shell.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("act:-"), { timeoutMs: 20_000 });

        await runCommand(editor, "Terminal: Create New Terminal");
        await editor.waitForText((t) => t.includes("act:") && !t.includes("act:-"), { timeoutMs: 15_000 });
        await editor.sendText("echo state");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => /st:\S+:typed/u.test(t));
        await editor.capture("typed");

        await runCommand(editor, "Terminal Demo: Self-Renaming Pty");
        await editor.waitForText((t) => t.includes("renamed by the pty") && t.includes("Pty Renamed"));
        await editor.capture("pty-renamed");
    },
});
