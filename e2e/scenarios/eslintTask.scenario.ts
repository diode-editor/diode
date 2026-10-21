import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureEslintLibrary, ESLINT_FLAT_CONFIG, linkEslintLibrary } from "../../src/TestUtils/eslintFixture.ts";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario } from "./framework.ts";

// The `$eslint-stylish` problem matcher isn't applied (docs/TODO/Tasks.md); the task just runs until it exits.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-eslint-task-"));

async function runCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.waitForText((t) => t.includes(title));
    await editor.sendKey("Enter");
}

export default defineScenario({
    name: "eslint-task",
    title: "Stock extension task: vscode-eslint — Run Task 'lint whole folder'",
    open: [sampleDir],
    installVsix: ["dbaeumer.vscode-eslint"],
    settings: { "eslint.lintTask.enable": true },
    network: true,
    cols: 120,
    rows: 30,
    skipOn: ["win32", "darwin"],
    async prepare() {
        writeFileSync(join(sampleDir, "eslint.config.mjs"), ESLINT_FLAT_CONFIG);
        writeFileSync(join(sampleDir, "app.js"), "const unused = 1;;\n");
        linkEslintLibrary(sampleDir, ensureEslintLibrary());
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("app.js"));
        // The provider registers on `onStartupFinished`; Run Task activates it itself (`onTaskType:eslint`).
        await runCommand(editor, "Tasks: Run Task");
        await editor.waitForText((t) => t.includes("eslint") && t.includes("contributed"), { timeoutMs: 30_000 });
        await editor.sendText("eslint");
        await editor.waitForText((t) => t.includes("contributed"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("eslint: lint whole folder"), { timeoutMs: 30_000 });
        await editor.capture("eslint-tasks");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("problems") && t.includes("Terminal will be reused by tasks"), {
            timeoutMs: 60_000,
        });
        await editor.capture("eslint-lint-whole-folder");
    },
});
