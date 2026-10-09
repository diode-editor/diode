import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureEslintLibrary, ESLINT_FLAT_CONFIG, linkEslintLibrary } from "../../src/TestUtils/eslintFixture.ts";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario } from "./framework.ts";

// Задача стокового расширения: НАСТОЯЩИЙ vscode-eslint из магазина с
// `eslint.lintTask.enable: true` регистрирует провайдер задач типа `eslint`
// (`new Task({ type: "eslint" }, folder, "lint whole folder", "eslint",
// new ShellExecution("<eslint> ."), "$eslint-stylish")`). Run Task → тип eslint →
// «eslint: lint whole folder» — eslint реально проходит по папке, его отчёт в
// терминале задачи. Problem matcher `$eslint-stylish` не исполняется
// (docs/TODO/Tasks.md) — задача просто бежит до выхода.

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
    title: "Задача стокового расширения: vscode-eslint — Run Task «lint whole folder»",
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
        // Провайдер eslint регистрируется на `onStartupFinished` — Run Task
        // поднимает его и сам (`onTaskType:eslint`), а второй уровень ждёт его ответа.
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
