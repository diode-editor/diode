import { resolve } from "node:path";

import { CLAUDE_CODE_ID, claudeCodeSessionEnv } from "../helpers/claudeIde.ts";
import { findTextCell } from "../helpers/frame.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Стоковый Anthropic.claude-code из магазина; вместо настоящего CLI (подписка, сеть) — подставной `claude` из
// e2e/fixtures/fakeClaude: печатает то, по чему настоящий находит Diode, — порт ide-сервера и `ideName` из лока.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "claude-code",
    title: "Claude Code (Anthropic.claude-code): «✻ Claude Code» → claude вкладкой справа",
    open: [sampleFile],
    installVsix: [CLAUDE_CODE_ID],
    network: true,
    env: claudeCodeSessionEnv(),
    cols: 140,
    rows: 30,
    // sh-заглушка вместо `claude` — только Linux.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("✻ Claude Code"), { timeoutMs: 60_000 });
        await editor.capture("status-bar");

        const item = findTextCell(await editor.captureFrame(), "✻ Claude Code");
        if (item === null) throw new Error("пункт «✻ Claude Code» пропал из статус-бара");
        await editor.click(item.x + 2, item.y);
        const claudeReady = (t: string): boolean =>
            t.includes("Claude Code ×") && t.includes('fake-claude lock "ideName":"Diode"');
        await editor.waitForText(claudeReady, { timeoutMs: 30_000 });
        await editor.capture("claude-beside");
    },
});
