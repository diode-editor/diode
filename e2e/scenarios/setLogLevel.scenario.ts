import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// `env.logLevel` and `env.onDidChangeLogLevel` through Developer: Set Log Level... The demo extension prints the level
// and the event count in the status bar; `--log debug` is the window level it starts with (upstream default is Info).

const sampleFile = resolve(repoRoot, "AGENTS.md");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-log-level-demo");

export default defineScenario({
    name: "set-log-level",
    title: "Developer: Set Log Level... changes env.logLevel in extensions",
    seedUserData: userData,
    open: [sampleFile],
    extraArgs: ["--log", "debug"],
    cols: 120,
    rows: 24,
    // Linux only: the extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("log: Debug · changes 0"), { timeoutMs: 20_000 });
        await editor.capture("started-with-log-debug");

        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Set Log Level");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Warning") && t.includes("Default"));
        await editor.capture("picker");

        // Trace is the first row.
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("log: Trace · changes 1"), { timeoutMs: 5000 });
        await editor.capture("trace");
    },
});
