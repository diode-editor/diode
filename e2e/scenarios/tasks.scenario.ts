import { resolve } from "node:path";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// Задачи из `.diode/tasks.json`: F1 → «Tasks: Run Task» → пикер configured →
// задача бежит в терминале с «Executing task: …» и после выхода ждёт клавишу
// («Terminal will be reused by tasks, press any key to close it.»); падающая
// показывает код выхода. Rerun Last Task переиспользует тот же терминал, долгая
// задача видна сегментом `$(tools) 1` в статус-баре и останавливается
// «Tasks: Terminate Task».

const folder = resolve(repoRoot, "e2e", "fixtures", "tasks");

async function runCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.waitForText((t) => t.includes(title));
    await editor.sendKey("Enter");
}

/** Run Task → строка пикера по подписи. */
async function runTask(editor: ScenarioDriver, label: string): Promise<void> {
    await runCommand(editor, "Tasks: Run Task");
    await editor.waitForText((t) => t.includes("Select the task to run"));
    await editor.sendText(label);
    await editor.waitForText((t) => t.includes(label));
    await editor.sendKey("Enter");
}

export default defineScenario({
    name: "tasks",
    title: "Задачи tasks.json: Run Task, вывод и код выхода в терминале, Rerun, Terminate",
    open: [folder],
    cols: 120,
    rows: 32,
    // Задача — настоящий шелл в PTY: как extension-terminal, только Linux/macOS.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("tasks.json") || t.includes(".diode"));

        await runCommand(editor, "Tasks: Run Task");
        await editor.waitForText((t) => t.includes("Select the task to run") && t.includes("configured"));
        await editor.capture("run-task-picker");
        await editor.sendText("build");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("building tasks") && t.includes("Terminal will be reused by tasks"));
        await editor.capture("build-done");

        await runTask(editor, "fail");
        await editor.waitForText((t) => t.includes("exit code: 3."));
        await editor.capture("fail-exit-code");

        // Rerun — тот же терминал (вкладка одна), новый процесс: `fail` печатает
        // pid своего шелла, и после повтора он другой.
        let firstPid = "";
        await editor.waitForText((t) => {
            firstPid = /about to fail in (\d+)/u.exec(t)?.[1] ?? "";
            return firstPid !== "";
        });
        await runCommand(editor, "Tasks: Rerun Last Task");
        await editor.waitForText((t) => {
            const pid = /about to fail in (\d+)\s*$/mu.exec(t.split("Executing task").at(-1) ?? "")?.[1];
            return pid !== undefined && pid !== firstPid && t.includes("exit code: 3.");
        });
        await editor.capture("rerun-same-terminal");

        await runTask(editor, "watch");
        await editor.waitForText((t) => t.includes("Executing task: sleep 600"));
        await editor.capture("watch-running");
        await runCommand(editor, "Tasks: Terminate Task");
        await editor.waitForText((t) => t.includes("Select a task to terminate"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => !t.includes("Executing task: sleep 600"));
        await editor.capture("terminated");
    },
});
