import { resolve } from "node:path";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// Задачи расширения (`vscode.tasks`): фикстурное расширение `task-demo` даёт
// провайдер типа `demo` формой bazel-java (`new Task(def, TaskScope.Workspace,
// name, "demo", new ShellExecution(cmd))`) и задачу на своём pty
// (`CustomExecution`). Что расширение видит в ответ (события исполнений,
// `taskExecutions`, свой ли объект пришёл), пишется в пункты статус-бара
// `ev:`/`ls:`. Кадры: второй уровень Run Task с задачами провайдера → задача из
// палитры доходит до расширения событиями с её name/source → своя задача
// `executeTask` приходит тем же объектом (`own/…`) → pty расширения в терминале
// задачи → `terminate()` бегущей задачи, найденной по name+source.

const folder = resolve(repoRoot, "e2e", "fixtures", "tasks");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-task-demo");

async function runCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.waitForText((t) => t.includes(title));
    await editor.sendKey("Enter");
}

/** Run Task → тип `demo` → задача провайдера по имени. */
async function runDemoTask(editor: ScenarioDriver, name: string): Promise<void> {
    await runCommand(editor, "Tasks: Run Task");
    await editor.waitForText((t) => t.includes("contributed"));
    await editor.sendText("demo");
    await editor.waitForText((t) => t.includes("contributed"));
    await editor.sendKey("Enter");
    await editor.waitForText((t) => t.includes("Go back"));
    await editor.sendText(`demo: ${name}`);
    await editor.sendKey("Enter");
}

export default defineScenario({
    name: "extension-tasks",
    title: "Задачи расширения: провайдер, события исполнений, executeTask, CustomExecution, terminate",
    seedUserData: userData,
    open: [folder],
    cols: 120,
    rows: 32,
    // Extension-host сценарий с настоящим шеллом: как extension-terminal.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("ev:-"), { timeoutMs: 20_000 });

        await runCommand(editor, "Tasks: Run Task");
        await editor.waitForText((t) => t.includes("contributed"));
        await editor.sendText("demo");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("demo: fail") && t.includes("Go back"));
        await editor.capture("provider-tasks");
        await editor.sendText("demo: fail");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("exit code: 7.") && t.includes("ev:end:demo/fail"));
        await editor.capture("palette-run-events");

        await runCommand(editor, "Task Demo: Execute Own Task");
        await editor.waitForText((t) => t.includes("own task from the extension") && t.includes("ev:end:own/own"));
        await editor.capture("execute-own-task");

        await runDemoTask(editor, "pty");
        await editor.waitForText((t) => t.includes("custom pty for pty"));
        await runCommand(editor, "Terminal: Focus Terminal");
        await editor.sendText("x");
        await editor.waitForText((t) => t.includes("custom pty done") && t.includes("ev:end:demo/pty"));
        await editor.capture("custom-execution");

        await runDemoTask(editor, "long");
        await editor.waitForText((t) => t.includes("ls:long"));
        await runCommand(editor, "Task Demo: Terminate Running");
        await editor.waitForText((t) => t.includes("ev:end:demo/long") && t.includes("ls:"));
        await editor.capture("terminate-from-extension");
    },
});
