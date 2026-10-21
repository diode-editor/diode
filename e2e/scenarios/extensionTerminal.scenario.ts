import { resolve } from "node:path";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// Что расширение видит в ответ (`window.terminals`, `activeTerminal`, события, `exitStatus`), оно пишет в свои
// пункты статус-бара.

const sampleFile = resolve(repoRoot, "AGENTS.md");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-terminal-demo");

async function runCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.waitForText((t) => t.includes(title));
    await editor.sendKey("Enter");
}

export default defineScenario({
    name: "extension-terminal",
    title: "Терминалы расширения: шелл и pty через window.createTerminal в панели TERMINAL",
    seedUserData: userData,
    open: [sampleFile],
    cols: 120,
    rows: 30,
    // Настоящий шелл.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("act:-"), { timeoutMs: 20_000 });

        await runCommand(editor, "Terminal Demo: Run in Terminal");
        await editor.waitForText((t) => t.includes("hello from Demo Runner"), { timeoutMs: 15_000 });
        await editor.waitForText((t) => t.includes("act:Demo Runner"));
        await editor.capture("run");

        await runCommand(editor, "Terminal: Create New Terminal");
        await runCommand(editor, "Terminal Demo: List Terminals");
        await editor.waitForText((t) => t.includes("ev:list") && /ls:Demo Runner,\S/u.test(t) && !t.includes("act:Demo"));
        await editor.capture("two-terminals");

        await runCommand(editor, "Terminal Demo: Dispose");
        await editor.waitForText((t) => t.includes("ev:close4") && !t.includes("ls:Demo Runner"));
        await editor.capture("disposed");

        await runCommand(editor, "Terminal Demo: Show Log");
        await editor.waitForText((t) => t.includes("log pty opened") && t.includes("log: build started"));
        await editor.capture("pty-log");
        await runCommand(editor, "Terminal Demo: Show Log");
        await editor.waitForText((t) => t.split("log: build started").length === 3);
        await editor.sendText("typed");
        await editor.waitForText((t) => t.includes("typed"));
        await editor.capture("pty-typed");
    },
});
