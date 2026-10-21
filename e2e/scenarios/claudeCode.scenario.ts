import { resolve } from "node:path";

import { CLAUDE_CODE_ID, claudeCodeSessionEnv } from "../helpers/claudeIde.ts";
import { findTextCell } from "../helpers/frame.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Stock Anthropic.claude-code from the marketplace. Instead of the real CLI (subscription, network), a fake `claude`
// from e2e/fixtures/fakeClaude prints what the real one uses to find Diode: the IDE server port and `ideName` from
// the lock file.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "claude-code",
    title: "Claude Code (Anthropic.claude-code): '✻ Claude Code' → claude as a tab on the right",
    open: [sampleFile],
    installVsix: [CLAUDE_CODE_ID],
    network: true,
    env: claudeCodeSessionEnv(),
    cols: 140,
    rows: 30,
    // The sh stub standing in for `claude` is Linux-only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("✻ Claude Code"), { timeoutMs: 60_000 });
        await editor.capture("status-bar");

        const item = findTextCell(await editor.captureFrame(), "✻ Claude Code");
        if (item === null) throw new Error("'✻ Claude Code' item disappeared from the status bar");
        await editor.click(item.x + 2, item.y);
        const claudeReady = (t: string): boolean =>
            t.includes("Claude Code ×") && t.includes('fake-claude lock "ideName":"Diode"');
        await editor.waitForText(claudeReady, { timeoutMs: 30_000 });
        await editor.capture("claude-beside");
    },
});
