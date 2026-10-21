import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// The folder lives in a temp directory: the command writes to disk, and the committed fixture must stay clean.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-configure-task-demo-"));
const tasksFile = join(sampleDir, ".diode", "tasks.json");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-task-demo");

async function runCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.waitForText((t) => t.includes(title));
    await editor.sendKey("Enter");
}

async function pick(editor: ScenarioDriver, label: string): Promise<void> {
    await editor.sendText(label);
    await editor.waitForText((t) => t.includes(label));
    await editor.sendKey("Enter");
}

export default defineScenario({
    name: "configure-task",
    title: "Configure Task: tasks.json template, customizing a provider task, running it from Run Task",
    seedUserData: userData,
    open: [sampleDir],
    cols: 120,
    rows: 32,
    // The task runs in a real shell.
    skipOn: ["win32"],
    prepare() {
        writeFileSync(join(sampleDir, "README.md"), "# configure task demo\n");
        return Promise.resolve();
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("ev:-"), { timeoutMs: 20_000 });

        await runCommand(editor, "Tasks: Configure Task");
        await editor.waitForText(
            (t) =>
                t.includes("Select a task to configure") && t.includes("demo: ok") && t.includes("Create tasks.json"),
        );
        await editor.capture("configure-picker-empty");
        await pick(editor, "Create tasks.json file from template");
        await editor.waitForText((t) => t.includes("Select a Task Template") && t.includes("Others"));
        await editor.capture("template-picker");
        await pick(editor, "Others");
        await editor.waitForText((t) => t.includes('"command": "echo Hello"'));
        await editor.capture("template-opened");

        // A user's comment: appending the provider task must preserve it.
        writeFileSync(tasksFile, readFileSync(tasksFile, "utf-8").replace('"tasks": [', '"tasks": [\n        // mine'));

        await runCommand(editor, "Tasks: Configure Task");
        await editor.waitForText((t) => t.includes("Select a task to configure") && t.includes("demo: ok"));
        await editor.capture("configure-picker-configured");
        await pick(editor, "demo: ok");
        const written = await waitUntil(
            () => readFileSync(tasksFile, "utf-8"),
            (text) => text.includes('"target": "ok"'),
            { describe: "demo: ok entry in .diode/tasks.json" },
        );
        if (!written.includes("// mine") || !written.includes('"command": "echo Hello"')) {
            throw new Error(`Configure Task corrupted tasks.json:\n${written}`);
        }
        await editor.waitForText((t) => t.includes('"target": "ok"') && t.includes('"label": "demo: ok"'));
        await editor.capture("customized-entry");

        await runCommand(editor, "Tasks: Run Task");
        await editor.waitForText((t) => t.includes("Select the task to run") && t.includes("configured"));
        await editor.capture("run-task-configured");
        await pick(editor, "demo: ok");
        await editor.waitForText((t) => t.includes("demo task ok") && t.includes("Terminal will be reused by tasks"));
        await editor.capture("customized-ran");
    },
});
