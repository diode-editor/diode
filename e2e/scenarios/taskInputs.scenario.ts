import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

const folder = resolve(repoRoot, "e2e", "fixtures", "task-inputs");

export default defineScenario({
    name: "task-inputs",
    title: "tasks.json inputs: a promptString and a pickString are asked before the task starts",
    open: [folder],
    cols: 120,
    rows: 32,
    // The task is a real shell in a PTY: like the tasks scenario, Linux/macOS only.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes(".diode"));

        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Tasks: Run Task");
        await editor.waitForText((t) => t.includes("Tasks: Run Task"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Select the task to run") && t.includes("greet"));
        await editor.sendText("greet");
        await editor.sendKey("Enter");

        // The prompt with its description and default value.
        await editor.waitForText((t) => t.includes("Who to greet") && t.includes("world"));
        await editor.capture("prompt-string");
        await editor.sendText("Ann");
        await editor.sendKey("Enter");

        // The pick: the default first and marked, a labelled option as `label: value`.
        await editor.waitForText((t) => t.includes("(Default)") && t.includes("Optimized: release"));
        await editor.capture("pick-string");
        await editor.sendText("release");
        await editor.waitForText((t) => !t.includes("(Default)"));
        await editor.sendKey("Enter");

        // `${input:name}` is used twice but asked once.
        await editor.waitForText((t) => t.includes("hello Ann, mode release, again Ann"));
        await editor.capture("task-output");
    },
});
