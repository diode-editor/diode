import { resolve } from "node:path";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// A second, 3-second message on top of the first — this is how Claude Code hints during a diff review.

const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-status-message");

async function runCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.waitForText((t) => t.includes(title));
    await editor.sendKey("Enter");
}

export default defineScenario({
    name: "status-bar-message",
    title: "window.setStatusBarMessage: stack of extension messages in the status bar",
    seedUserData: userData,
    cols: 120,
    rows: 20,
    env: { SHELL: "/bin/bash" },
    // Extension host scenario: the CI safety net runs on Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("Demo: watching"), { timeoutMs: 20_000 });
        await editor.capture("sticky");

        await runCommand(editor, "Status Message Demo: Show Timed Message");
        await editor.waitForText((t) => t.includes("Demo: no change") && !t.includes("Demo: watching"));
        await editor.capture("stacked");

        await editor.waitForText((t) => t.includes("Demo: watching") && !t.includes("Demo: no change"), {
            timeoutMs: 10_000,
        });
        await editor.capture("restored");

        await runCommand(editor, "Status Message Demo: Show Host Environment");
        await editor.waitForText((t) => t.includes("env.shell: bash · env.machineId:"), { timeoutMs: 10_000 });
        await editor.capture("env");
    },
});
