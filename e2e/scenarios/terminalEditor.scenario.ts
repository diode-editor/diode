import { resolve } from "node:path";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// The shape of stock Claude Code's `claude-vscode.terminal.open`:
// `createTerminal({ location: { viewColumn: Beside } })` + `show()`.

const sampleFile = resolve(repoRoot, "AGENTS.md");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-terminal-demo");

/**
 * The command does not contain the string "agent ready", so only the output matches. Waiting for the command itself
 * is unreliable: in the narrow group on the right it wraps depending on the prompt length.
 */
const echoed = (t: string): boolean => t.includes("agent ready");

async function runCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.waitForText((t) => t.includes(title));
    await editor.sendKey("Enter");
}

export default defineScenario({
    name: "terminal-editor",
    title: "Терминал вкладкой справа: window.createTerminal({ location: { viewColumn: Beside } })",
    seedUserData: userData,
    open: [sampleFile],
    cols: 120,
    rows: 30,
    // Extension host scenario with a real shell — Linux/macOS only, like extension-terminal.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("act:-"), { timeoutMs: 20_000 });

        await runCommand(editor, "Terminal Demo: Open Agent Beside");
        await editor.waitForText((t) => t.includes("Demo Agent ×") && echoed(t), { timeoutMs: 15_000 });
        await editor.waitForText((t) => t.includes("ls:Demo Agent"));
        await editor.capture("agent-beside");

        await runCommand(editor, "Terminal: Move Terminal into Panel");
        await editor.waitForText((t) => t.includes("TERMINAL") && !t.includes("Demo Agent ×"));
        await editor.waitForText(echoed);
        await editor.capture("moved-to-panel");

        await runCommand(editor, "Terminal: Move Terminal into Editor Area");
        await editor.waitForText((t) => t.includes("Demo Agent ×") && echoed(t));
        await editor.capture("moved-back");
        await editor.sendKey("Ctrl+W");
        await editor.waitForText((t) => !t.includes("Demo Agent ×") && t.includes("ev:close3"));
        await editor.capture("closed");
    },
});
