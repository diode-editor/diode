import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// The folder lives in a temp directory: the extension writes .diode/tasks.json, the committed fixture must stay clean.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-tasks-configuration-demo-"));
const tasksFile = join(sampleDir, ".diode", "tasks.json");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-task-demo");
const LABEL = "written by the extension";

async function runCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.waitForText((t) => t.includes(title));
    await editor.sendKey("Enter");
}

export default defineScenario({
    name: "tasks-configuration",
    title: "The tasks configuration section: an extension's update('tasks', …) lands in .diode/tasks.json and Run Task",
    seedUserData: userData,
    open: [sampleDir],
    cols: 120,
    rows: 32,
    // The task runs in a real shell.
    skipOn: ["win32"],
    prepare() {
        writeFileSync(join(sampleDir, "README.md"), "# tasks configuration demo\n");
        return Promise.resolve();
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("ev:-"), { timeoutMs: 20_000 });

        // getConfiguration('tasks').update(…, Workspace), then get('tasks') and fetchTasks() in the extension.
        await runCommand(editor, "Task Demo: Write Tasks Configuration");
        await editor.waitForText((t) => t.includes("ev:cfg:1:default"));
        // `await update()` resolves after the file is written, so the report above means it is on disk.
        const written = JSON.parse(readFileSync(tasksFile, "utf-8")) as { tasks?: { label?: string }[] };
        if (written.tasks?.[0]?.label !== LABEL) throw new Error(`unexpected ${tasksFile}: ${JSON.stringify(written)}`);
        await editor.capture("written");

        await runCommand(editor, "Tasks: Run Task");
        await editor.waitForText((t) => t.includes(LABEL) && t.includes("contributed"));
        await editor.capture("run-task-picker");
        await editor.sendText(LABEL);
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("build from tasks.json"));
        await editor.capture("ran");
    },
});
