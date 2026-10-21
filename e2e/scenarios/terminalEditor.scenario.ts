import { resolve } from "node:path";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// Форма `claude-vscode.terminal.open` стокового Claude Code: `createTerminal({ location: { viewColumn: Beside } })` + `show()`.

const sampleFile = resolve(repoRoot, "AGENTS.md");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-terminal-demo");

/**
 * Строки «agent ready» в команде нет — совпадает только вывод. Саму команду ждать нельзя: в узкой группе
 * справа она переносится по длине промпта.
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
    // Extension-host сценарий с настоящим шеллом — только Linux/macOS, как extension-terminal.
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
