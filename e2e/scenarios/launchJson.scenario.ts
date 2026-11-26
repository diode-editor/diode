import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

const folder = resolve(repoRoot, "e2e", "fixtures", "launch-json");

export default defineScenario({
    name: "launch-json",
    title: "launch.json: F5 runs the preLaunchTask in the terminal, then starts the selected configuration",
    open: [folder],
    cols: 120,
    rows: 32,
    // The task is a real shell in a PTY: like the tasks scenario, Linux/macOS only.
    skipOn: ["win32"],
    // Without a debugger extension (`debuggersAvailable` is false) the debug keys are off, as upstream: the scenario
    // binds them itself. The second key starts the same configuration with a failing build task.
    userKeybindings: [
        { key: "f5", command: "workbench.action.debug.start" },
        {
            key: "ctrl+alt+5",
            command: "workbench.action.debug.start",
            args: { config: { preLaunchTask: "broken build" } },
        },
    ],
    async run(editor) {
        await editor.waitForText((t) => t.includes(".diode"));
        await editor.waitForReady();

        // F5: the build task first, in the terminal; then the session of the selected configuration. No extension
        // gives the `synthetic` type in a live app yet, so the start ends there with upstream's message.
        await editor.sendKey("F5");
        await editor.waitForText(
            (t) => t.includes("build done") && t.includes("Configured debug type 'synthetic' is not supported."),
        );
        await editor.capture("pre-launch-task");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => !t.includes("is not supported"));

        // A failing build: `debug.onTaskErrors` is `prompt`, so Debug Anyway / Show Errors / Abort, and the
        // checkbox that writes the choice to the user settings.
        await editor.sendKey("Ctrl+Alt+5");
        await editor.waitForText(
            (t) =>
                // The message wraps in the dialog.
                t.includes("The preLaunchTask 'broken build' terminated with exit code") &&
                t.includes("Remember my choice in user settings"),
        );
        await editor.capture("task-errors-prompt");
        // Abort is the last button: the dialog closes and nothing starts.
        await editor.sendKey("Escape");
        await editor.waitForText((t) => !t.includes("terminated with exit code"));
    },
});
