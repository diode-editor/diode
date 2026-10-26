import { resolve } from "node:path";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// A .txt file and no workspace folder: plain text is what the demo items select, and without a folder the
// SCM segments stay out of the bar.
const sampleFile = resolve(repoRoot, "e2e", "fixtures", "language-status.txt");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-language-status-demo");
const SEGMENT = "#statusBarItem-status-languageStatus";

async function runCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.sendKey("Enter");
}

export default defineScenario({
    name: "language-status",
    title: "Language Status: the segment left of the language, its items in a quick pick",
    seedUserData: userData,
    open: [sampleFile],
    cols: 120,
    rows: 24,
    // Linux only: the extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForNode(SEGMENT, { timeoutMs: 20_000 });
        await editor.capture("segment");

        await editor.clickNode(SEGMENT);
        await editor.waitForText((t) => t.includes("Editor Language Status") && t.includes("Demo Lint"), {
            timeoutMs: 5000,
        });
        await editor.capture("picker");

        await editor.sendText("Demo Server");
        await editor.sendKey("Enter");
        await editor.clickNode(SEGMENT);
        await editor.waitForText((t) => t.includes("restarted 1 from menu"), { timeoutMs: 5000 });
        await editor.capture("restarted");
        await editor.sendKey("Escape");

        await runCommand(editor, "Language Status Demo: Error");
        await editor.clickNode(SEGMENT);
        await editor.waitForText((t) => t.includes("config is broken"), { timeoutMs: 5000 });
        await editor.capture("error-first");
        await editor.sendKey("Escape");
    },
});
