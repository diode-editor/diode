import { basename } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Colors come from the theme (`terminal.integrated.colorSource: "theme"`, the vscode default). The `"host"` mode
// (OSC 4/10/11) cannot be shown headless: the headless backend has no terminal to answer.

function swatches(base: number): string {
    return Array.from({ length: 8 }, (_, i) => `\\033[${String(base + i)}m ${String(i)} `).join("") + "\\033[0m";
}

export default defineScenario({
    name: "terminal-colors",
    title: "Integrated terminal: ANSI colors from the color theme",
    open: [repoRoot],
    cols: 100,
    rows: 24,
    env: {
        SHELL: "/bin/bash",
        PS1: "diode$ ",
        PROMPT_COMMAND: "",
    },
    userKeybindings: [
        { key: "f8", command: "workbench.action.selectTheme" },
        { key: "f9", command: "workbench.action.terminal.toggleTerminal" },
    ],
    // node-pty spawns a real PTY — like terminal.scenario.ts, Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.sendKey("F9");
        await editor.waitForText((t) => t.includes("TERMINAL"));
        await editor.waitForText((t) => t.includes(`${basename(repoRoot)}$`) || t.includes("❯"));

        // The marker is built from two pieces: it appears whole only in the output, not in the command echo.
        await editor.sendText(`printf 'ansi''-colors\\n${swatches(40)}\\n${swatches(100)}\\n'`);
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("ansi-colors") && t.includes(" 7 "));
        await editor.capture("dark");

        await editor.sendKey("F8");
        await editor.waitForText((t) => t.includes("Select Color Theme"));
        await editor.sendText("Light Modern");
        await editor.waitForText((t) => t.includes("Light Modern"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => !t.includes("Select Color Theme"));
        await editor.capture("light");
    },
});
