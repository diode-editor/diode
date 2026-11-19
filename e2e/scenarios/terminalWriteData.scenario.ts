import { basename } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Developer: Write Data to Terminal — an escaped SGR sequence goes straight into the emulator, bypassing the shell:
// the word turns red, and the shell's prompt line stays untouched.

export default defineScenario({
    name: "terminal-write-data",
    title: "Integrated terminal: Developer: Write Data to Terminal",
    open: [repoRoot],
    cols: 100,
    rows: 24,
    env: {
        SHELL: "/bin/bash",
        PS1: "diode$ ",
        PROMPT_COMMAND: "",
    },
    // node-pty spawns a real PTY — like terminal.scenario.ts, Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.sendKey("F1");
        await editor.waitForText((t) => t.includes("File: Save"));
        await editor.sendText("Write Data to Terminal");
        await editor.waitForText((t) => t.includes("Developer: Write Data to Terminal"));
        await editor.sendKey("Enter");

        await editor.waitForText((t) => t.includes("bypassing the pty"));
        await editor.waitForText((t) => t.includes(`${basename(repoRoot)}$`) || t.includes("❯"));
        await editor.sendText(String.raw`\x1b[31mred\x1b[0m written\r\n`);
        await editor.capture("input");
        await editor.sendKey("Enter");

        await editor.waitForText((t) => t.includes("red written"));
        await editor.capture("written");
    },
});
